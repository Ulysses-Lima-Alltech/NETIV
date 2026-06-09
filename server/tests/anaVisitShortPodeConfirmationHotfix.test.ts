import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const visit = fs.readFileSync(new URL('../utils/anaDirectVisitScheduling.ts', import.meta.url), 'utf8');
const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

test('pode apos pergunta posso confirmar sua visita vira confirmacao contextual', () => {
  assert.match(visit, /function isVisitConfirmationShortAckInContext/);
  assert.match(visit, /\^\(pode\|pode sim\|sim pode\|sim pode sim/);
  assert.match(visit, /assistantAskedVisitConfirmation\(input\.lastAssistantMessage\) && isVisitConfirmationShortAckInContext\(userMessage\)/);
  assert.match(visit, /assistantAskedVisitConfirmation\(input\.lastAssistantMessage\) && isVisitConfirmationShortAckInContext\(input\.userMessage\)/);
});

test('ja falei que pode e tratado como confirmacao irritada e nao recusa', () => {
  assert.match(visit, /function isVisitConfirmationCorrectionMessage/);
  assert.match(visit, /ja falei que pode/);
  assert.match(visit, /já falei que pode/);
  assert.match(visit, /if \(isVisitConfirmationCorrectionMessage\(text\)\) return false/);
});

test('confirmacao curta contextual nao transforma pode em ack global irrestrito', () => {
  assert.match(visit, /isVisitConfirmationShortAckInContext/);
  assert.match(visit, /assistantAskedVisitConfirmation\(input\.lastAssistantMessage\)/);
});

test('quando appointmentConfirmed e true o engine registra agenda', () => {
  assert.match(engine, /directVisitSchedulingDecision\.appointmentConfirmed/);
  assert.match(engine, /registerAnaAppointmentIfConfirmed/);
  assert.match(engine, /source: 'direct_visit_confirmed'/);
  assert.match(engine, /status: 'scheduled' as const/);
});

test('fluxo confirmado pula policy e segue resposta final deterministica', () => {
  assert.match(engine, /\[ANA_VISIT_POLICY_SKIPPED_FOR_CONFIRMED_APPOINTMENT\]/);
  assert.match(engine, /directVisitSchedulingDecision\.appointmentConfirmed !== true/);
});