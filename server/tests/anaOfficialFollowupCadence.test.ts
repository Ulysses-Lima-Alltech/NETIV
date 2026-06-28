import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeAnaFollowupAtUtc,
  getAnaFollowupDelayMinutes,
} from '../utils/anaFollowupCadence.js';

test('cadencia oficial da Ana cobre tentativas 1-5, 6-8, 9-13 e 14+', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map(getAnaFollowupDelayMinutes),
    [1, 2, 3, 4, 5]
  );
  assert.deepEqual(
    [6, 7, 8].map(getAnaFollowupDelayMinutes),
    [65, 125, 185]
  );
  assert.deepEqual(
    [9, 10, 11, 12, 13].map(getAnaFollowupDelayMinutes),
    [186, 187, 188, 189, 190]
  );
  assert.deepEqual(
    [14, 15, 16, 17].map(getAnaFollowupDelayMinutes),
    [310, 430, 550, 670]
  );
});

test('next_followup_at e calculado a partir da ancora da resposta da Ana', () => {
  const anchor = new Date('2026-06-10T12:00:00.000Z');

  assert.equal(
    computeAnaFollowupAtUtc({ anchor, attemptIndex: 1 }).toISOString(),
    '2026-06-10T12:01:00.000Z'
  );
  assert.equal(
    computeAnaFollowupAtUtc({ anchor, attemptIndex: 8 }).toISOString(),
    '2026-06-10T15:05:00.000Z'
  );
  assert.equal(
    computeAnaFollowupAtUtc({ anchor, attemptIndex: 13 }).toISOString(),
    '2026-06-10T15:10:00.000Z'
  );
  assert.equal(
    computeAnaFollowupAtUtc({ anchor, attemptIndex: 14 }).toISOString(),
    '2026-06-10T17:10:00.000Z'
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
});
