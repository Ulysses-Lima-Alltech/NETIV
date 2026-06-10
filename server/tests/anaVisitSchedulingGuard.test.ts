import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('applyAnaVisitSchedulingGuard existe com estado estruturado e logs', () => {
  const source = readFileSync(new URL('../utils/anaVisitSchedulingGuard.ts', import.meta.url), 'utf8');
  assert.match(source, /applyAnaVisitSchedulingGuard/);
  assert.match(source, /collecting_date|collecting_time|collecting_name|ready_to_confirm|scheduled/);
  assert.match(source, /Para qual dia você prefere agendar a visita\?/);
  assert.match(source, /Qual horário você prefere/);
  assert.match(source, /Me passa seu nome para deixar a visita agendada\?/);
  assert.match(source, /sua visita ficou agendada/);
  assert.match(source, /v\.active = false/);
  assert.match(source, /isNegativeVisitAck/);
  assert.match(source, /visit_slot_declined/);
});

test('guard cobre domingo e horario fora da janela', () => {
  const source = readFileSync(new URL('../utils/anaVisitSchedulingGuard.ts', import.meta.url), 'utf8');
  assert.match(source, /conforme disponibilidade da agenda/);
  assert.match(source, /09h às 18h/);
  assert.doesNotMatch(source, /sunday_not_allowed/);
});
