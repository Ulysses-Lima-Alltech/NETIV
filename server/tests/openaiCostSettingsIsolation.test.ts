import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('sync de custos usa somente a chave dedicada de custos', () => {
  const source = readFileSync(new URL('../services/openaiCostSyncService.js', import.meta.url), 'utf8');

  assert.match(source, /resolveOpenAiCostsApiKey/);
  assert.match(source, /getOpenAiCostSettings/);
  assert.match(source, /openaiProjectId/);
  assert.doesNotMatch(source, /getOpenAIConfig/);
  assert.doesNotMatch(source, /integration_settings/);
  assert.doesNotMatch(source, /OPENAI_ADMIN_API_KEY/);
});

test('sync de custos retorna mensagens claras para chave ausente e escopo ausente', () => {
  const source = readFileSync(new URL('../services/openaiCostSyncService.js', import.meta.url), 'utf8');

  assert.match(source, /Chave de custos OpenAI não configurada\./);
  assert.match(source, /A chave de custos não possui permissão api\.usage\.read\./);
  assert.match(source, /registerOpenAiCostSyncStatus/);
});

test('DTO seguro de custos mascara chave e não expõe secret', () => {
  const source = readFileSync(new URL('../repositories/openaiCostSettingsRepository.js', import.meta.url), 'utf8');

  assert.match(source, /masked_api_key:\s*maskApiKey\(settings\.openaiCostsApiKey\)/);
  assert.match(source, /has_api_key:\s*trimOrNull\(settings\.openaiCostsApiKey\)\s*!=\s*null/);
  assert.doesNotMatch(source, /openai_costs_api_key:\s*settings\.openaiCostsApiKey/);
});

test('rotas de custos incluem config/get/put/test e sync dedicado', () => {
  const routeSource = readFileSync(new URL('../routes/settingsAi.js', import.meta.url), 'utf8');

  assert.match(routeSource, /\/api\/costs\/config/);
  assert.match(routeSource, /\/api\/costs\/config\/test/);
  assert.match(routeSource, /\/api\/costs\/sync/);
});

test('Ana continua sem depender da chave de custos para atendimento', () => {
  const source = readFileSync(new URL('../services/enterpriseAiSettingsService.js', import.meta.url), 'utf8');

  assert.match(source, /openaiApiKey/);
  assert.match(source, /openai_api_key/);
  assert.doesNotMatch(source, /openai_cost_settings/);
  assert.doesNotMatch(source, /openai_costs_api_key/);
});
