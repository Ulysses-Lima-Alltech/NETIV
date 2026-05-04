import assert from 'node:assert/strict';
import test from 'node:test';
import {
  handleVisitSchedulingDeterministically,
  isAllowedVisitSlot,
  VISIT_WINDOW_END_MINUTES,
  VISIT_WINDOW_START_MINUTES,
} from '../utils/anaDirectVisitScheduling.js';
import type { CommercialFlowState } from '../utils/commercialFlowState.js';

const MONDAY_YMD = '2026-05-04';

test('janela oficial de visitas usa minutos do dia', () => {
  assert.equal(VISIT_WINDOW_START_MINUTES, 390);
  assert.equal(VISIT_WINDOW_END_MINUTES, 1170);
});

test('valida horarios permitidos na janela de visitas', () => {
  for (const timeHm of ['06:30', '07:00', '12:00', '18:00', '19:00', '19:30']) {
    assert.equal(isAllowedVisitSlot(MONDAY_YMD, timeHm), true, `${timeHm} deve ser permitido`);
  }
});

test('valida horarios recusados fora da janela de visitas', () => {
  for (const timeHm of ['06:00', '20:00']) {
    assert.equal(isAllowedVisitSlot(MONDAY_YMD, timeHm), false, `${timeHm} deve ser recusado`);
  }
});

test('fluxo deterministico confirma 18h e 19h30, mas recusa 20h e 06h', () => {
  const flowState: CommercialFlowState = {};

  for (const message of ['Quero agendar visita hoje as 18h', 'Quero agendar visita hoje as 19:30']) {
    const decision = handleVisitSchedulingDeterministically({
      userMessage: message,
      flowState,
      enterpriseId: 1,
      referenceNow: new Date(`${MONDAY_YMD}T12:00:00-03:00`),
    });

    assert.equal(decision.appointmentConfirmed, true, `${message} deve confirmar agendamento`);
    assert.equal(decision.reason, 'date_and_time_confirmed');
  }

  for (const message of ['Quero agendar visita hoje as 20h', 'Quero agendar visita hoje as 06:00']) {
    const decision = handleVisitSchedulingDeterministically({
      userMessage: message,
      flowState,
      enterpriseId: 1,
      referenceNow: new Date(`${MONDAY_YMD}T12:00:00-03:00`),
    });

    assert.equal(decision.appointmentConfirmed, false, `${message} deve ser recusado`);
    assert.equal(decision.reason, 'time_outside_visit_window');
    assert.equal(decision.reply, 'Esse horário fica fora da janela de visitas. Pode ser entre 6h30 e 19h30.');
  }
});
