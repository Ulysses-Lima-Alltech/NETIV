import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const engine = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

test('engine valida novo horario explicito apos sugestao pendente', () => {
  assert.match(engine, /explicitExactSlotAfterSuggestion/);
  assert.match(engine, /messageHasExplicitTime/);
  assert.match(engine, /validateVisitSlotStillAvailable\(\{/);
  assert.match(engine, /formatAnaVisitSlotLabel\(\{ startYmd: exactDateYmd, timeHm: exactTimeHm \}/);
});

test('engine nao reutiliza slot recusado em pedido de alternativa', () => {
  assert.match(engine, /suggestedSlotAlternativeDayRequested/);
  assert.match(engine, /addDaysYmdForAnaVisitAvailability\(flowStateParsed\.pendingVisitDate, 1\)/);
  assert.match(engine, /excludeStartAt:\s*awaitingSuggestedVisitSlot && suggestedSlotChangeRequested \? pendingSuggestedStartAt : null/);
});
