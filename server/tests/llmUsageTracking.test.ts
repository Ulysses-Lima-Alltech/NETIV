import { readServerSourceFile, readWorkspaceFile } from './helpers/serverSourceResolver.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { generateChatCompletion, usesMaxCompletionTokens } from '../services/openaiService.js';
import type { LlmUsageEventInput } from '../repositories/llmUsageRepository.js';

// generateChatCompletion sempre resolve para Bedrock hoje (branch HTTP direto para
// api.openai.com foi removido — nenhuma empresa ativa dependia dele). Os testes
// mockam BedrockRuntimeClient.send em vez de fetch para exercitar o caminho real.
const originalSend = BedrockRuntimeClient.prototype.send;

function mockBedrockConverseResponse(params: {
  content?: string;
  usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
  requestId?: string;
  httpStatusCode?: number;
} = {}): void {
  BedrockRuntimeClient.prototype.send = (async () => ({
    output: { message: { content: [{ text: params.content ?? 'ok' }] } },
    usage: params.usage,
    $metadata: { requestId: params.requestId ?? 'req_test_123', httpStatusCode: params.httpStatusCode ?? 200 },
  })) as typeof BedrockRuntimeClient.prototype.send;
}

function mockBedrockConverseError(error: { name?: string; message: string; httpStatusCode?: number }): void {
  BedrockRuntimeClient.prototype.send = (async () => {
    const e = new Error(error.message) as Error & { name: string; $metadata?: { httpStatusCode?: number } };
    e.name = error.name ?? 'Error';
    e.$metadata = { httpStatusCode: error.httpStatusCode };
    throw e;
  }) as typeof BedrockRuntimeClient.prototype.send;
}

test.afterEach(() => {
  BedrockRuntimeClient.prototype.send = originalSend;
});

test('generateChatCompletion registra llm_usage_events quando usage vem na resposta', async () => {
  const events: LlmUsageEventInput[] = [];
  mockBedrockConverseResponse({
    content: '{"reply":"ok"}',
    usage: { inputTokens: 1000, outputTokens: 250, totalTokens: 1250 },
  });

  const result = await generateChatCompletion({
    apiKey: 'sk-test',
    baseUrl: null,
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: 'oi' }],
    temperature: 0.2,
    maxTokens: 100,
    costTracking: {
      purpose: 'ana_main_reply',
      modelReason: 'unclassified_enterprise_low_cost_model',
      conversationId: 10,
      contactId: 20,
      enterpriseId: 30,
      inboundMessageId: 40,
      recordUsageEvent: async (event) => {
        events.push(event);
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.provider, 'bedrock');
  assert.equal(events[0]?.model, 'gpt-4.1-mini');
  assert.equal(events[0]?.purpose, 'ana_main_reply');
  assert.equal(events[0]?.modelReason, 'unclassified_enterprise_low_cost_model');
  assert.equal(events[0]?.conversationId, 10);
  assert.equal(events[0]?.contactId, 20);
  assert.equal(events[0]?.enterpriseId, 30);
  assert.equal(events[0]?.inboundMessageId, 40);
  assert.equal(events[0]?.inputTokens, 1000);
  assert.equal(events[0]?.cachedInputTokens, 0);
  assert.equal(events[0]?.outputTokens, 250);
  assert.equal(events[0]?.totalTokens, 1250);
  assert.equal(events[0]?.success, true);
  assert.equal(events[0]?.requestId, 'req_test_123');
  assert.ok((events[0]?.estimatedCostUsd ?? 0) > 0);
});

test('generateChatCompletion nao quebra se usage vier ausente', async () => {
  const events: LlmUsageEventInput[] = [];
  mockBedrockConverseResponse();

  const result = await generateChatCompletion({
    apiKey: 'sk-test',
    baseUrl: null,
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: 'oi' }],
    temperature: 0.2,
    maxTokens: 100,
    costTracking: {
      purpose: 'ana_main_reply',
      conversationId: 11,
      enterpriseId: null,
      recordUsageEvent: async (event) => {
        events.push(event);
      },
    },
  });

  assert.equal(result.success, true);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.inputTokens, 0);
  assert.equal(events[0]?.outputTokens, 0);
  assert.equal(events[0]?.totalTokens, 0);
  assert.equal(events[0]?.estimatedCostUsd, 0);
});

test('chamada com enterprise_id null salva enterprise_id null', async () => {
  const events: LlmUsageEventInput[] = [];
  mockBedrockConverseResponse({ usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });

  await generateChatCompletion({
    apiKey: 'sk-test',
    baseUrl: null,
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: 'oi' }],
    temperature: 0.2,
    maxTokens: 100,
    costTracking: {
      purpose: 'ana_main_reply',
      conversationId: 12,
      enterpriseId: null,
      recordUsageEvent: async (event) => {
        events.push(event);
      },
    },
  });

  assert.equal(events[0]?.enterpriseId, null);
});

test('chamada com enterprise_id resolvido salva enterprise_id correto', async () => {
  const events: LlmUsageEventInput[] = [];
  mockBedrockConverseResponse({ usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } });

  await generateChatCompletion({
    apiKey: 'sk-test',
    baseUrl: null,
    model: 'gpt-4.1',
    messages: [{ role: 'user', content: 'oi' }],
    temperature: 0.2,
    maxTokens: 100,
    costTracking: {
      purpose: 'ana_main_reply',
      conversationId: 13,
      enterpriseId: 99,
      recordUsageEvent: async (event) => {
        events.push(event);
      },
    },
  });

  assert.equal(events[0]?.enterpriseId, 99);
});

test('modelo sem preco cadastrado registra custo 0 e price_missing', async () => {
  const events: LlmUsageEventInput[] = [];
  mockBedrockConverseResponse({ usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 } });

  await generateChatCompletion({
    apiKey: 'sk-test',
    baseUrl: null,
    model: 'modelo-sem-preco',
    messages: [{ role: 'user', content: 'oi' }],
    temperature: 0.2,
    maxTokens: 100,
    costTracking: {
      purpose: 'ana_main_reply',
      recordUsageEvent: async (event) => {
        events.push(event);
      },
    },
  });

  assert.equal(events[0]?.estimatedCostUsd, 0);
  assert.equal((events[0]?.metadata as { priceMissing?: boolean } | undefined)?.priceMissing, true);
});

test('erro da API tambem registra evento de uso sem mudar resposta', async () => {
  const events: LlmUsageEventInput[] = [];
  mockBedrockConverseError({ name: 'ThrottlingException', message: 'rate limit', httpStatusCode: 429 });

  const result = await generateChatCompletion({
    apiKey: 'sk-test',
    baseUrl: null,
    model: 'gpt-4.1-mini',
    messages: [{ role: 'user', content: 'oi' }],
    temperature: 0.2,
    maxTokens: 100,
    costTracking: {
      purpose: 'ana_main_reply',
      recordUsageEvent: async (event) => {
        events.push(event);
      },
    },
  });

  assert.equal(result.success, false);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.success, false);
  assert.equal(events[0]?.errorCode, 'ThrottlingException');
});

test('helper usesMaxCompletionTokens mapeia modelos corretamente', () => {
  assert.equal(usesMaxCompletionTokens('gpt-4.1'), false);
  assert.equal(usesMaxCompletionTokens('gpt-4.1-mini'), false);
  assert.equal(usesMaxCompletionTokens('o4-mini'), true);
  assert.equal(usesMaxCompletionTokens('o3'), true);
  assert.equal(usesMaxCompletionTokens('gpt-5.1'), true);
});

test('dashboard agrega custo por empreendimento apenas no periodo e inclui grupo sem empreendimento', () => {
  const source = readServerSourceFile('repositories/dashboardRepository.js');

  assert.match(source, /llm_usage_events/);
  assert.match(source, /llm_cost_backfills/);
  assert.match(source, /openai_cost_snapshots/);
  assert.match(source, /SUM\(ue\.estimated_cost_usd\)/);
  assert.match(source, /ue\.created_at AT TIME ZONE/);
  assert.doesNotMatch(source, /FULL\s+(?:OUTER\s+)?JOIN/i);
  assert.match(source, /COALESCE\(c\.enterprise_id::text, '__NO_ENTERPRISE__'\) AS group_key/);
  assert.match(source, /COALESCE\(COALESCE\(ue\.enterprise_id::int, eas\.enterprise_id\)::text, '__NO_ENTERPRISE__'\) AS group_key/);
  assert.match(source, /LEFT JOIN enterprise_ai_settings eas/);
  assert.match(source, /eas\.openai_api_key_id = ue\.openai_api_key_id/);
  assert.match(source, /COALESCE\(COALESCE\(a\.resolved_enterprise_id, a\.enterprise_id, c\.enterprise_id\)::text, '__NO_ENTERPRISE__'\) AS group_key/);
  assert.match(source, /combined AS \(/);
  assert.match(source, /SELECT \* FROM conv_groups\s+UNION ALL\s+SELECT \* FROM usage_groups\s+UNION ALL\s+SELECT \* FROM backfill_groups/);
  assert.match(source, /GROUP BY group_key/);
  assert.match(source, /\(sem empreendimento\)/);
});

test('dashboard query combina linhas apenas comerciais, apenas llm, apenas backfill, ambos e enterprise_id null via group_key', () => {
  const source = readServerSourceFile('repositories/dashboardRepository.js');

  assert.match(source, /conv_groups AS \([\s\S]*0::bigint AS llm_calls/);
  assert.match(source, /usage_groups AS \([\s\S]*0::bigint AS total/);
  assert.match(source, /backfill_groups AS \([\s\S]*0::bigint AS total/);
  assert.match(source, /official_cost_groups AS \([\s\S]*0::bigint AS total/);
  assert.match(source, /SUM\(total\)::text AS total/);
  assert.match(source, /SUM\(llm_calls\)::text AS llm_calls/);
  assert.match(source, /SUM\(llm_tracked_cost_usd\)::numeric\(12,6\)::text AS llm_tracked_cost_usd/);
  assert.match(source, /SUM\(llm_estimated_cost_usd\)::numeric\(12,6\)::text AS llm_estimated_cost_usd/);
  assert.match(source, /SUM\(llm_official_cost_usd\)::numeric\(12,6\)::text AS llm_official_cost_usd/);
  assert.match(source, /SUM\(llm_tracked_cost_usd\) \+ SUM\(llm_estimated_cost_usd\)/);
  assert.match(source, /CASE[\s\S]*SUM\(llm_official_rows\) > 0[\s\S]*llm_cost_usd/);
  assert.match(source, /CASE WHEN group_key = '__NO_ENTERPRISE__' THEN NULL ELSE MAX\(enterprise_id\) END AS enterprise_id/);
  assert.match(source, /WHEN group_key = '__NO_ENTERPRISE__' THEN '\(sem empreendimento\)'/);
});

test('dashboard nao aplica teto artificial e prepara mapeamento por openai_api_key_id', () => {
  const source = readServerSourceFile('repositories/dashboardRepository.js');
  assert.match(source, /openai_api_key_id/);
  assert.match(source, /enterprise_ai_settings/);
  assert.doesNotMatch(source, /LEAST\([^)]*20/i);
  assert.doesNotMatch(source, /cap.*20/i);
});

test('dashboard soma custo rastreado e estimado historico com rateio por esforco', () => {
  const source = readServerSourceFile('repositories/dashboardRepository.js');

  assert.match(source, /eligible_backfills AS \(/);
  assert.match(source, /b\.is_active = TRUE/);
  assert.match(source, /b\.start_at < pb\.period_end/);
  assert.match(source, /b\.end_at > pb\.period_start/);
  assert.match(source, /COUNT\(\*\) FILTER \(WHERE m\.role = 'user'\)::numeric \* 1\.0/);
  assert.match(source, /COUNT\(\*\) FILTER \(WHERE m\.role = 'assistant'\)::numeric \* 3\.0/);
  assert.match(source, /COUNT\(\*\)::numeric \* 0\.25/);
  assert.match(source, /COUNT\(\*\)::numeric \* 2\.0 AS effort/);
  assert.match(source, /NULLIF\(SUM\(beg\.effort\) OVER \(PARTITION BY beg\.backfill_id\), 0\)/);
  assert.match(source, /SUM\(ba\.allocated_cost_usd\)::numeric\(12,6\) AS llm_estimated_cost_usd/);
});

test('dashboard prioriza snapshot oficial e faz fallback para custo local quando necessario', () => {
  const source = readServerSourceFile('repositories/dashboardRepository.js');

  assert.match(source, /official_cost_allocations AS \(/);
  assert.match(source, /JOIN eligible_backfills|official_cost_groups/);
  assert.match(source, /CASE[\s\S]*SUM\(llm_official_rows\) > 0[\s\S]*'official_openai'[\s\S]*'local_estimated'/);
  assert.match(source, /llmOfficialCostUsd/);
  assert.match(source, /llmLocalEstimatedCostUsd/);
  assert.match(source, /llmCostSource/);
});

test('migration e script de backfill existem sem seed automatico', () => {
  const migration = readServerSourceFile('db/migrations/pg/052_llm_cost_backfills.sql');
  const script = readServerSourceFile('scripts/addLlmCostBackfill.js');

  assert.match(migration, /CREATE TABLE IF NOT EXISTS llm_cost_backfills/);
  assert.match(migration, /tracked_cost_handling TEXT NOT NULL DEFAULT 'additive'/);
  assert.match(migration, /CREATE INDEX IF NOT EXISTS idx_llm_cost_backfills_period/);
  assert.doesNotMatch(migration, /INSERT INTO llm_cost_backfills/i);
  assert.match(script, /--total-cost-usd/);
  assert.match(script, /INSERT INTO llm_cost_backfills/);
});

test('contrato do dashboard retorna campos novos sem remover os antigos', () => {
  const source = readServerSourceFile('repositories/dashboardRepository.js');

  for (const field of ['total', 'qualified', 'handoffs', 'carteiras']) {
    assert.match(source, new RegExp(`${field}: parseInt`));
  }
  for (const field of [
    'llmCostUsd',
    'llmOfficialCostUsd',
    'llmLocalEstimatedCostUsd',
    'llmCostSource',
    'llmTrackedCostUsd',
    'llmEstimatedCostUsd',
    'llmCalls',
    'llmInputTokens',
    'llmOutputTokens',
    'llmTotalTokens',
    'llmCostPerContact',
    'llmCostPerConversation',
  ]) {
    assert.match(source, new RegExp(field));
  }
});

test('frontend renderiza Custo IA e Custo/contato', () => {
  const source = readWorkspaceFile('src/pages/DashboardPage.tsx');

  assert.match(source, /Custo IA/);
  assert.match(source, /Custo\/contato/);
  assert.match(source, /formatUsd\(row\.llmCostUsd\)/);
  assert.match(source, /formatUsd\(row\.llmTrackedCostUsd\)/);
  assert.match(source, /formatUsd\(row\.llmEstimatedCostUsd\)/);
  assert.match(source, /Rastreado:/);
  assert.match(source, /Estimado histórico:/);
  assert.match(source, /formatUsd\(row\.llmCostPerContact\)/);
});
