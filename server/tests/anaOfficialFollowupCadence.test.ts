import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeAnaFollowupAtUtc,
  getAnaFollowupDelayMinutes,
} from '../utils/anaFollowupCadence.js';

test('cadencia oficial da Ana cobre quatro blocos de cinco tentativas', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(getAnaFollowupDelayMinutes), [5, 6, 7, 8, 9]);
  assert.deepEqual([6, 7, 8, 9, 10].map(getAnaFollowupDelayMinutes), [69, 70, 71, 72, 73]);
  assert.deepEqual([11, 12, 13, 14, 15].map(getAnaFollowupDelayMinutes), [313, 314, 315, 316, 317]);
  assert.deepEqual([16, 17, 18, 19, 20].map(getAnaFollowupDelayMinutes), [617, 618, 619, 620, 621]);
});

test('next_followup_at e calculado a partir da ancora da resposta da Ana', () => {
  const anchor = new Date('2026-06-10T12:00:00.000Z');

  assert.equal(
    computeAnaFollowupAtUtc({ anchor, attemptIndex: 1 }).toISOString(),
    '2026-06-10T12:05:00.000Z'
  );
  assert.equal(
    computeAnaFollowupAtUtc({ anchor, attemptIndex: 10 }).toISOString(),
    '2026-06-10T13:13:00.000Z'
  );
  assert.equal(
    computeAnaFollowupAtUtc({ anchor, attemptIndex: 15 }).toISOString(),
    '2026-06-10T17:17:00.000Z'
  );
  assert.equal(
    computeAnaFollowupAtUtc({ anchor, attemptIndex: 20 }).toISOString(),
    '2026-06-10T22:21:00.000Z'
  );
});

test('notBefore evita rajada quando o worker volta atrasado', () => {
  const anchor = new Date('2026-06-10T12:00:00.000Z');
  const notBefore = new Date('2026-06-10T12:10:00.000Z');

  assert.equal(
    computeAnaFollowupAtUtc({ anchor, attemptIndex: 2, notBefore }).toISOString(),
    '2026-06-10T12:10:00.000Z'
  );
});

test('indice de tentativa invalido falha explicitamente', () => {
  assert.throws(() => getAnaFollowupDelayMinutes(0), /Invalid Ana follow-up attempt index/);
  assert.throws(() => getAnaFollowupDelayMinutes(1.5), /Invalid Ana follow-up attempt index/);
  assert.throws(() => getAnaFollowupDelayMinutes(21), /exceeds cadence/);
});
