import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

test('webhookProcessor captura nome antes do classificador', () => {
  const source = fs.readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');

  const bypassIndex = source.indexOf('ANA_WEBHOOK_NAME_CAPTURE_BYPASS_CLASSIFIER');
  const classifierIndex = source.indexOf('const liveConv = (await getConversationById(conv.id)) ?? conv;');

  assert.ok(bypassIndex > -1, 'marker de captura de nome n�o encontrado');
  assert.ok(classifierIndex > -1, 'in�cio do classificador n�o encontrado');
  assert.ok(bypassIndex < classifierIndex, 'captura de nome precisa acontecer antes do classificador');

  assert.match(source, /extractCustomerNameFromUserUtterance\(text/);
  assert.match(source, /replyExplicitlyAsksCustomerName/);
  assert.match(source, /mergeContactNameIfMissing/);
  assert.match(source, /ANA_WEBHOOK_NAME_QUALIFICATION_SENT/);
  assert.match(source, /continue;/);
});
