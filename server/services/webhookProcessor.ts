import type { WebhookPayload, WebhookMessage } from '../types/webhook.js';
import { logWebhookEvent } from '../repositories/webhookEventRepository.js';
import { findOrCreateConversation } from '../repositories/conversationRepository.js';
import { insertMessage, findMessageByMetaId } from '../repositories/messageRepository.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { scheduleWhatsAppAiAfterUserMessage } from './whatsappAiDebounce.js';
import { leadOriginFromMetaWhatsAppMessage } from './leadOriginResolver.js';
import { notifyDjango } from './djangoWebhook.js';

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
  console.log('[ANA DEBUG] webhook received (api)');
  const metaMessageId = extractMessageId(payload);
  await logWebhookEvent(metaMessageId, 'incoming', JSON.stringify(payload));

  if (payload.object !== 'whatsapp_business_account') return;

  const aiConfig = await getOpenAIConfig();
  console.log('[ANA DEBUG] aiConfig loaded (api webhook)', {
    hasConfig: !!aiConfig,
    hasApiKey: !!aiConfig?.openaiApiKey?.trim(),
    aiEnabled: aiConfig?.aiEnabled,
  });
  if (!aiConfig) {
    console.error('[ANA DEBUG] getOpenAIConfig retornou null — integration_settings id=1 inexistente?');
    return;
  }
  if (!aiConfig.openaiApiKey?.trim()) {
    console.log('[ANA DEBUG] OpenAI API Key não configurada — mensagens não processadas pela IA');
    return;
  }
  if (!aiConfig.aiEnabled) {
    console.log('[ANA DEBUG] aiEnabled check blocked — ai_enabled=false no banco. Ative em Configurações > IA.');
    return;
  }
  console.log('[ANA DEBUG] aiEnabled check passed');

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      const contact = value.contacts?.[0];
      const contactName = contact?.profile?.name ?? null;

      for (const msg of value.messages ?? []) {
        if (!msg.id) continue;
        const alreadyProcessed = await findMessageByMetaId(msg.id);
        if (alreadyProcessed) {
          console.log('[ANA DEBUG] mensagem já processada (idempotência)', { metaMessageId: msg.id });
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
          contactName,
          phoneNumberId ?? null,
          leadOrigin
        );
        // ── Notificar Django sobre o novo contato (fire-and-forget) ──
        if (conv.contact_phone) {
          notifyDjango('api/webhook/netiv-lead/', {
            phone: conv.contact_phone,
            name: conv.customer_name || '',
          });
        }

        const bodyText = getMessageBody(msg);
        if (bodyText) {
          await insertMessage(conv.id, 'user', bodyText, msg.id);
          console.log('[ANA DEBUG] message saved', { conversationId: conv.id, metaMessageId: msg.id });
        }
        if (bodyText) {
          try {
            console.log('[ANA DEBUG] agendando IA (janela de consolidação WhatsApp)', { conversationId: conv.id });
            scheduleWhatsAppAiAfterUserMessage(conv.id, String(msg.from));
          } catch (e) {
            console.error('[ANA DEBUG] Erro ao agendar IA:', e instanceof Error ? e.message : String(e));
            if (e instanceof Error && e.stack) {
              console.error('[ANA DEBUG] Stack:', e.stack);
            }
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
