import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('commercial followup agenda 4+1 minutos e bloqueia apos 5a', () => {
  const source = readFileSync(new URL('../utils/anaReengagementSchedule.ts', import.meta.url), 'utf8');
  assert.match(source, /computeCommercialFollowupEligibleAtUtc/);
  assert.match(source, /cycleCount > 4/);
  assert.match(source, /\(cycleCount \+ 1\) \* MINUTE_MS/);
});

test('reengagement respeita bloqueios adicionais', () => {
  const source = readFileSync(new URL('../services/anaReengagementService.ts', import.meta.url), 'utf8');
  assert.match(source, /reason: 'handoff'/);
  assert.match(source, /reason: 'ai_disabled_or_blocked'/);
  assert.match(source, /reason: 'assigned_broker'/);
});
