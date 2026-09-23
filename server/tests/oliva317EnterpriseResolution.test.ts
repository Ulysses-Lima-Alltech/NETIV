import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  OLIVA317_ENTERPRISE_ID,
  resolveOliva317EnterpriseFromMessage,
} from '../repositories/enterpriseMatch.js';
import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';

function enterprise(id: number, name: string, slug: string, status = 'ativo'): EnterpriseRow {
  return {
    id,
    name,
    slug,
    status,
    language_style: 'natural',
    prompt_addons: '[]',
    tipo: 'APARTAMENTO',
    exclusivo: false,
    city: null,
    state_uf: null,
    commercial_region: null,
    ibge_code: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
  };
}

const activeEnterprises = [
  enterprise(1, 'Residencial Evora', 'residencial-evora'),
  enterprise(OLIVA317_ENTERPRISE_ID, 'oliva317', 'oliva317'),
];

const olivaAliases = [
  { enterprise_id: OLIVA317_ENTERPRISE_ID, alias: 'oliva317', normalized_alias: 'oliva317' },
];

for (const text of [
  'Gostaria de mais informações sobre o Oliva 317',
  'quero saber mais do oliva317',
  'Tenho interesse no Oliva317',
  'GOSTARIA DE MAIS INFORMAÇÕES SOBRE O OLIVA-317',
]) {
  test(`resolve oliva317 para enterprise 12: ${text}`, () => {
    const resolved = resolveOliva317EnterpriseFromMessage(text, activeEnterprises, olivaAliases);

    assert.equal(resolved.source, 'message_alias');
    assert.equal(resolved.enterpriseId, OLIVA317_ENTERPRISE_ID);
  });
}

test('texto sem referencia ao oliva317 nao resolve enterprise 12', () => {
  const resolved = resolveOliva317EnterpriseFromMessage(
    'Gostaria de mais informações sobre o Residencial Évora',
    activeEnterprises,
    olivaAliases
  );

  assert.equal(resolved.enterpriseId, null);
});

test('oliva generico ou outro numero nao resolve oliva317', () => {
  for (const text of ['quero saber mais do oliva', 'Quero tudo relacionado ao Oliva 417']) {
    const resolved = resolveOliva317EnterpriseFromMessage(text, activeEnterprises, olivaAliases);
    assert.equal(resolved.enterpriseId, null);
  }
});

test('conversa Handoff pode atualizar somente enterprise, mantendo handoff', () => {
  const source = readFileSync(new URL('../scripts/backfillOliva317Enterprise.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /classification === 'Handoff'/);
  assert.doesNotMatch(source, /reason: 'handoff'/);
  assert.match(source, /handoff: c\.handoff/);
  assert.match(source, /sameCommercialFields/);
});

test('conversa Carteira pode atualizar somente enterprise, mantendo classification', () => {
  const source = readFileSync(new URL('../scripts/backfillOliva317Enterprise.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /classification === 'Carteira'/);
  assert.match(source, /\(after\.classification \?\? null\) === \(before\.classification \?\? null\)/);
});

test('conversa Qualificado preserva classification ao corrigir enterprise', () => {
  const repository = readFileSync(new URL('../repositories/conversationRepository.ts', import.meta.url), 'utf8');
  const preservingSetter = repository.slice(
    repository.indexOf('export async function setConversationEnterpriseIdPreservingCommercialState'),
    repository.indexOf('export async function setConversationEnterpriseIdAndOrigin')
  );

  assert.match(preservingSetter, /SET enterprise_id = \$1/);
  assert.doesNotMatch(preservingSetter, /classification =/);
  assert.doesNotMatch(preservingSetter, /applyFunnelQualificationRule/);
});

test('manualEnterpriseOverride impede backfill de enterprise', () => {
  const source = readFileSync(new URL('../scripts/backfillOliva317Enterprise.ts', import.meta.url), 'utf8');

  assert.match(source, /manualEnterpriseOverride/);
  assert.match(source, /IGNORADO_OVERRIDE_MANUAL/);
});

test('conversa ja enterprise_id=12 e no-op', () => {
  const source = readFileSync(new URL('../scripts/backfillOliva317Enterprise.ts', import.meta.url), 'utf8');
  const repository = readFileSync(new URL('../repositories/conversationRepository.ts', import.meta.url), 'utf8');

  assert.match(source, /JA_CORRETO/);
  assert.match(repository, /if \(current\.enterprise_id === enterpriseId\) return current;/);
});

test('fluxo inbound resolve oliva317 antes de fixed reply e bloqueios', () => {
  const source = readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');
  const messagePersisted = source.indexOf('[ANA_PIPELINE] message_persisted');
  const olivaResolve = source.indexOf('conv = await resolveOliva317EnterpriseBeforeAutomation', messagePersisted);
  const fixedReply = source.indexOf('if (globalFixedReplyEnabled)', olivaResolve);
  const automationBlock = source.indexOf('if (await shouldBlockAnaWebhookAutomation', olivaResolve);

  assert.ok(messagePersisted >= 0);
  assert.ok(olivaResolve > messagePersisted);
  assert.ok(fixedReply > olivaResolve);
  assert.ok(automationBlock > olivaResolve);
});

test('script nao usa UPDATE bruto e usa setter preservador', () => {
  const source = readFileSync(new URL('../scripts/backfillOliva317Enterprise.ts', import.meta.url), 'utf8');

  assert.doesNotMatch(source, /UPDATE\s+conversations/i);
  assert.match(source, /setConversationEnterpriseIdPreservingCommercialState/);
});
