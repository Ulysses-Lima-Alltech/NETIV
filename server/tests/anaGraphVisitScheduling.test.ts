import assert from 'node:assert/strict';
import test from 'node:test';
import { visitSchedulingNode } from '../services/anaGraph/nodes/visitScheduling.js';
import type { AnaGraphState } from '../services/anaGraph/state.js';
import type { AnaVisitSlotAvailabilityChecker } from '../services/anaVisitAvailabilityService.js';

function baseState(overrides: Partial<AnaGraphState> = {}): AnaGraphState {
  return {
    conversationId: 1,
    contactId: null,
    enterpriseId: 10,
    userMessage: '',
    metaMessageId: null,
    phoneNumberId: null,
    customerName: 'Cliente Teste',
    customerPhone: '11999999999',
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

test('visitSchedulingNode nao agenda horario indisponivel so porque o cliente digitou', async () => {
  const checker: AnaVisitSlotAvailabilityChecker = async () => ({
    available: false,
    brokerId: null,
    eligibleBrokerCount: 0,
  });

  let persisted = false;
  const state = baseState({ userMessage: 'quero visitar amanha as 14h' });
  const result = await visitSchedulingNode(state, {
    conversationId: 1,
    enterpriseId: 10,
    enterpriseCity: 'São Paulo',
    customerName: 'Cliente Teste',
    customerPhone: '11999999999',
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    checkSlotAvailability: checker,
    persistAppointment: async () => {
      persisted = true;
      return { id: 1 } as any;
    },
  });

  assert.equal(persisted, false);
  assert.equal(result.visitDecision.appointmentConfirmed, false);
});

test('visitSchedulingNode consulta disponibilidade real (nao aceita cegamente) ao validar slot exato digitado', async () => {
  let checkerCalls = 0;
  const checker: AnaVisitSlotAvailabilityChecker = async () => {
    checkerCalls += 1;
    return { available: true, brokerId: 42, eligibleBrokerCount: 1 };
  };

  const state = baseState({ userMessage: 'quero visitar dia 2026-06-10 as 14h' });
  const result = await visitSchedulingNode(state, {
    conversationId: 1,
    enterpriseId: 10,
    enterpriseCity: 'São Paulo',
    customerName: 'Cliente Teste',
    customerPhone: '11999999999',
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    checkSlotAvailability: checker,
    persistAppointment: async () => ({ id: 1 }) as any,
  });

  assert.ok(checkerCalls > 0, 'checkSlotAvailability deveria ter sido chamado para validar o slot digitado');
  assert.equal(result.visitDecision.handled, true);
});
