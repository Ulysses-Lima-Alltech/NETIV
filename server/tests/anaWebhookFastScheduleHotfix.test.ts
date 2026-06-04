import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

test('webhookProcessor agenda mensagens curtas antes do classificador', () => {
  const source = fs.readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');

  const fastScheduleIndex = source.indexOf('ANA_WEBHOOK_FAST_SCHEDULE_BEFORE_CLASSIFIER');
  const classifierIndex = source.indexOf('const liveConv = (await getConversationById(conv.id)) ?? conv;');

  assert.ok(fastScheduleIndex > -1, 'fast schedule marker n�o encontrado');
  assert.ok(classifierIndex > -1, 'classificador n�o encontrado');
  assert.ok(fastScheduleIndex < classifierIndex, 'fast schedule precisa acontecer antes do classificador');

  assert.match(source, /short_or_contextual_customer_reply/);
  assert.match(source, /scheduleWhatsAppAiAfterUserMessage\(conv\.id, String\(msg\.from\), mid\)/);
  assert.match(source, /continue;/);
});

test('webhookProcessor usa unicode escapes para evitar UTF-8 quebrado no texto de nome', () => {
  const source = fs.readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');

  assert.match(source, /r\\u00E1pidas/);
  assert.match(source, /\\u00C9vora/);
  assert.match(source, /Voc\\u00EA est\\u00E1/);
});
