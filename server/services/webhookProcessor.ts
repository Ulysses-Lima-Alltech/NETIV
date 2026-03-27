import type { WebhookPayload, WebhookMessage } from '../types/webhook.js';
import { logWebhookEvent } from '../repositories/webhookEventRepository.js';
import { findOrCreateConversation } from '../repositories/conversationRepository.js';
import { insertMessage, findMessageByMetaId } from '../repositories/messageRepository.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { scheduleWhatsAppAiAfterUserMessage } from './whatsappAiDebounce.js';
import { leadOriginFromMetaWhatsAppMessage } from './leadOriginResolver.js';
import { sendTextMessage } from './whatsappMetaService.js';

const NON_TEXT_MESSAGE = 'No momento só consigo responder a mensagens de texto.';

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

async function canSendWhatsAppText(): Promise<boolean> {
  const c = await getWhatsAppConfig();
  return !!(c?.metaAccessToken?.trim() && c?.whatsappPhoneNumberId?.trim());
}

export async function processIncomingWebhook(payload: WebhookPayload): Promise<void> {
  const metaMessageIdTop = extractMessageId(payload);
  await logWebhookEvent(metaMessageIdTop, 'incoming', JSON.stringify(payload));
  console.log('[ANA_PIPELINE] webhook_received', { metaMessageId: metaMessageIdTop ?? 'none' });

  if (payload.object !== 'whatsapp_business_account') return;

  const aiConfig = await getOpenAIConfig();
  const aiReady = !!(aiConfig?.openaiApiKey?.trim() && aiConfig.aiEnabled);
  const waReady = await canSendWhatsAppText();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      for (const msg of value.messages ?? []) {
        if (!msg.id) continue;
        const mid = String(msg.id);
        const alreadyProcessed = await findMessageByMetaId(mid);
        if (alreadyProcessed) {
          console.log('[ANA_PIPELINE] dedupe_skip', { metaMessageId: mid });
          continue;
        }

        const leadOrigin = leadOriginFromMetaWhatsAppMessage(
          msg as unknown as Record<string, unknown>,
          phoneNumberId ?? null
        );
        const conv = await findOrCreateConversation(
          'whatsapp',
          String(msg.from),
          msg.from,
          null,
          phoneNumberId ?? null,
          leadOrigin
        );

        const type = msg.type ?? 'unknown';
        const bodyText = getMessageBody(msg);

        if (type !== 'text' || !bodyText?.trim()) {
          console.log('[ANA_PIPELINE] non_text_branch', { conversationId: conv.id, metaMessageId: mid, type });
          if (waReady) {
            try {
              const r = await sendTextMessage(String(msg.from), NON_TEXT_MESSAGE);
              console.log('[ANA_PIPELINE] non_text_reply_sent', {
                conversationId: conv.id,
                metaMessageId: mid,
                ok: r.success,
              });
            } catch (e) {
              console.error('[ANA_PIPELINE] non_text_reply_failed', e instanceof Error ? e.message : String(e));
            }
          } else {
            console.log('[ANA_PIPELINE] non_text_reply_skipped', { reason: 'whatsapp_nao_configurado' });
          }
          continue;
        }

        const text = bodyText.trim();
        await insertMessage(conv.id, 'user', text, mid);
        console.log('[ANA_PIPELINE] message_persisted', {
          conversationId: conv.id,
          metaMessageId: mid,
          textLen: text.length,
        });

        if (!aiReady) {
          console.log('[ANA_PIPELINE] ai_schedule_skipped', {
            conversationId: conv.id,
            reason: !aiConfig ? 'sem_config_integracao' : !aiConfig.openaiApiKey?.trim() ? 'sem_api_key' : 'ai_disabled',
          });
          continue;
        }

        scheduleWhatsAppAiAfterUserMessage(conv.id, String(msg.from));
      }
    }
  }
}

function getMessageBody(msg: WebhookMessage): string | null {
  if (msg.text?.body) return msg.text.body;
  if (msg.image?.caption) return msg.image.caption;
  return null;
}
