import assert from 'node:assert/strict';
import test from 'node:test';
import { handleVisitSchedulingDeterministically } from '../utils/anaDirectVisitScheduling.js';
import type { AnaVisitAvailabilitySlot } from '../services/anaVisitAvailabilityService.js';

function slot(
  startYmd: string,
  timeHm: string,
  label: string,
  brokerId = 7
): AnaVisitAvailabilitySlot {
  const startAt = new Date(`${startYmd}T${timeHm}:00-03:00`);
  return {
    enterpriseId: 10,
    startAt,
    endAt: new Date(startAt.getTime() + 60 * 60_000),
    startYmd,
    timeHm,
    brokerId,
    eligibleBrokerCount: 1,
    timezone: 'America/Sao_Paulo',
    label,
  };
}

test('intencao inicial de visita oferece proximo slot disponivel sem perguntar dia e horario', () => {
  const suggestion = slot('2026-06-10', '14:00', 'amanhã às 14h');
  const decision = handleVisitSchedulingDeterministically({
    userMessage: 'Quero sim',
    flowState: {},
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    availabilitySuggestion: suggestion,
    availabilitySearchCompleted: true,
  });

  assert.equal(decision.reason, 'suggested_slot_offered');
  assert.equal(decision.appointmentConfirmed, false);
  assert.match(decision.reply ?? '', /amanhã às 14h/);
  assert.doesNotMatch(decision.reply ?? '', /qual dia|qual horário|dia e horário/i);
  assert.equal(decision.nextState.suggestedVisitStatus, 'awaiting_confirmation');
  assert.equal(decision.nextState.suggestedVisitStartAt, suggestion.startAt.toISOString());
  assert.equal(decision.nextState.suggestedVisitBrokerId, 7);
});

test('aceite do cliente confirma somente depois da revalidacao positiva', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'Quero visitar',
    flowState: {},
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    availabilitySuggestion: slot('2026-06-10', '14:00', 'amanhã às 14h', 7),
    availabilitySearchCompleted: true,
  });
  const accepted = handleVisitSchedulingDeterministically({
    userMessage: 'Pode ser',
    flowState: first.nextState,
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:01:00-03:00'),
    suggestedSlotValidation: {
      available: true,
      brokerId: 8,
      eligibleBrokerCount: 1,
    },
  });

  assert.equal(accepted.reason, 'suggested_slot_accepted');
  assert.equal(accepted.appointmentConfirmed, true);
  assert.equal(accepted.appointmentDateYmd, '2026-06-10');
  assert.equal(accepted.appointmentTimeHm, '14:00');
  assert.equal(accepted.appointmentBrokerId, 8);
  assert.match(accepted.reply ?? '', /visita ficou agendada/i);
});

test('aceite do cliente sem revalidacao explicita nao confirma', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'Quero visitar',
    flowState: {},
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    availabilitySuggestion: slot('2026-06-10', '14:00', 'amanhÃ£ Ã s 14h', 7),
    availabilitySearchCompleted: true,
  });
  const accepted = handleVisitSchedulingDeterministically({
    userMessage: 'Pode ser',
    flowState: first.nextState,
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:01:00-03:00'),
  });

  assert.equal(accepted.reason, 'suggested_slot_acceptance_missing_validation');
  assert.equal(accepted.appointmentConfirmed, false);
  assert.equal(accepted.appointmentDateYmd, null);
  assert.equal(accepted.appointmentTimeHm, null);
});

test('aceite revalidado como falso sem reposicao nao confirma', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'Quero visitar',
    flowState: {},
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    availabilitySuggestion: slot('2026-06-10', '14:00', 'amanhÃ£ Ã s 14h', 7),
    availabilitySearchCompleted: true,
  });
  const accepted = handleVisitSchedulingDeterministically({
    userMessage: 'Pode ser',
    flowState: first.nextState,
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:01:00-03:00'),
    suggestedSlotValidation: {
      available: false,
      brokerId: null,
      eligibleBrokerCount: 0,
    },
    suggestedSlotUnavailable: true,
  });

  assert.equal(accepted.reason, 'suggested_slot_unavailable_no_replacement');
  assert.equal(accepted.appointmentConfirmed, false);
});

test('aceite revalidado como indisponivel sugere outro slot', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'Quero visitar',
    flowState: {},
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    availabilitySuggestion: slot('2026-06-10', '14:00', 'amanhã às 14h', 7),
    availabilitySearchCompleted: true,
  });
  const replacement = slot('2026-06-10', '16:00', 'amanhã às 16h', 9);
  const decision = handleVisitSchedulingDeterministically({
    userMessage: 'Pode ser',
    flowState: first.nextState,
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:01:00-03:00'),
    suggestedSlotValidation: {
      available: false,
      brokerId: null,
      eligibleBrokerCount: 0,
    },
    suggestedSlotUnavailable: true,
    suggestedSlotReplacement: replacement,
  });

  assert.equal(decision.appointmentConfirmed, false);
  assert.equal(decision.reason, 'suggested_slot_unavailable_replaced');
  assert.match(decision.reply ?? '', /acabou ficando indisponível/i);
  assert.match(decision.reply ?? '', /amanhã às 16h/);
  assert.equal(decision.nextState.suggestedVisitStartAt, replacement.startAt.toISOString());
});

test('recusa com preferencia de periodo oferece nova opcao disponivel', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'Quero visitar',
    flowState: {},
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    availabilitySuggestion: slot('2026-06-10', '14:00', 'amanhã às 14h', 7),
    availabilitySearchCompleted: true,
  });
  const morning = slot('2026-06-10', '10:00', 'amanhã às 10h', 10);
  const decision = handleVisitSchedulingDeterministically({
    userMessage: 'Esse horário não dá, tem de manhã?',
    flowState: first.nextState,
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:01:00-03:00'),
    availabilitySuggestion: morning,
    availabilitySearchCompleted: true,
  });

  assert.equal(decision.reason, 'suggested_slot_replaced_by_customer_preference');
  assert.equal(decision.appointmentConfirmed, false);
  assert.match(decision.reply ?? '', /outra opção/);
  assert.match(decision.reply ?? '', /amanhã às 10h/);
  assert.equal(decision.nextState.suggestedVisitBrokerId, 10);
});

test('novo horario apos sugestao usa sugestao validada e nao ready_to_confirm_visit', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'Quero visitar',
    flowState: {},
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    availabilitySuggestion: slot('2026-06-10', '14:00', 'amanhÃ£ Ã s 14h', 7),
    availabilitySearchCompleted: true,
  });
  const morning = slot('2026-06-10', '10:00', 'amanhÃ£ Ã s 10h', 10);
  const decision = handleVisitSchedulingDeterministically({
    userMessage: 'Esse horÃ¡rio nÃ£o dÃ¡, amanhÃ£ Ã s 10h?',
    flowState: first.nextState,
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:01:00-03:00'),
    availabilitySuggestion: morning,
    availabilitySearchCompleted: true,
  });

  assert.equal(decision.reason, 'suggested_slot_replaced_by_customer_preference');
  assert.notEqual(decision.reason, 'ready_to_confirm_visit');
  assert.equal(decision.appointmentConfirmed, false);
  assert.equal(decision.nextState.pendingVisitTime, '10:00');
  assert.equal(decision.nextState.suggestedVisitBrokerId, 10);
});

test('novo horario indisponivel apos sugestao recebe proxima opcao valida', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'Quero visitar',
    flowState: {},
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    availabilitySuggestion: slot('2026-06-10', '14:00', 'amanhÃ£ Ã s 14h', 7),
    availabilitySearchCompleted: true,
  });
  const replacement = slot('2026-06-10', '11:00', 'amanhÃ£ Ã s 11h', 11);
  const decision = handleVisitSchedulingDeterministically({
    userMessage: 'Esse horÃ¡rio nÃ£o dÃ¡, amanhÃ£ Ã s 10h?',
    flowState: first.nextState,
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:01:00-03:00'),
    exactSlotUnavailableReplacement: replacement,
    exactSlotUnavailable: true,
    availabilitySearchCompleted: true,
  });

  assert.equal(decision.reason, 'requested_slot_unavailable_replaced_after_suggestion');
  assert.equal(decision.appointmentConfirmed, false);
  assert.equal(decision.nextState.pendingVisitTime, '11:00');
});

test('troca de sugestao sem revalidacao nao cai em confirmacao manual', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'Quero visitar',
    flowState: {},
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    availabilitySuggestion: slot('2026-06-10', '14:00', 'amanhÃ£ Ã s 14h', 7),
    availabilitySearchCompleted: true,
  });
  const decision = handleVisitSchedulingDeterministically({
    userMessage: 'Esse horÃ¡rio nÃ£o dÃ¡, amanhÃ£ Ã s 10h?',
    flowState: first.nextState,
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:01:00-03:00'),
  });

  assert.equal(decision.reason, 'suggested_slot_change_requires_revalidation');
  assert.notEqual(decision.reason, 'ready_to_confirm_visit');
  assert.equal(decision.appointmentConfirmed, false);
});

test('pedido de outro dia recebe slot diferente do sugerido anterior', () => {
  const first = handleVisitSchedulingDeterministically({
    userMessage: 'Quero visitar',
    flowState: {},
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    availabilitySuggestion: slot('2026-06-10', '14:00', 'amanhÃ£ Ã s 14h', 7),
    availabilitySearchCompleted: true,
  });
  const otherDay = slot('2026-06-11', '09:00', 'quinta Ã s 9h', 12);
  const decision = handleVisitSchedulingDeterministically({
    userMessage: 'Pode ser outro dia?',
    flowState: first.nextState,
    enterpriseId: 10,
    customerName: 'Ulysses',
    customerPhone: '11999990000',
    referenceNow: new Date('2026-06-09T13:01:00-03:00'),
    availabilitySuggestion: otherDay,
    availabilitySearchCompleted: true,
  });

  assert.equal(decision.reason, 'suggested_slot_replaced_by_customer_preference');
  assert.notEqual(decision.nextState.suggestedVisitStartAt, first.nextState.suggestedVisitStartAt);
  assert.equal(decision.nextState.pendingVisitDate, '2026-06-11');
});
