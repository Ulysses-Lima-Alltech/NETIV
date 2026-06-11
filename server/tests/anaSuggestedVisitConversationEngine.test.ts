import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const sourceUrl = new URL('../services/conversationEngine.ts', import.meta.url);
const distRunSourceUrl = new URL('../../services/conversationEngine.ts', import.meta.url);
const engine = readFileSync(existsSync(sourceUrl) ? sourceUrl : distRunSourceUrl, 'utf8');

test('engine valida novo horario explicito apos sugestao pendente', () => {
  assert.match(engine, /explicitExactSlotAfterSuggestion/);
  assert.match(engine, /messageHasExplicitTime/);
  assert.match(engine, /validateVisitSlotStillAvailable\(\{/);
  assert.match(engine, /formatAnaVisitSlotLabel\(\{ startYmd: exactDateYmd, timeHm: exactTimeHm \}/);
});

test('engine nao reutiliza slot recusado em pedido de alternativa', () => {
  assert.match(engine, /suggestedSlotAlternativeDayRequested/);
  assert.match(engine, /alternativeSlotSearchAccepted/);
  assert.match(engine, /suggestedVisitDeclinedStartAt/);
  assert.match(engine, /addDaysYmdForAnaVisitAvailability\(flowStateParsed\.pendingVisitDate, 1\)/);
  assert.match(engine, /excludeStartAt:\s*alternativeSlotSearchAccepted/);
  assert.match(engine, /\?\s*declinedSuggestedStartAt/);
});

test('engine da prioridade para negativa explicita de horario sugerido', () => {
  assert.match(engine, /isExplicitVisitSchedulingNegativeMessage\(trimmed\)/);
  assert.match(engine, /!explicitVisitSchedulingNegativeThisTurn/);
  assert.match(engine, /!userRefusedScheduling \|\| explicitVisitSchedulingNegativeThisTurn/);
  assert.match(engine, /directVisitDeclinedSuggestedSlot/);
  assert.match(engine, /cancelAnaVisitFollowupForConversation\(\{\s*conversationId,\s*reason: directVisitSchedulingDecision\.reason/);
});
