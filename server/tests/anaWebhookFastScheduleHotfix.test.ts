import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

test('webhookProcessor agenda mensagens curtas antes do classificador', () => {
  const source = fs.readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');

  const fastScheduleIndex = source.indexOf('ANA_WEBHOOK_FAST_SCHEDULE_BEFORE_CLASSIFIER');
  const classifierIndex = source.indexOf('const liveConv = (await getConversationById(conv.id)) ?? conv;');

  assert.ok(fastScheduleIndex > -1, 'fast schedule marker não encontrado');
  assert.ok(classifierIndex > -1, 'classificador não encontrado');
  assert.ok(fastScheduleIndex < classifierIndex, 'fast schedule precisa acontecer antes do classificador');

  assert.match(source, /short_or_contextual_customer_reply/);
  assert.match(source, /scheduleWhatsAppAiAfterUserMessage\(conv\.id, String\(msg\.from\), mid\)/);
  assert.match(source, /continue;/);
});

test('webhookProcessor nao envia mais qualificacao fixa no fluxo de nome', () => {
  const source = fs.readFileSync(new URL('../services/webhookProcessor.ts', import.meta.url), 'utf8');

  assert.match(source, /ANA_WEBHOOK_NAME_CAPTURE_BYPASS_CLASSIFIER/);
  assert.match(source, /ANA_WEBHOOK_NAME_SCHEDULED_AFTER_CAPTURE/);
  assert.doesNotMatch(source, /ANA_WEBHOOK_NAME_QUALIFICATION_SENT/);

  const nameCaptureIndex = source.indexOf('ANA_WEBHOOK_NAME_CAPTURE_BYPASS_CLASSIFIER');
  const nameScheduledIndex = source.indexOf('ANA_WEBHOOK_NAME_SCHEDULED_AFTER_CAPTURE');

  assert.ok(nameCaptureIndex > -1, 'bloco de captura de nome não encontrado');
  assert.ok(nameScheduledIndex > nameCaptureIndex, 'agendamento precisa vir depois da captura do nome');

  const nameFlowSlice = source.slice(nameCaptureIndex, nameScheduledIndex + 300);

  assert.doesNotMatch(nameFlowSlice, /qualificationReply/);
  assert.doesNotMatch(nameFlowSlice, /Prazer, \$\{nameFromWebhookBoundary\}/);
  assert.doesNotMatch(nameFlowSlice, /r\\u00E1pidas/);
  assert.doesNotMatch(nameFlowSlice, /Voc\\u00EA est\\u00E1 olhando/);
});