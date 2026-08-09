import { readServerSourceFile } from './helpers/serverSourceResolver.js';
import assert from 'node:assert/strict';
import test from 'node:test';

test('DTO seguro de custos mascara chave e não expõe secret', () => {
  const source = readServerSourceFile('repositories/openaiCostSettingsRepository.js');

  assert.match(source, /masked_api_key:\s*maskApiKey\(settings\.openaiCostsApiKey\)/);
  assert.match(source, /has_api_key:\s*trimOrNull\(settings\.openaiCostsApiKey\)\s*!=\s*null/);
  assert.doesNotMatch(source, /openai_costs_api_key:\s*settings\.openaiCostsApiKey/);
});

test('rotas de custos incluem config (get/put) e listagem de snapshots', () => {
  const routeSource = readServerSourceFile('routes/settingsAi.js');

  assert.match(routeSource, /\/api\/costs\/config/);
  assert.match(routeSource, /\/api\/costs\/snapshots/);
  assert.doesNotMatch(routeSource, /\/api\/costs\/config\/test/);
  assert.doesNotMatch(routeSource, /\/api\/costs\/sync/);
});

test('Ana continua sem depender da chave de custos para atendimento', () => {
  const source = readServerSourceFile('services/enterpriseAiSettingsService.js');

  assert.match(source, /openaiApiKey/);
  assert.match(source, /openai_api_key/);
  assert.doesNotMatch(source, /openai_cost_settings/);
  assert.doesNotMatch(source, /openai_costs_api_key/);
});
