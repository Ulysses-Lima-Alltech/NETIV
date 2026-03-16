import type { WebhookPayload, WebhookMessage } from '../types/webhook.js';
import { logWebhookEvent } from '../repositories/webhookEventRepository.js';
import { findOrCreateConversation } from '../repositories/conversationRepository.js';
import { insertMessage, findMessageByMetaId, updateMessageStatusByExternalId } from '../repositories/messageRepository.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { handleIncomingMessage } from './conversationEngine.js';

export function verifyWebhook(mode: string, token: string, challenge: string): string | null {
  if (mode !== 'subscribe' || !challenge) return null;
  const config = getWhatsAppConfig();
  const expected = config?.webhookVerifyToken ?? '';
  if (!expected || token !== expected) return null;
  return challenge;
}

function extractMessageId(payload: WebhookPayload): string | null {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  const msg = value?.messages?.[0];
  return msg?.id ?? value?.statuses?.[0]?.id ?? null;
}

export function processIncomingWebhook(payload: WebhookPayload): void {
  const metaMessageId = extractMessageId(payload);
  logWebhookEvent(metaMessageId, 'incoming', JSON.stringify(payload));

  if (payload.object !== 'whatsapp_business_account') return;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;

      for (const status of value.statuses ?? []) {
        const ts = status.timestamp ? new Date(parseInt(status.timestamp, 10) * 1000).toISOString() : null;
        const deliveredAt = status.status === 'delivered' ? ts : null;
        const readAt = status.status === 'read' ? ts : null;
        updateMessageStatusByExternalId(status.id, status.status, deliveredAt, readAt, null);
      }

      for (const err of value.errors ?? []) {
        const messageId = (err as { message_id?: string }).message_id ?? (err as { id?: string }).id;
        if (messageId) {
          const errMsg = (err as { message?: string }).message ?? (err as { error_data?: { details?: string } }).error_data?.details ?? 'Erro';
          updateMessageStatusByExternalId(messageId, 'failed', null, null, errMsg);
        }
      }

      const contact = value.contacts?.[0];
      const contactName = contact?.profile?.name ?? null;

      for (const msg of value.messages ?? []) {
        if (findMessageByMetaId(msg.id)) continue;
        const conv = findOrCreateConversation(
          'whatsapp',
          String(msg.from),
          msg.from,
          contactName,
          phoneNumberId
        );
        const bodyText = getMessageBody(msg);
        insertMessage(conv.id, 'inbound', msg.id, 'received', bodyText, JSON.stringify(msg));

        if (bodyText) {
          const aiConfig = getOpenAIConfig();
          if (aiConfig?.aiEnabled) {
            setImmediate(() => {
              handleIncomingMessage({
                conversationId: conv.id,
                userMessage: bodyText,
                toPhoneNumber: String(msg.from),
              }).catch((e) => console.error('[Webhook] ConversationEngine error:', e));
            });
          }
        }
      }
    }
  }
}

function getMessageBody(msg: WebhookMessage): string | null {
  if (msg.text?.body) return msg.text.body;
  if (msg.image?.caption) return msg.image.caption;
  return null;
}
