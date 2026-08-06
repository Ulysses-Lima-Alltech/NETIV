import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { processAnaRetryJobsTick } from '../services/anaRetryWorkerService.js';

function withEnv(env: Record<string, string | undefined>, fn: () => Promise<void> | void): Promise<void> | void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(env)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === 'function') {
      return (result as Promise<void>).finally(restore);
    }
    restore();
  } catch (error) {
    restore();
    throw error;
  }
}

test('retry worker pula imediatamente com ANA_EMERGENCY_HANDOFF=true', async () => {
  await withEnv(
    {
      ANA_EMERGENCY_HANDOFF: 'true',
      ANA_AUTOMATION_DISABLED: undefined,
      ANA_OUTBOUND_DISABLED: undefined,
    },
    async () => {
      await processAnaRetryJobsTick();
    }
  );
});

test('retry worker checa kill switch antes de pickNextAnaRetryJob', () => {
  const workerSource = readFileSync(path.resolve(process.cwd(), 'services/anaRetryWorkerService.ts'), 'utf8');
  const tickIndex = workerSource.indexOf('export async function processAnaRetryJobsTick');
  const killSwitchIndex = workerSource.indexOf('getAnaAutomationPauseReason()', tickIndex);
  const pickIndex = workerSource.indexOf('pickNextAnaRetryJob', tickIndex);

  assert.ok(tickIndex >= 0);
  assert.ok(killSwitchIndex > tickIndex);
  assert.ok(pickIndex > killSwitchIndex);
  assert.match(workerSource, /\[ANA_RETRY_SKIP\].*ana_emergency_handoff_active/s);
});

test('retry worker compara ids bigint como string', () => {
  const workerSource = readFileSync(path.resolve(process.cwd(), 'services/anaRetryWorkerService.ts'), 'utf8');
  assert.match(workerSource, /function sameDbId/);
  assert.match(workerSource, /String\(a\) === String\(b\)/);
  assert.doesNotMatch(workerSource, /lastInbound\.id !== job\.trigger_message_id/);
});
