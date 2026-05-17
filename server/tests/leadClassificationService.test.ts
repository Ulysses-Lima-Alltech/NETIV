import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyLeadConversation,
  type ClassifyLeadConversationInput,
  type EnterpriseAliasRowInput,
} from '../services/leadClassificationService.js';
import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';

function enterprise(id: number, name: string, slug: string): EnterpriseRow {
  return {
    id,
    name,
    slug,
    status: 'ativo',
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

const enterprises: EnterpriseRow[] = [
  enterprise(1, 'Residencial Evora', 'residencial-evora'),
  enterprise(2, 'EcoGarden', 'ecogarden'),
  enterprise(3, 'Montaresa', 'montaresa'),
  enterprise(4, 'Altis', 'altis'),
];

const aliases: EnterpriseAliasRowInput[] = [
  { enterprise_id: 1, alias: 'Evora', normalized_alias: 'evora' },
  { enterprise_id: 2, alias: 'Eco Garden', normalized_alias: 'eco garden' },
  { enterprise_id: 2, alias: 'EcoGardem', normalized_alias: 'ecogardem' },
  { enterprise_id: 2, alias: 'Ecogardwn', normalized_alias: 'ecogardwn' },
];

function baseInput(message: string): ClassifyLeadConversationInput {
  return {
    conversationId: 101,
    contactId: 55,
    latestCustomerMessage: message,
    recentMessages: [{ role: 'user' as const, content: message }],
    currentTemperature: null,
    currentEnterpriseId: null,
    currentFunnelStatus: 'Novo',
    availableEnterprises: enterprises,
    enterpriseAliasRows: aliases,
    manualOverrideFlags: {
      temperature: false,
      enterprise: false,
    },
  };
}

function okConfig() {
  return {
    openaiApiKey: 'sk-test',
    openaiBaseUrl: 'https://api.openai.com/v1',
    modelColdLead: 'gpt-4.1-mini',
    modelHotLead: 'gpt-4.1',
    maxTokens: 700,
  };
}

test('lead novo sem temperatura vira Frio mesmo se IA falhar', async () => {
  const result = await classifyLeadConversation(baseInput('Oi'), {
    loadOpenAIConfig: async () => okConfig(),
    generateCompletion: async () => ({ success: false, error: 'provider_error' }),
  });
  assert.equal(result.temperature, 'Frio');
  assert.equal(result.shouldUpdateTemperature, true);
  assert.equal(result.source, 'fallback');
});

test('mensagem "Gostaria de informacoes sobre os terrenos" vira Morno com IA', async () => {
  const result = await classifyLeadConversation(baseInput('Gostaria de informacoes sobre os terrenos'), {
    loadOpenAIConfig: async () => okConfig(),
    generateCompletion: async () => ({
      success: true,
      content: JSON.stringify({
        temperature: 'Morno',
        temperatureConfidence: 0.9,
        temperatureReason: 'interesse comercial',
        enterpriseId: null,
        enterpriseName: null,
        enterpriseConfidence: 0.1,
        enterpriseReason: 'sem empreendimento',
        funnelStatus: 'Qualificado',
        funnelConfidence: 0.86,
        mainIntent: 'informacoes_gerais',
        shouldUpdateTemperature: true,
        shouldUpdateEnterprise: false,
        shouldUpdateFunnel: true,
      }),
    }),
  });
  assert.equal(result.temperature, 'Morno');
  assert.equal(result.shouldUpdateTemperature, true);
});

test('mensagem "Ecogardwn" identifica EcoGarden se existir no banco', async () => {
  const result = await classifyLeadConversation(baseInput('Tenho interesse no Ecogardwn'), {
    loadOpenAIConfig: async () => okConfig(),
    generateCompletion: async () => ({
      success: true,
      content: JSON.stringify({
        temperature: 'Morno',
        temperatureConfidence: 0.88,
        temperatureReason: 'interesse em empreendimento',
        enterpriseId: null,
        enterpriseName: 'Ecogardwn',
        enterpriseConfidence: 0.91,
        enterpriseReason: 'erro de digitacao reconhecido',
        funnelStatus: 'Qualificado',
        funnelConfidence: 0.8,
        mainIntent: 'informacoes_gerais',
        shouldUpdateTemperature: true,
        shouldUpdateEnterprise: true,
        shouldUpdateFunnel: true,
      }),
    }),
  });
  assert.equal(result.enterpriseId, 2);
  assert.equal(result.shouldUpdateEnterprise, true);
});

test('mensagem "Quero agendar uma visita" vira Quente', async () => {
  const result = await classifyLeadConversation(baseInput('Quero agendar uma visita'), {
    loadOpenAIConfig: async () => okConfig(),
    generateCompletion: async () => ({
      success: true,
      content: JSON.stringify({
        temperature: 'Quente',
        temperatureConfidence: 0.95,
        temperatureReason: 'intencao de visita',
        enterpriseId: null,
        enterpriseName: null,
        enterpriseConfidence: 0.2,
        enterpriseReason: 'sem contexto de empreendimento',
        funnelStatus: 'Qualificado',
        funnelConfidence: 0.84,
        mainIntent: 'visita',
        shouldUpdateTemperature: true,
        shouldUpdateEnterprise: false,
        shouldUpdateFunnel: true,
      }),
    }),
  });
  assert.equal(result.temperature, 'Quente');
  assert.equal(result.shouldUpdateTemperature, true);
});

test('baixa confianca nao altera empreendimento', async () => {
  const result = await classifyLeadConversation(baseInput('Quero saber do Evora'), {
    loadOpenAIConfig: async () => okConfig(),
    generateCompletion: async () => ({
      success: true,
      content: JSON.stringify({
        temperature: 'Morno',
        temperatureConfidence: 0.82,
        temperatureReason: 'interesse comercial',
        enterpriseId: 1,
        enterpriseName: 'Evora',
        enterpriseConfidence: 0.5,
        enterpriseReason: 'baixa confianca',
        funnelStatus: 'Qualificado',
        funnelConfidence: 0.81,
        mainIntent: 'informacoes_gerais',
        shouldUpdateTemperature: true,
        shouldUpdateEnterprise: true,
        shouldUpdateFunnel: true,
      }),
    }),
  });
  assert.equal(result.shouldUpdateEnterprise, false);
});

test('override manual impede atualizacao automatica', async () => {
  const input = baseInput('Quero saber do Evora');
  input.manualOverrideFlags.enterprise = true;
  input.manualOverrideFlags.temperature = true;
  input.currentTemperature = 'morno';
  const result = await classifyLeadConversation(input, {
    loadOpenAIConfig: async () => okConfig(),
    generateCompletion: async () => ({
      success: true,
      content: JSON.stringify({
        temperature: 'Quente',
        temperatureConfidence: 0.93,
        temperatureReason: 'lead quente',
        enterpriseId: 1,
        enterpriseName: 'Evora',
        enterpriseConfidence: 0.92,
        enterpriseReason: 'match claro',
        funnelStatus: 'Qualificado',
        funnelConfidence: 0.8,
        mainIntent: 'preco',
        shouldUpdateTemperature: true,
        shouldUpdateEnterprise: true,
        shouldUpdateFunnel: true,
      }),
    }),
  });
  assert.equal(result.shouldUpdateTemperature, false);
  assert.equal(result.shouldUpdateEnterprise, false);
});

test('IA nao pode retornar empreendimento inexistente', async () => {
  const result = await classifyLeadConversation(baseInput('Quero saber do projeto X'), {
    loadOpenAIConfig: async () => okConfig(),
    generateCompletion: async () => ({
      success: true,
      content: JSON.stringify({
        temperature: 'Morno',
        temperatureConfidence: 0.76,
        temperatureReason: 'interesse',
        enterpriseId: 9999,
        enterpriseName: 'Projeto X',
        enterpriseConfidence: 0.95,
        enterpriseReason: 'nao existe',
        funnelStatus: 'Qualificado',
        funnelConfidence: 0.71,
        mainIntent: 'informacoes_gerais',
        shouldUpdateTemperature: true,
        shouldUpdateEnterprise: true,
        shouldUpdateFunnel: true,
      }),
    }),
  });
  assert.equal(result.enterpriseId, null);
  assert.equal(result.shouldUpdateEnterprise, false);
});

test('resposta invalida da IA nao quebra o fluxo', async () => {
  const result = await classifyLeadConversation(baseInput('Oi'), {
    loadOpenAIConfig: async () => okConfig(),
    generateCompletion: async () => ({
      success: true,
      content: 'nao eh json',
    }),
  });
  assert.equal(result.source, 'fallback');
  assert.equal(result.shouldUpdateTemperature, true);
});

test('falha do provedor de IA nao impede processamento do classificador', async () => {
  const result = await classifyLeadConversation(baseInput('Oi'), {
    loadOpenAIConfig: async () => okConfig(),
    generateCompletion: async () => {
      throw new Error('timeout');
    },
  });
  assert.equal(result.source, 'fallback');
  assert.equal(result.temperature, 'Frio');
});

test('nao reduz Quente para Frio por mensagem neutra unica', async () => {
  const input = baseInput('ok');
  input.currentTemperature = 'quente';
  input.recentMessages = [{ role: 'user', content: 'ok' }];
  const result = await classifyLeadConversation(input, {
    loadOpenAIConfig: async () => okConfig(),
    generateCompletion: async () => ({
      success: true,
      content: JSON.stringify({
        temperature: 'Frio',
        temperatureConfidence: 0.92,
        temperatureReason: 'mensagem curta',
        enterpriseId: null,
        enterpriseName: null,
        enterpriseConfidence: 0.2,
        enterpriseReason: 'nao citado',
        funnelStatus: 'Novo',
        funnelConfidence: 0.7,
        mainIntent: 'saudacao',
        shouldUpdateTemperature: true,
        shouldUpdateEnterprise: false,
        shouldUpdateFunnel: false,
      }),
    }),
  });
  assert.equal(result.shouldUpdateTemperature, false);
});
