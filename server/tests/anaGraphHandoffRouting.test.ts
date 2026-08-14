import assert from 'node:assert/strict';
import test from 'node:test';
import { routeAfterReplyOrHandoff, routeAfterFinalizeReply } from '../services/anaGraph/graph.js';
import { humanHandoffNode } from '../services/anaGraph/nodes/humanHandoff.js';
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
    commercialFlowState: {},
    assistantReplyText: null,
    replyIntentionallyEmpty: false,
    lastDecision: null,
    ...overrides,
  } as AnaGraphState;
}

test('routeAfterReplyOrHandoff vai para humanHandoff quando nao ha texto nem silencio intencional', () => {
  const state = baseState({ assistantReplyText: null, replyIntentionallyEmpty: false });
  assert.equal(routeAfterReplyOrHandoff(state), 'humanHandoff');
});

test('routeAfterReplyOrHandoff segue para finalizeReply quando ha texto', () => {
  const state = baseState({ assistantReplyText: 'resposta real' });
  assert.equal(routeAfterReplyOrHandoff(state), 'finalizeReply');
});

test('routeAfterReplyOrHandoff segue para finalizeReply quando silencio e intencional (material ja enviado)', () => {
  const state = baseState({ assistantReplyText: null, replyIntentionallyEmpty: true });
  assert.equal(routeAfterReplyOrHandoff(state), 'finalizeReply');
});

test('routeAfterFinalizeReply vai para humanHandoff quando finalizeReply zera o rascunho', () => {
  const state = baseState({ assistantReplyText: null, replyIntentionallyEmpty: false });
  assert.equal(routeAfterFinalizeReply(state), 'humanHandoff');
});

test('humanHandoffNode muda status pra Handoff mesmo quando assignBroker nao atribui corretor (reason fora da whitelist)', async () => {
  const state = baseState();
  let classificationUpdatedForConversationId: number | null = null;

  const result = await humanHandoffNode(state, {
    conversationId: 42,
    toPhoneNumber: '11999999999',
    reason: 'insufficient_evidence',
    sendTextMessage: async () => ({ success: true }),
    insertAssistantMessage: async () => null,
    assignBroker: async () => null,
    updateHandoffClassification: async (conversationId) => {
      classificationUpdatedForConversationId = conversationId;
      return null;
    },
  });

  assert.equal(classificationUpdatedForConversationId, 42);
  assert.equal(result.automationBlockedByHandoff, true);
});
