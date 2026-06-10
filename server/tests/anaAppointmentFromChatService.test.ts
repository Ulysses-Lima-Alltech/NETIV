import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../services/anaAppointmentFromChatService.ts', import.meta.url), 'utf8');

test('registro de appointment checa idempotencia antes de revalidar disponibilidade', () => {
  const existingIndex = source.indexOf('findOpenAppointmentForConversationAndEnterprise');
  const sameSlotIndex = source.indexOf('isSameAppointmentSlot(existing');
  const availabilityIndex = source.indexOf('checkAvailability(args.enterpriseId');

  assert.ok(existingIndex > -1);
  assert.ok(sameSlotIndex > existingIndex);
  assert.ok(availabilityIndex > sameSlotIndex);
  assert.match(source, /appointmentResultFromExisting\(existing/);
});

test('revalidacao de reagendamento ignora o proprio appointment', () => {
  assert.match(source, /excludeAppointmentId:\s*existing\?\.id\s*\?\?\s*null/);
  assert.match(source, /preferredBrokerId:\s*existing\?\.broker_id\s*\?\?\s*conversationBroker/);
});

test('criacao de appointment usa advisory lock para reduzir corrida check-insert', () => {
  assert.match(source, /pg_advisory_lock\(hashtext\(\$1\), hashtext\(\$2\)\)/);
  assert.match(source, /pg_advisory_unlock\(hashtext\(\$1\), hashtext\(\$2\)\)/);
  assert.match(source, /withAnaAppointmentSlotLock\(parsed\.startAt, parsed\.endAt/);
});
