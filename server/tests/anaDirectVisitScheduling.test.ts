import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateVisitDateTimeSlot, isAllowedVisitSlot } from '../utils/anaDirectVisitScheduling.js';

test('janela de visita oficial esta em 09h-18h e sem faixa antiga', () => {
  const source = readFileSync(new URL('../utils/anaDirectVisitScheduling.ts', import.meta.url), 'utf8');
  assert.match(source, /VISIT_WINDOW_START_MINUTES\s*=\s*9\s*\*\s*60/);
  assert.match(source, /VISIT_WINDOW_END_MINUTES\s*=\s*18\s*\*\s*60/);
  assert.doesNotMatch(source, /6h30|19h30/);
});

test('mensagens de domingo e horario fora da janela estao corretas', () => {
  const source = readFileSync(new URL('../utils/anaDirectVisitScheduling.ts', import.meta.url), 'utf8');
  assert.match(source, /conforme disponibilidade da agenda/);
  assert.match(source, /09h às 18h/);
  assert.match(source, /fora do período (?:disponível para|de) visitas/);
  assert.doesNotMatch(source, /Só preciso que você me diga o horário para agendar sua visita/);
  assert.doesNotMatch(source, /sunday_not_allowed/);
});

test('domingo (2026-06-14) so permite ate 14h, sabado (2026-06-13) permite ate 18h', () => {
  assert.equal(validateVisitDateTimeSlot('2026-06-14', '14:00').valid, true);
  assert.equal(validateVisitDateTimeSlot('2026-06-14', '15:00').valid, false);
  assert.equal(validateVisitDateTimeSlot('2026-06-14', '15:00').reason, 'outside_visit_window');
  assert.equal(validateVisitDateTimeSlot('2026-06-13', '17:00').valid, true);
  assert.equal(validateVisitDateTimeSlot('2026-06-13', '18:00').valid, true);

  assert.equal(isAllowedVisitSlot('2026-06-14', '14:00'), true);
  assert.equal(isAllowedVisitSlot('2026-06-14', '15:00'), false);
  assert.equal(isAllowedVisitSlot('2026-06-13', '17:00'), true);
});
