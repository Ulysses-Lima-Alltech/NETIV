import assert from 'node:assert/strict';
import test from 'node:test';
import { routeAfterAiAvailabilityGate } from '../services/anaGraph/graph.js';
import { aiBlockedReplyNode } from '../services/anaGraph/nodes/aiBlockedReply.js';
import type { AnaGraphState } from '../services/anaGraph/state.js';

function baseState(overrides: Partial<AnaGraphState> = {}): AnaGraphState {
  return {
    conversationId: 1,
    contactId: null,
    enterpriseId: 10,
    userMessage: 'oi',
    metaMessageId: null,
    phoneNumberId: null,
    customerName: null,
    customerPhone: '11999999999',
    enterpriseName: 'Empreendimento Teste',
    enterpriseCity: 'São Paulo',
    conversationType: null,
    automationBlockedByHandoff: false,
    handoffBlockedReason: null,
    aiBlocked: false,
    aiBlockedReplyText: null,
    commercialFlowState: {},
    assistantReplyText: null,
    replyIntentionallyEmpty: false,
    lastDecision: null,
    ...overrides,
  } as AnaGraphState;
}

test('routeAfterAiAvailabilityGate vai pra aiBlockedReply quando aiBlocked=true', () => {
  const state = baseState({ aiBlocked: true, aiBlockedReplyText: 'empreendimento bloqueado' });
  assert.equal(routeAfterAiAvailabilityGate(state), 'aiBlockedReply');
});

test('routeAfterAiAvailabilityGate segue pro fluxo normal quando aiBlocked=false', () => {
  const state = baseState({ aiBlocked: false });
  assert.equal(routeAfterAiAvailabilityGate(state), 'classifyLeadTurn');
});

test('aiBlockedReplyNode envia a mensagem de bloqueio emergencial e persiste como assistant -- sem isso o toggle "Bloqueio emergencial ativo" nao tinha efeito nenhum pra empreendimentos no grafo novo', async () => {
  const state = baseState({
    aiBlocked: true,
    aiBlockedReplyText: 'Atendimento temporariamente pausado, já já retomamos.',
  });

  const sendCalls: Array<{ conversationId: number; to: string; text: string; phase: string }> = [];
  const insertCalls: Array<{ conversationId: number; text: string; metaMessageId: string }> = [];

  const result = await aiBlockedReplyNode(state, {
    conversationId: state.conversationId,
    toPhoneNumber: state.customerPhone ?? '',
    sendText: async (params) => {
      sendCalls.push(params);
      return { success: true, metaMessageId: 'wamid.blocked-1' };
    },
    insertAssistantMessage: async (conversationId, text, metaMessageId) => {
      insertCalls.push({ conversationId, text, metaMessageId });
    },
  });

  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0]?.text, 'Atendimento temporariamente pausado, já já retomamos.');
  assert.equal(sendCalls[0]?.to, '11999999999');
  assert.equal(insertCalls.length, 1);
  assert.equal(insertCalls[0]?.text, 'Atendimento temporariamente pausado, já já retomamos.');
  assert.equal(result.assistantReplyText, 'Atendimento temporariamente pausado, já já retomamos.');
  assert.equal(result.replyIntentionallyEmpty, true);
});

test('aiBlockedReplyNode fica em silencio (nao envia nada) quando aiBlockedReplyText e null -- caso ana_model_not_configured', async () => {
  const state = baseState({ aiBlocked: true, aiBlockedReplyText: null });

  let sendCalled = false;
  const result = await aiBlockedReplyNode(state, {
    conversationId: state.conversationId,
    toPhoneNumber: state.customerPhone ?? '',
    sendText: async () => {
      sendCalled = true;
      return { success: true, metaMessageId: 'wamid.x' };
    },
    insertAssistantMessage: async () => {},
  });

  assert.equal(sendCalled, false);
  assert.equal(result.assistantReplyText, null);
  assert.equal(result.replyIntentionallyEmpty, true);
});
