import assert from 'node:assert/strict';
import test from 'node:test';
import { readServerSourceFile } from './helpers/serverSourceResolver.js';

const batch = readServerSourceFile('services/whatsappBatchTemplateService.js');
const messages = readServerSourceFile('repositories/messageRepository.js');
const webhook = readServerSourceFile('services/webhookProcessor.js');
const routes = readServerSourceFile('routes/whatsapp.js');
const meta = readServerSourceFile('services/whatsappMetaService.js');
const migration = readServerSourceFile('db/migrations/pg/075_whatsapp_template_message_history.sql');

test('fluxos imediato e agendado persistem a mesma mensagem canônica com idempotência', () => {
  assert.match(batch, /createImmediateBatchExecution/);
  assert.match(batch, /send_mode[\s\S]*'IMMEDIATE'/);
  assert.match(batch, /batchId: execution\.batchId[\s\S]*recipientId: item\.recipientId/);
  assert.match(batch, /batchId: batch\.id[\s\S]*recipientId: claimed\.id/);
  assert.match(messages, /whatsapp-batch-recipient:\$\{params\.recipientId\}/);
  assert.match(messages, /ON CONFLICT \(idempotency_key\)/);
});
test('conteúdo canônico é criado antes da chamada Meta e falha também é persistida', () => {
  const canonicalAt = batch.indexOf('const canonical = await buildCanonicalTemplateHistory');
  const sendAt = batch.indexOf('const result = await sendTemplateMessage', canonicalAt);
  const failedAt = batch.indexOf("status: 'failed'", sendAt);
  const sentAt = batch.indexOf("status: 'sent'", failedAt);
  assert.ok(canonicalAt >= 0 && sendAt > canonicalAt);
  assert.ok(failedAt > sendAt && sentAt > failedAt);
  assert.doesNotMatch(batch.slice(canonicalAt, sentAt), /renderTemplateTextForInbox/);
});

test('persistência de outbound não chama pipeline automático da Ana e mantém guarda HANDOFF', () => {
  const sendCandidate = batch.slice(batch.indexOf('async function sendBatchCandidateNow'), batch.indexOf('async function createImmediateBatchExecution'));
  assert.match(sendCandidate, /isAnaAutomationBlockedByHandoff/);
  assert.match(sendCandidate, /operator_requested_initial_batch/);
  assert.match(sendCandidate, /upsertBatchTemplateMessage/);
  assert.doesNotMatch(sendCandidate, /handleIncomingMessage|scheduleWhatsAppAiAfterUserMessage/);
});

test('webhook atualiza a mensagem existente e realtime publica o objeto atualizado', () => {
  assert.match(webhook, /updateMessageDeliveryStatusByMetaId/);
  assert.match(messages, /WHERE meta_message_id = \$1[\s\S]*RETURNING \*/);
  assert.match(messages, /publishMessageUpdated\(mapMessageRowToRealtimePayload\(updated\)\)/);
  assert.match(routes, /status: m\.delivery_status \?\? 'sent'/);
  assert.match(routes, /template: isDeleted \? null : m\.template_json/);
});

test('mídia usa referência autenticada e bytes não são duplicados em messages', () => {
  assert.match(migration, /template_json JSONB/);
  assert.match(migration, /idempotency_key TEXT/);
  assert.doesNotMatch(migration, /messages[\s\S]*file_bytes/i);
  assert.match(routes, /assertCanAccessConversation/);
  assert.match(routes, /getMediaSettingById/);
  assert.match(routes, /Cache-Control', 'private/);
  assert.match(meta, /headerMediaType = template\.headerType === 'video' \|\| template\.headerType === 'document'/);
  assert.match(meta, /type: headerMediaType[\s\S]*\[headerMediaType\]: \{ id: headerMediaId \}/);
});

