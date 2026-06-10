import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../services/appointmentService.ts', import.meta.url), 'utf8');

test('findEligibleBroker prioriza preferredBrokerId antes do sorteio justo', () => {
  const preferredIndex = source.indexOf('available.some((broker) => broker.id === preferredBrokerId)');
  const fairSortIndex = source.indexOf('const withCount = await Promise.all');

  assert.ok(preferredIndex > -1);
  assert.ok(fairSortIndex > preferredIndex);
});

test('checkAvailability repassa excludeAppointmentId para conflito de corretor', () => {
  assert.match(source, /options\.excludeAppointmentId \?\? undefined/);
  assert.match(source, /findEligibleBroker\(enterpriseId, startAt, endAt, options\)/);
});
