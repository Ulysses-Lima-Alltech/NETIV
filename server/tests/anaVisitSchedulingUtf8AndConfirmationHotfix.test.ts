import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const visit = fs.readFileSync(new URL('../utils/anaDirectVisitScheduling.ts', import.meta.url), 'utf8');

const forbiddenMojibakePattern = new RegExp(
  `[${String.fromCharCode(0x00c3)}${String.fromCharCode(0x00c2)}${String.fromCharCode(0x0192)}]`
);

test('modulo de visita nao pode conter mojibake', () => {
  assert.doesNotMatch(visit, forbiddenMojibakePattern);
  assert.match(visit, /amanhã/);
  assert.match(visit, /horário/);
  assert.match(visit, /você/);
  assert.match(visit, /às/);
});

test('vou visitar entao e quero visitar la entram como aceite explicito de visita', () => {
  assert.match(visit, /vou visitar/);
  assert.match(visit, /vou visitar entao/);
  assert.match(visit, /vou visitar então/);
  assert.match(visit, /quero visitar la/);
  assert.match(visit, /quero visitar lá/);
});

test('visitar stand e empreendimento entram no fluxo de visita', () => {
  assert.match(visit, /visitar o stand/);
  assert.match(visit, /visitar o empreendimento/);
  assert.match(visit, /quero conhecer o stand/);
  assert.match(visit, /conhecer o stand/);
});

test('data e horario no mesmo turno limpam periodo pendente antigo', () => {
  assert.match(visit, /shouldClearStalePendingPeriod/);
  assert.match(visit, /Boolean\(dateMention && timeHm && !period\)/);
  assert.match(visit, /period \?\? \(shouldClearStalePendingPeriod \? null : pendingPeriod\)/);
});

test('sim apos posso confirmar sua visita independe de estado pending', () => {
  assert.match(visit, /if \(userVisitConfirmation && assistantAskedVisitConfirmation\(input\.lastAssistantMessage\)\)/);
  assert.doesNotMatch(visit, /if \(!pending && userVisitConfirmation && assistantAskedVisitConfirmation/);
});

test('continuacao textual por tarde ou noite exige contexto real de visita', () => {
  assert.match(visit, /assistantAskedVisitSlotOrOfferContext\(input\.lastAssistantMessage\)/);
  assert.match(visit, /isLikelyLifestylePeriodAnswer\(input\.userMessage, input\.lastAssistantMessage\)/);
});

test('frases de confirmacao usam UTF-8 correto', () => {
  assert.match(visit, /Perfeito\. Posso confirmar sua visita para/);
  assert.match(visit, /Perfeito, sua visita ficou agendada para/);
  assert.match(visit, /às \$\{displayTime\}/);
});