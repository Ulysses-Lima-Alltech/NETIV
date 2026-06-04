import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const visit = fs.readFileSync(new URL('../utils/anaDirectVisitScheduling.ts', import.meta.url), 'utf8');

test('periodo de lifestyle nao vira visita por estado pendente', () => {
  assert.match(visit, /function isLikelyLifestylePeriodAnswer/);
  assert.match(visit, /isLikelyLifestylePeriodAnswer\(input\.userMessage, input\.lastAssistantMessage\)\) return false/);
});

test('fim de tarde so vira slot se ultima pergunta for de agenda', () => {
  assert.match(visit, /if \(periodMentionForSlotAnswer != null\)/);
  assert.match(visit, /isLikelyLifestylePeriodAnswer\(userMessage, input\.lastAssistantMessage\)\) return false/);
  assert.match(visit, /return assistantAskedVisitSlotContext/);
});

test('continuacao por periodo exige contexto real de visita', () => {
  assert.match(visit, /function assistantAskedVisitSlotOrOfferContext/);
  assert.match(visit, /assistantAskedVisitSlotOrOfferContext\(input\.lastAssistantMessage\)/);
  assert.match(visit, /parsePeriodFromText\(input\.userMessage\) &&/);
});

test('detector reconhece perguntas de lifestyle como nao agenda', () => {
  assert.match(visit, /valorizaria/);
  assert.match(visit, /cenario\|cenário/);
  assert.match(visit, /momento ideal/);
  assert.match(visit, /tipo de ambiente/);
});