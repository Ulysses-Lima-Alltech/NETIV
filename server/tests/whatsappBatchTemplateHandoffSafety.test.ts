import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  resolveBatchHandoffDeliveryDecision,
  type BatchPersistedConversationState,
} from '../services/whatsappBatchTemplateService.js';

const handoffConversation: BatchPersistedConversationState = {
  id: 101,
  contact_id: 202,
  handoff: true,
  classification: 'Handoff',
};

test('envio manual imediato em handoff permanece permitido e preserva HANDOFF', () => {
  const decision = resolveBatchHandoffDeliveryDecision({
    sourceKeyPrefix: 'batch',
    requestedPostSendMode: 'ANA',
    conversation: handoffConversation,
  });

  assert.deepEqual(decision, { allowed: true, effectivePostSendMode: 'HANDOFF' });
});

test('lote agendado consulta o estado atual e bloqueia handoff e Carteira', () => {
  const scheduledHandoff = resolveBatchHandoffDeliveryDecision({
    sourceKeyPrefix: 'scheduled_batch:44',
    requestedPostSendMode: 'ANA',
    conversation: { ...handoffConversation, classification: ' handoff ' },
  });
  const scheduledCarteira = resolveBatchHandoffDeliveryDecision({
    sourceKeyPrefix: 'scheduled_batch:44',
    requestedPostSendMode: 'ANA',
    conversation: { ...handoffConversation, handoff: false, classification: ' CARTEIRA ' },
  });

  assert.deepEqual(scheduledHandoff, { allowed: false, reason: 'handoff' });
  assert.deepEqual(scheduledCarteira, { allowed: false, reason: 'carteira' });
});

test('decisão é isolada por conversa e um bloqueio não cancela destinatários elegíveis', () => {
  const blocked = resolveBatchHandoffDeliveryDecision({
    sourceKeyPrefix: 'scheduled_batch:44',
    requestedPostSendMode: 'ANA',
    conversation: handoffConversation,
  });
  const allowed = resolveBatchHandoffDeliveryDecision({
    sourceKeyPrefix: 'scheduled_batch:44',
    requestedPostSendMode: 'ANA',
    conversation: { id: 102, contact_id: 203, handoff: false, classification: 'Novo' },
  });

  assert.equal(blocked.allowed, false);
  assert.deepEqual(allowed, { allowed: true, effectivePostSendMode: 'ANA' });
});

test('worker bloqueia antes de sendTemplateMessage e cancela apenas o destinatário bloqueado', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/whatsappBatchTemplateService.ts'), 'utf8');
  const sendIndex = source.indexOf('const result = await sendTemplateMessage');
  const decisionIndex = source.indexOf('const deliveryDecision = resolveBatchHandoffDeliveryDecision');
  const blockedReturnIndex = source.indexOf("status: 'blocked'", decisionIndex);
  const recipientLoopIndex = source.indexOf('for (const recipient of recipientsRes.rows)');
  const cancelledRecipientIndex = source.indexOf("detail.status === 'blocked' ? 'CANCELED' : 'FAILED'", recipientLoopIndex);

  assert.ok(decisionIndex >= 0 && blockedReturnIndex > decisionIndex && sendIndex > blockedReturnIndex);
  assert.ok(recipientLoopIndex >= 0 && cancelledRecipientIndex > recipientLoopIndex);
  assert.match(source, /SELECT id, contact_id, handoff, classification\s+FROM conversations/);
  assert.match(source, /sourceKeyPrefix: `scheduled_batch:\$\{batch\.id\}`/);
});
