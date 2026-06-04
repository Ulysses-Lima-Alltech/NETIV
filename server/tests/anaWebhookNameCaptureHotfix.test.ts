import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

test('webhookProcessor captura nome antes do classificador e agenda o engine', () => {
  const source = fs.readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');

  assert.match(source, /ANA_WEBHOOK_NAME_CAPTURE_BYPASS_CLASSIFIER/);
  assert.match(source, /ANA_WEBHOOK_NAME_SCHEDULED_AFTER_CAPTURE/);
  assert.match(source, /mergeConfirmedCustomerNameIfEmpty\(conv\.id, nameFromWebhookBoundary\)/);
  assert.match(source, /scheduleWhatsAppAiAfterUserMessage\(conv\.id, String\(msg\.from\), mid\)/);
  assert.doesNotMatch(source, /ANA_WEBHOOK_NAME_QUALIFICATION_SENT/);
});
