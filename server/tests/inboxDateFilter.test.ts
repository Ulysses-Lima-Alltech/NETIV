import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer, type Server } from 'node:http';
import express from 'express';
import { createListConversationsHandler } from '../routes/whatsapp.js';
import {
  listConversationsWithPreview,
  type ConversationWithPreview,
  type ListConversationsFilters,
} from '../repositories/conversationRepository.js';
import {
  ConversationDateFilterError,
  INBOX_DATE_TIME_ZONE,
  parseConversationDateFilter,
} from '../utils/inboxDateFilter.js';

test('aceita limites independentes e referência de início da conversa', () => {
  assert.deepEqual(
    parseConversationDateFilter({ dateFrom: '2026-08-01', dateReference: 'conversation_started' }),
    { dateFrom: '2026-08-01', dateReference: 'conversation_started' }
  );
  assert.deepEqual(parseConversationDateFilter({ dateTo: '2026-08-01' }), {
    dateTo: '2026-08-01', dateReference: 'last_message',
  });
});

test('rejeita datas inválidas e intervalo invertido', () => {
  assert.throws(() => parseConversationDateFilter({ dateFrom: '2026-02-30' }), ConversationDateFilterError);
  assert.throws(
    () => parseConversationDateFilter({ dateFrom: '2026-08-02', dateTo: '2026-08-01' }),
    ConversationDateFilterError
  );
});

type CapturedQuery = { text: string; params: unknown[] };

async function captureConversationListQuery(filters?: ListConversationsFilters): Promise<CapturedQuery> {
  let captured: CapturedQuery | null = null;
  const queryExecutor = (async (text: string, params?: unknown[]) => {
    captured = { text, params: params ?? [] };
    return { rows: [] };
  }) as unknown as typeof import('../db/pg.js').query;
  await listConversationsWithPreview('whatsapp', 100, filters, queryExecutor);
  assert.ok(captured);
  return captured;
}

test('consulta parametrizada usa last_message_at e exclui NULL sem fallback', async () => {
  const captured = await captureConversationListQuery({
    dateFrom: '2026-08-01', dateTo: '2026-08-31', dateReference: 'last_message',
  });
  assert.match(captured.text, /c\.last_message_at >= \(\$2::date::timestamp AT TIME ZONE 'America\/Sao_Paulo'\)/);
  assert.match(captured.text, /c\.last_message_at < \(\(\$3::date \+ INTERVAL '1 day'\)::timestamp AT TIME ZONE 'America\/Sao_Paulo'\)/);
  assert.doesNotMatch(captured.text, /COALESCE\(c\.last_message_at/);
  assert.equal(INBOX_DATE_TIME_ZONE, 'America/Sao_Paulo');
  assert.deepEqual(captured.params, ['whatsapp', '2026-08-01', '2026-08-31', 100]);
});

test('consulta usa created_at e mantém parâmetros dos filtros existentes', async () => {
  const captured = await captureConversationListQuery({
    status: 'Qualificado', enterpriseId: 7, search: 'Ana', dateFrom: '2026-08-01', dateTo: '2026-08-31',
    dateReference: 'conversation_started', conversationTypeFilter: 'CLIENT', scopeConvIds: [11, 12],
  });
  assert.match(captured.text, /c\.created_at >= \(\$5::date::timestamp/);
  assert.match(captured.text, /c\.created_at < \(\(\$6::date \+ INTERVAL '1 day'\)::timestamp/);
  assert.doesNotMatch(captured.text, /c\.updated_at [<>]=?/);
  assert.match(captured.text, /c\.id = ANY\(\$8\)/);
  assert.deepEqual(captured.params, [
    'whatsapp', 'Qualificado', 7, '%Ana%', '2026-08-01', '2026-08-31', 'CLIENT', [11, 12], 100,
  ]);
});

test('consulta aceita limites isolados e não acrescenta período quando datas estão ausentes', async () => {
  const fromOnly = await captureConversationListQuery({ dateFrom: '2026-08-01' });
  assert.match(fromOnly.text, /c\.last_message_at >= \(\$2::date::timestamp/);
  assert.doesNotMatch(fromOnly.text, /INTERVAL '1 day'/);
  assert.deepEqual(fromOnly.params, ['whatsapp', '2026-08-01', 100]);
  const toOnly = await captureConversationListQuery({ dateTo: '2026-08-31' });
  assert.match(toOnly.text, /c\.last_message_at < \(\(\$2::date \+ INTERVAL '1 day'\)/);
  assert.deepEqual(toOnly.params, ['whatsapp', '2026-08-31', 100]);
  const withoutDates = await captureConversationListQuery();
  assert.doesNotMatch(withoutDates.text, /AT TIME ZONE/);
  assert.deepEqual(withoutDates.params, ['whatsapp', 100]);
});

type RouteListCall = { channel: string; limit: number; filters: ListConversationsFilters | undefined };

async function requestConversationRoute(path: string): Promise<{ response: Response; calls: RouteListCall[] }> {
  const calls: RouteListCall[] = [];
  const listConversations = (async (channel, limit, filters) => {
    calls.push({ channel: channel ?? 'whatsapp', limit: limit ?? 100, filters });
    return [] as ConversationWithPreview[];
  }) as typeof listConversationsWithPreview;
  const app = express();
  app.get('/whatsapp/conversations', createListConversationsHandler({ listConversationsWithPreview: listConversations, canAccessAll: () => true }));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    return { response: await fetch(`http://127.0.0.1:${address.port}${path}`), calls };
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test('rota GET /whatsapp/conversations preserva filtros e repassa o período', async () => {
  const noDates = await requestConversationRoute('/whatsapp/conversations');
  assert.equal(noDates.response.status, 200);
  assert.deepEqual(noDates.calls[0]?.filters, { conversationTypeFilter: 'CLIENT' });
  const started = await requestConversationRoute('/whatsapp/conversations?dateFrom=2026-08-01&dateTo=2026-08-31&dateReference=conversation_started&mode=ANA&status=Qualificado&enterpriseId=7&search=Ana');
  assert.equal(started.response.status, 200);
  assert.deepEqual(started.calls[0]?.filters, {
    mode: 'ANA', status: 'Qualificado', enterpriseId: 7, search: 'Ana',
    dateFrom: '2026-08-01', dateTo: '2026-08-31', dateReference: 'conversation_started', conversationTypeFilter: 'CLIENT',
  });
});

test('rota usa last_message por padrão e rejeita período inválido antes do repositório', async () => {
  const fromOnly = await requestConversationRoute('/whatsapp/conversations?dateFrom=2026-08-01');
  assert.equal(fromOnly.response.status, 200);
  assert.deepEqual(fromOnly.calls[0]?.filters, {
    dateFrom: '2026-08-01', dateReference: 'last_message', conversationTypeFilter: 'CLIENT',
  });
  for (const path of [
    '/whatsapp/conversations?dateReference=invalid',
    '/whatsapp/conversations?dateFrom=2026-02-31',
    '/whatsapp/conversations?dateFrom=2026-08-02&dateTo=2026-08-01',
  ]) {
    const result = await requestConversationRoute(path);
    assert.equal(result.response.status, 400, path);
    assert.equal(result.calls.length, 0, path);
  }
});
