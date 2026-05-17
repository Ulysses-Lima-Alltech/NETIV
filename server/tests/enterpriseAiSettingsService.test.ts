import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  __resolveAiSettingsForTest,
  maskApiKey,
  type EnterpriseAiSettings,
  type GlobalAiSettings,
} from '../services/enterpriseAiSettingsService.js';

const BASE_GLOBAL: GlobalAiSettings = {
  provider: 'openai',
  openaiApiKey: 'sk-global-1234567890',
  openaiApiKeyId: 'key_global',
  openaiProjectId: 'proj_global',
  openaiBaseUrl: 'https://api.openai.com/v1',
  modelHotLead: 'gpt-4.1',
  modelColdLead: 'gpt-4.1-mini',
  temperature: 0.5,
  maxTokens: 700,
  leadScoreThreshold: 0.75,
  aiEnabled: true,
};

function buildEnterprise(partial: Partial<EnterpriseAiSettings>): EnterpriseAiSettings {
  return {
    id: 1,
    enterpriseId: 1,
    provider: 'openai',
    openaiApiKey: null,
    openaiApiKeyId: null,
    openaiProjectId: null,
    openaiBaseUrl: null,
    modelHotLead: null,
    modelColdLead: null,
    aiEnabled: true,
    emergencyBlockEnabled: false,
    emergencyBlockMessage: null,
    costTrackingEnabled: true,
    useGlobalDefaults: true,
    lastConnectionTestAt: null,
    lastConnectionTestStatus: null,
    lastConnectionTestError: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...partial,
  };
}

test('empreendimento com API própria usa chave do empreendimento', () => {
  const enterprise = buildEnterprise({
    enterpriseId: 10,
    useGlobalDefaults: false,
    openaiApiKey: 'sk-enterprise-abcde',
    openaiApiKeyId: 'key_evora',
    modelHotLead: 'gpt-4.1',
    modelColdLead: 'gpt-4.1-mini',
  });
  const resolved = __resolveAiSettingsForTest(10, BASE_GLOBAL, enterprise);
  assert.equal(resolved.blocked, false);
  assert.equal(resolved.apiKeySource, 'enterprise');
  assert.equal(resolved.openaiApiKey, 'sk-enterprise-abcde');
});

test('use_global_defaults=true usa fallback global quando não há chave própria', () => {
  const enterprise = buildEnterprise({
    enterpriseId: 11,
    useGlobalDefaults: true,
    openaiApiKey: null,
  });
  const resolved = __resolveAiSettingsForTest(11, BASE_GLOBAL, enterprise);
  assert.equal(resolved.blocked, false);
  assert.equal(resolved.apiKeySource, 'global_fallback');
  assert.equal(resolved.openaiApiKey, BASE_GLOBAL.openaiApiKey);
});

test('bloqueio emergencial bloqueia chamada de IA antes da chave', () => {
  const enterprise = buildEnterprise({
    enterpriseId: 12,
    emergencyBlockEnabled: true,
    emergencyBlockMessage: 'Bloqueado em manutenção',
    openaiApiKey: 'sk-enterprise-blocked',
  });
  const resolved = __resolveAiSettingsForTest(12, BASE_GLOBAL, enterprise);
  assert.equal(resolved.blocked, true);
  assert.equal(resolved.reason, 'emergency_block');
  assert.equal(resolved.openaiApiKey, null);
});

test('ai_enabled=false bloqueia chamada de IA', () => {
  const enterprise = buildEnterprise({
    enterpriseId: 13,
    aiEnabled: false,
    openaiApiKey: 'sk-enterprise-disabled',
  });
  const resolved = __resolveAiSettingsForTest(13, BASE_GLOBAL, enterprise);
  assert.equal(resolved.blocked, true);
  assert.equal(resolved.reason, 'ai_disabled');
  assert.equal(resolved.openaiApiKey, null);
});

test('sem API própria e sem fallback global permitido bloqueia com erro controlado', () => {
  const enterprise = buildEnterprise({
    enterpriseId: 14,
    useGlobalDefaults: false,
    openaiApiKey: null,
  });
  const resolved = __resolveAiSettingsForTest(14, BASE_GLOBAL, enterprise);
  assert.equal(resolved.blocked, true);
  assert.equal(resolved.reason, 'missing_enterprise_api_key');
  assert.equal(resolved.apiKeySource, null);
});

test('Évora ativo e Altis bloqueado funcionam de forma independente', () => {
  const evora = buildEnterprise({
    enterpriseId: 101,
    useGlobalDefaults: false,
    openaiApiKey: 'sk-evora-1234',
    openaiApiKeyId: 'key_evora',
    emergencyBlockEnabled: false,
    aiEnabled: true,
  });
  const altis = buildEnterprise({
    enterpriseId: 102,
    useGlobalDefaults: false,
    openaiApiKey: 'sk-altis-1234',
    openaiApiKeyId: 'key_altis',
    emergencyBlockEnabled: true,
    aiEnabled: true,
  });

  const evoraResolved = __resolveAiSettingsForTest(101, BASE_GLOBAL, evora);
  const altisResolved = __resolveAiSettingsForTest(102, BASE_GLOBAL, altis);

  assert.equal(evoraResolved.blocked, false);
  assert.equal(evoraResolved.apiKeySource, 'enterprise');
  assert.equal(evoraResolved.openaiApiKey, 'sk-evora-1234');

  assert.equal(altisResolved.blocked, true);
  assert.equal(altisResolved.reason, 'emergency_block');
  assert.equal(altisResolved.openaiApiKey, null);
});

test('maskApiKey nunca retorna chave completa', () => {
  const masked = maskApiKey('sk-1234567890abcdef');
  assert.equal(masked, 'sk-...cdef');
  assert.equal(maskApiKey(null), null);
  assert.equal(maskApiKey(''), null);
});

test('teste de conexão usa configuração efetiva resolvida do empreendimento', () => {
  const source = readFileSync(new URL('../services/enterpriseAiSettingsService.js', import.meta.url), 'utf8');
  assert.match(source, /const resolved = await resolveAiSettingsForEnterprise\(enterpriseId\);/);
  assert.match(source, /apiKey: resolved\.openaiApiKey/);
});

test('DTO seguro para frontend expõe somente chave mascarada', () => {
  const source = readFileSync(new URL('../services/enterpriseAiSettingsService.js', import.meta.url), 'utf8');
  assert.match(source, /masked_api_key:\s*maskApiKey\(enterpriseSettings\?\.openaiApiKey\)/);
  assert.doesNotMatch(source, /openai_api_key:\s*enterpriseSettings\?\.openaiApiKey/);
});
