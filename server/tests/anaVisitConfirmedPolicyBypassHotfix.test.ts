import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
const visit = fs.readFileSync(new URL('../utils/anaDirectVisitScheduling.ts', import.meta.url), 'utf8');

test('visita confirmada nao deve passar pelo applyAnaConversationPolicy de visita', () => {
  assert.match(engine, /\[ANA_VISIT_POLICY_SKIPPED_FOR_CONFIRMED_APPOINTMENT\]/);
  assert.match(engine, /if \(directVisitSchedulingDecision\.appointmentConfirmed !== true\)/);
  assert.match(engine, /appointmentConfirmed: true/);
});

test('confirmacao reconstruida continua registrada como agendamento confirmado', () => {
  assert.match(engine, /directVisitSchedulingDecision\.appointmentConfirmed/);
  assert.match(engine, /source: 'direct_visit_confirmed'/);
  assert.match(engine, /status: 'scheduled' as const/);
});

test('frase de aceite de visita nao pode virar nome do cliente', () => {
  assert.match(visit, /\[ANA_VISIT_LOOSE_NAME_IGNORED_VISIT_ACCEPTANCE\]/);
  assert.match(visit, /isExplicitVisitSchedulingAcceptance\(raw\) \|\| hasVisitSchedulingWords\(raw\)/);
});

test('blocklist inclui tokens de aceite de visita', () => {
  assert.match(visit, /'vou'/);
  assert.match(visit, /'quero'/);
  assert.match(visit, /'visitar'/);
  assert.match(visit, /'entao'/);
  assert.match(visit, /'então'/);
});