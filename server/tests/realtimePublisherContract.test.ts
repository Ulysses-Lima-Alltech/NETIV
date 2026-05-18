import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('realtimePublisher usa contact_type via contacts com fallback CLIENT', () => {
  const source = readFileSync(new URL('../realtime/realtimePublisher.js', import.meta.url), 'utf8');
  assert.match(source, /LEFT JOIN contacts ct ON ct\.id = c\.contact_id/);
  assert.match(source, /COALESCE\(ct\.contact_type, 'CLIENT'\) AS contact_type/);
  assert.match(source, /conversationType:\s*row\.contact_type\s*\?\?\s*'CLIENT'/);
});

test('publishConversationUpdated continua protegido por try/catch', () => {
  const source = readFileSync(new URL('../realtime/realtimePublisher.js', import.meta.url), 'utf8');
  assert.match(source, /export async function publishConversationUpdated/);
  assert.match(source, /\[Realtime\] publishConversationUpdated_failed/);
});
