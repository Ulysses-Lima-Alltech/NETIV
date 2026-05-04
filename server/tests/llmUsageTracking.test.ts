import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { generateChatCompletion } from '../services/openaiService.js';
import type { LlmUsageEventInput } from '../repositories/llmUsageRepository.js';

const originalFetch = globalThis.fetch;

function mockChatCompletionResponse(body: unknown, status = 200): void {
  globalThis.fetch = async () =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req_test_123' },
    });
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('generateChatCompletion registra llm_usage_events quando usage vem na resposta', async () => {
  const events: LlmUsageEventInput[] = [];
  mockChatCompletionResponse({
    choices: [{ message: { content: '{"reply":"ok"}' } }],
    usage: {
      prompt_tokens: 1000,
      completion_tokens: 250,
      total_tokens: 1250,
      prompt_tokens_details: { cached_tokens: 200 },
    },
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
  assert.equal(events[0]?.provider, 'openai');
  assert.equal(events[0]?.model, 'gpt-4.1-mini');
  assert.equal(events[0]?.purpose, 'ana_main_reply');
  assert.equal(events[0]?.modelReason, 'unclassified_enterprise_low_cost_model');
  assert.equal(events[0]?.conversationId, 10);
  assert.equal(events[0]?.contactId, 20);
  assert.equal(events[0]?.enterpriseId, 30);
  assert.equal(events[0]?.inboundMessageId, 40);
  assert.equal(events[0]?.inputTokens, 1000);
  assert.equal(events[0]?.cachedInputTokens, 200);
  assert.equal(events[0]?.outputTokens, 250);
  assert.equal(events[0]?.totalTokens, 1250);
  assert.equal(events[0]?.success, true);
  assert.equal(events[0]?.requestId, 'req_test_123');
  assert.ok((events[0]?.estimatedCostUsd ?? 0) > 0);
});

test('generateChatCompletion nao quebra se usage vier ausente', async () => {
  const events: LlmUsageEventInput[] = [];
  mockChatCompletionResponse({
    choices: [{ message: { content: 'ok' } }],
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
  mockChatCompletionResponse({
    choices: [{ message: { content: 'ok' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });

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
  mockChatCompletionResponse({
    choices: [{ message: { content: 'ok' } }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  });

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
  mockChatCompletionResponse({
    choices: [{ message: { content: 'ok' } }],
    usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
  });

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
  mockChatCompletionResponse({
    error: { message: 'rate limit', code: 'rate_limit_exceeded', type: 'rate_limit_error' },
  }, 429);

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
  assert.equal(events[0]?.errorCode, 'rate_limit_exceeded');
});

test('dashboard agrega custo por empreendimento apenas no periodo e inclui grupo sem empreendimento', () => {
  const source = readFileSync(new URL('../repositories/dashboardRepository.js', import.meta.url), 'utf8');

  assert.match(source, /llm_usage_events/);
  assert.match(source, /SUM\(ue\.estimated_cost_usd\)/);
  assert.match(source, /ue\.created_at AT TIME ZONE/);
  assert.match(source, /FULL OUTER JOIN usage_groups/);
  assert.match(source, /\(sem empreendimento\)/);
});

test('contrato do dashboard retorna campos novos sem remover os antigos', () => {
  const source = readFileSync(new URL('../repositories/dashboardRepository.js', import.meta.url), 'utf8');

  for (const field of ['total', 'qualified', 'handoffs', 'carteiras']) {
    assert.match(source, new RegExp(`${field}: parseInt`));
  }
  for (const field of [
    'llmCostUsd',
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
  const source = readFileSync('../src/pages/DashboardPage.tsx', 'utf8');

  assert.match(source, /Custo IA/);
  assert.match(source, /Custo\/contato/);
  assert.match(source, /formatUsd\(row\.llmCostUsd\)/);
  assert.match(source, /formatUsd\(row\.llmCostPerContact\)/);
});
