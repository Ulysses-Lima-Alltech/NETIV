import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { notifyDjangoLead } from '../services/djangoWebhook.js';
import {
  listConversationsWithPreview,
  type ConversationRow,
  type ListConversationsFilters,
} from '../repositories/conversationRepository.js';
import type { query } from '../db/pg.js';

test('notifyDjangoLead nunca faz requisicao para lead marcado como evento', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => {
    fetchCalls++;
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  try {
    const conversation = {
      id: 123,
      conversation_type: 'CLIENT',
      is_event_lead: true,
    } as unknown as ConversationRow;
    assert.equal((await notifyDjangoLead(conversation)).ok, false);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('worker do Django exclui leads marcados antes de fazer a requisicao', () => {
  const source = readFileSync(new URL('../services/djangoSyncWorker.ts', import.meta.url), 'utf8');
  assert.match(source, /AND c\.is_event_lead = FALSE/);
});

test('Inbox INTERNO inclui leads de evento e Clientes os exclui no SQL', async () => {
  const queries: string[] = [];
  const executor = (async (sql: string) => {
    queries.push(sql);
    return { rows: [] };
  }) as unknown as typeof query;

  const internalFilters: ListConversationsFilters = { conversationTypeFilter: 'INTERNO' };
  await listConversationsWithPreview('whatsapp', 50, internalFilters, executor);
  assert.match(queries[0] ?? '', /OR c\.is_event_lead = TRUE\)/);

  const clientFilters: ListConversationsFilters = { conversationTypeFilter: 'CLIENT' };
  await listConversationsWithPreview('whatsapp', 50, clientFilters, executor);
  assert.match(queries[1] ?? '', /c\.is_event_lead = FALSE/);
});

test('lista usada pelo Django aplica o filtro de exclusao de eventos', async () => {
  let captured = '';
  const executor = (async (sql: string) => {
    captured = sql;
    return { rows: [] };
  }) as unknown as typeof query;
  await listConversationsWithPreview(
    'whatsapp',
    50,
    { excludeEventLeads: true },
    executor
  );
  assert.match(captured, /c\.is_event_lead = FALSE/);
});
