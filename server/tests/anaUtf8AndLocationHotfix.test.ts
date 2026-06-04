import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

test('webhookProcessor nao envia mais qualificacao fixa no fluxo de nome', () => {
  const source = fs.readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');

  assert.match(source, /ANA_WEBHOOK_NAME_SCHEDULED_AFTER_CAPTURE/);
  assert.doesNotMatch(source, /ANA_WEBHOOK_NAME_QUALIFICATION_SENT/);
});

test('webhookProcessor nao responde aprofundamento de localizacao antes do engine', () => {
  const source = fs.readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');

  assert.match(source, /if \(false && shouldReplyLocationDeepDiveFromWebhook\) \{/);
});
