import assert from 'node:assert/strict';
import test from 'node:test';
import { persistStateNode } from '../services/anaGraph/nodes/persistState.js';
import type { AnaGraphState } from '../services/anaGraph/state.js';

function baseState(overrides: Partial<AnaGraphState> = {}): AnaGraphState {
  return {
    conversationId: 19604,
    contactId: null,
    enterpriseId: 10,
    userMessage: '',
    metaMessageId: null,
    phoneNumberId: null,
    customerName: null,
    customerPhone: null,
    enterpriseName: 'Empreendimento Teste',
    enterpriseCity: 'São Paulo',
    conversationType: null,
    automationBlockedByHandoff: false,
    handoffBlockedReason: null,
    commercialFlowState: {},
    assistantReplyText: null,
    lastDecision: null,
    ...overrides,
  } as AnaGraphState;
}

test('persistStateNode grava purchaseIntent quando cliente responde "Morar" apos pergunta morar/investir', async () => {
  const state = baseState({
    userMessage: 'Morar',
    assistantReplyText: 'Perfeito! Já que é para morar, me conta mais sobre o que você procura.',
    commercialFlowState: {
      lastAssistantAskedPurchaseIntent: true,
    },
  });

  let persistedState: AnaGraphState['commercialFlowState'] | undefined;
  const result = await persistStateNode(state, {
    conversationId: 19604,
    persist: async (_conversationId, nextState) => {
      persistedState = nextState;
    },
    listActiveEnterprises: async () => [],
  });

  assert.equal(persistedState?.purchaseIntent, 'MORADIA');
  assert.equal(result.commercialFlowState?.purchaseIntent, 'MORADIA');
});

test('persistStateNode grava purchaseIntent AVALIANDO quando cliente responde "ainda estou avaliando" -- sem isso a pergunta morar/investir/avaliando ficava se repetindo pra sempre', async () => {
  const state = baseState({
    userMessage: 'ainda estou avaliando',
    assistantReplyText: 'Sem problema! Me conta mais sobre o que você procura.',
    commercialFlowState: {
      lastAssistantAskedPurchaseIntent: true,
    },
  });

  let persistedState: AnaGraphState['commercialFlowState'] | undefined;
  const result = await persistStateNode(state, {
    conversationId: 19604,
    persist: async (_conversationId, nextState) => {
      persistedState = nextState;
    },
    listActiveEnterprises: async () => [],
  });

  assert.equal(persistedState?.purchaseIntent, 'AVALIANDO');
  assert.equal(result.commercialFlowState?.purchaseIntent, 'AVALIANDO');
});

test('persistStateNode mantem purchaseIntent anterior quando o turno atual nao resolve o eixo', async () => {
  const state = baseState({
    userMessage: 'qual o valor do lote?',
    assistantReplyText: 'O valor varia conforme o lote, posso te ajudar com mais detalhes.',
    commercialFlowState: {
      purchaseIntent: 'MORADIA',
      purchaseIntentUpdatedAt: '2026-08-01T00:00:00.000Z',
    },
  });

  let persistedState: AnaGraphState['commercialFlowState'] | undefined;
  await persistStateNode(state, {
    conversationId: 19604,
    persist: async (_conversationId, nextState) => {
      persistedState = nextState;
    },
    listActiveEnterprises: async () => [],
  });

  assert.equal(persistedState?.purchaseIntent, 'MORADIA');
});

test('persistStateNode marca lastAssistantAskedPurchaseIntent quando a resposta pergunta morar x investir', async () => {
  const state = baseState({
    userMessage: 'quero saber mais',
    assistantReplyText: 'Você está pensando em morar ou investir?',
    commercialFlowState: {},
  });

  let persistedState: AnaGraphState['commercialFlowState'] | undefined;
  await persistStateNode(state, {
    conversationId: 19604,
    persist: async (_conversationId, nextState) => {
      persistedState = nextState;
    },
    listActiveEnterprises: async () => [],
  });

  assert.equal(persistedState?.lastAssistantAskedPurchaseIntent, true);
});
