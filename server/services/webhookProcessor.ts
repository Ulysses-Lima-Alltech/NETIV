import type { WebhookPayload, WebhookMessage } from '../types/webhook.js';
import { logWebhookEvent } from '../repositories/webhookEventRepository.js';
import { findOrCreateConversation } from '../repositories/conversationRepository.js';
import { insertMessage, findMessageByMetaId } from '../repositories/messageRepository.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { handleIncomingMessage } from './conversationEngine.js';

export async function verifyWebhook(mode: string, token: string, challenge: string): Promise<string | null> {
  if (mode !== 'subscribe' || !challenge) return null;
  const config = await getWhatsAppConfig();
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

export async function processIncomingWebhook(payload: WebhookPayload): Promise<void> {
  const metaMessageId = extractMessageId(payload);
  await logWebhookEvent(metaMessageId, 'incoming', JSON.stringify(payload));

  if (payload.object !== 'whatsapp_business_account') return;

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      const contact = value.contacts?.[0];
      const contactName = contact?.profile?.name ?? null;

      for (const msg of value.messages ?? []) {
        if (!msg.id || (await findMessageByMetaId(msg.id))) continue;
        const conv = await findOrCreateConversation(
          'whatsapp',
          String(msg.from),
          msg.from,
          contactName,
          phoneNumberId ?? null
        );
        const bodyText = getMessageBody(msg);
        if (bodyText) {
          await insertMessage(conv.id, 'user', bodyText, msg.id);
        }
        if (bodyText) {
          const aiConfig = await getOpenAIConfig();
          if (aiConfig?.aiEnabled && aiConfig.openaiApiKey?.trim()) {
            await handleIncomingMessage({
              conversationId: conv.id,
              userMessage: bodyText,
              toPhoneNumber: String(msg.from),
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
