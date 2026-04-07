import type { WebhookPayload, WebhookMessage } from '../types/webhook.js';
import { logWebhookEvent } from '../repositories/webhookEventRepository.js';
import { findOrCreateConversation, applyInboundUserMessageResets } from '../repositories/conversationRepository.js';
import { insertMessage, findMessageByMetaId } from '../repositories/messageRepository.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { scheduleWhatsAppAiAfterUserMessage } from './whatsappAiDebounce.js';
import { leadOriginFromMetaWhatsAppMessage } from './leadOriginResolver.js';
import { sendTextMessage } from './whatsappMetaService.js';

const NON_TEXT_MESSAGE = 'No momento só consigo responder a mensagens de texto.';

function phoneDigitsTail(raw: string | null | undefined, len = 6): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length ? d.slice(-len) : null;
}

function getMessageBody(msg: WebhookMessage): string | null {
  if (msg.text?.body) return msg.text.body;
  if (msg.image?.caption) return msg.image.caption;
  return null;
}

/**
 * Varre todo o payload (todos os changes). Veredito único: POST só de status vs inbound com texto processável.
 */
function classifyWebhookInboundSurface(payload: WebhookPayload): {
  verdict:
    | 'payload_object_not_whatsapp_business_account'
    | 'no_messages_field_changes'
    | 'has_inbound_text_body'
    | 'has_inbound_messages_but_no_processable_text'
    | 'messages_field_only_statuses_or_empty_messages';
  totalInboundMessages: number;
  totalStatuses: number;
  inboundTextWithBodyCount: number;
} {
  if (payload.object !== 'whatsapp_business_account') {
    return {
      verdict: 'payload_object_not_whatsapp_business_account',
      totalInboundMessages: 0,
      totalStatuses: 0,
      inboundTextWithBodyCount: 0,
    };
  }
  let totalInboundMessages = 0;
  let totalStatuses = 0;
  let inboundTextWithBodyCount = 0;
  let sawMessagesField = false;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') continue;
      sawMessagesField = true;
      const v = change.value;
      const msgs = v?.messages ?? [];
      const sts = v?.statuses ?? [];
      totalInboundMessages += msgs.length;
      totalStatuses += sts.length;
      for (const m of msgs) {
        const t = m.type ?? 'unknown';
        const body = getMessageBody(m as WebhookMessage)?.trim();
        if (t === 'text' && body) inboundTextWithBodyCount += 1;
      }
    }
  }
  if (!sawMessagesField) {
    return {
      verdict: 'no_messages_field_changes',
      totalInboundMessages: 0,
      totalStatuses: 0,
      inboundTextWithBodyCount: 0,
    };
  }
  if (inboundTextWithBodyCount > 0) {
    return {
      verdict: 'has_inbound_text_body',
      totalInboundMessages,
      totalStatuses,
      inboundTextWithBodyCount,
    };
  }
  if (totalInboundMessages > 0) {
    return {
      verdict: 'has_inbound_messages_but_no_processable_text',
      totalInboundMessages,
      totalStatuses,
      inboundTextWithBodyCount,
    };
  }
  return {
    verdict: 'messages_field_only_statuses_or_empty_messages',
    totalInboundMessages,
    totalStatuses,
    inboundTextWithBodyCount,
  };
}

function whatsAppProfileDisplayName(
  value: { contacts?: Array<{ profile?: { name?: string }; wa_id?: string }> },
  msgFrom: string
): string | null {
  const contacts = value.contacts;
  if (!contacts?.length) return null;
  const fromDigits = msgFrom.replace(/\D/g, '');
  for (const c of contacts) {
    const wa = String(c.wa_id ?? '').replace(/\D/g, '');
    if (fromDigits && wa && wa === fromDigits) {
      const n = c.profile?.name?.trim();
      if (n) return n.slice(0, 200);
    }
  }
  if (contacts.length === 1) {
    const n = contacts[0]?.profile?.name?.trim();
    if (n) return n.slice(0, 200);
  }
  return null;
}

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

/** Só para log: separa id de mensagem inbound vs id em statuses (evita ambiguidade do compat). */
function extractMessageIdsForLog(payload: WebhookPayload): {
  metaMessageIdFromMessages: string | null;
  metaMessageIdFromStatuses: string | null;
} {
  const entry = payload.entry?.[0];
  const change = entry?.changes?.[0];
  const value = change?.value;
  return {
    metaMessageIdFromMessages: value?.messages?.[0]?.id ?? null,
    metaMessageIdFromStatuses: value?.statuses?.[0]?.id ?? null,
  };
}

async function canSendWhatsAppText(): Promise<boolean> {
  const c = await getWhatsAppConfig();
  return !!(c?.metaAccessToken?.trim() && c?.whatsappPhoneNumberId?.trim());
}

export async function processIncomingWebhook(payload: WebhookPayload): Promise<void> {
  const metaMessageIdTop = extractMessageId(payload);
  const idsForLog = extractMessageIdsForLog(payload);
  await logWebhookEvent(metaMessageIdTop, 'incoming', JSON.stringify(payload));
  console.log('[ANA_PIPELINE] webhook_received', {
    metaMessageIdCompat: metaMessageIdTop ?? 'none',
    metaMessageIdFromMessages: idsForLog.metaMessageIdFromMessages,
    metaMessageIdFromStatuses: idsForLog.metaMessageIdFromStatuses,
  });
  const inboundSurface = classifyWebhookInboundSurface(payload);
  console.log('[ANA_PIPELINE] webhook_inbound_surface', {
    verdict: inboundSurface.verdict,
    totalInboundMessages: inboundSurface.totalInboundMessages,
    totalStatuses: inboundSurface.totalStatuses,
    inboundTextWithBodyCount: inboundSurface.inboundTextWithBodyCount,
    interpretacao:
      inboundSurface.verdict === 'messages_field_only_statuses_or_empty_messages'
        ? 'Este POST nao contem bolha de texto inbound; metaMessageIdCompat pode vir só de statuses[].id'
        : inboundSurface.verdict === 'has_inbound_text_body'
          ? 'Este POST contem ao menos uma mensagem de texto com corpo; espere message_persisted na sequencia'
          : undefined,
  });

  if (payload.object !== 'whatsapp_business_account') {
    console.log('[ANA_PIPELINE] inbound_skip', {
      reason: 'payload_object_not_whatsapp_business_account',
      object: payload.object ?? null,
    });
    return;
  }

  const aiConfig = await getOpenAIConfig();
  const aiReady = !!(aiConfig?.openaiApiKey?.trim() && aiConfig.aiEnabled);
  const waReady = await canSendWhatsAppText();

  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'messages') {
        console.log('[ANA_PIPELINE] inbound_skip', {
          reason: 'change_field_not_messages',
          changeField: change.field ?? null,
        });
        continue;
      }
      const value = change.value;
      const phoneNumberId = value.metadata?.phone_number_id;
      const inboundMessages = value.messages ?? [];
      const inboundStatuses = value.statuses ?? [];
      if (inboundStatuses.length > 0) {
        for (const st of inboundStatuses) {
          console.log('[WHATSAPP_STATUS_WEBHOOK] wamid', st.id ?? null);
          console.log('[WHATSAPP_STATUS_WEBHOOK] status', st.status ?? null);
          console.log('[WHATSAPP_STATUS_WEBHOOK] recipient_id', st.recipient_id ?? null);
          console.log('[WHATSAPP_STATUS_WEBHOOK] timestamp', st.timestamp ?? null);
          console.log('[WHATSAPP_STATUS_WEBHOOK] errors', value.errors ?? null);
        }
      }
      const metaMessageIdFromMessages = inboundMessages[0]?.id ?? null;
      const metaMessageIdFromStatuses = inboundStatuses[0]?.id ?? null;
      console.log('[ANA_PIPELINE] webhook_received_raw', {
        changeField: change.field,
        metaMessageIdFromMessages,
        metaMessageIdFromStatuses,
        inboundMessagesCount: inboundMessages.length,
        statusesCount: inboundStatuses.length,
      });
      if (inboundMessages.length === 0) {
        console.log('[ANA_PIPELINE] inbound_skip', {
          reason: 'messages_array_empty_on_messages_field',
          statusesCount: inboundStatuses.length,
          metaMessageIdFromStatuses,
          legacyExtractedTop: metaMessageIdTop ?? null,
          note:
            inboundStatuses.length > 0
              ? 'status_only_or_statuses_without_messages_inbound_not_persisted_here'
              : 'no_messages_no_statuses_in_this_change',
        });
        continue;
      }
      for (const msg of inboundMessages) {
        if (!msg.id) {
          console.log('[ANA_PIPELINE] inbound_skip', {
            reason: 'whatsapp_message_missing_id',
            fromTail: phoneDigitsTail(msg.from, 4),
          });
          continue;
        }
        const mid = String(msg.id);
        const bodyPreview = (getMessageBody(msg) ?? '').slice(0, 80);
        console.log('[ANA_PIPELINE] inbound_message_candidate', {
          from: msg.from ?? null,
          fromTail: phoneDigitsTail(msg.from, 4),
          type: msg.type ?? 'unknown',
          messageId: mid,
          bodyPreview,
        });
        const alreadyProcessed = await findMessageByMetaId(mid);
        if (alreadyProcessed) {
          console.log('[ANA_PIPELINE] dedupe_skip', {
            metaMessageId: mid,
            conversationId: alreadyProcessed.conversation_id,
            fromTail: phoneDigitsTail(msg.from, 4),
          });
          continue;
        }

        const leadOrigin = leadOriginFromMetaWhatsAppMessage(
          msg as unknown as Record<string, unknown>,
          phoneNumberId ?? null
        );
        const waDisplay = whatsAppProfileDisplayName(value, String(msg.from));
        const conv = await findOrCreateConversation(
          'whatsapp',
          String(msg.from),
          msg.from,
          phoneNumberId ?? null,
          leadOrigin,
          { whatsappDisplayName: waDisplay }
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
        try {
          await insertMessage(conv.id, 'user', text, mid);
          await applyInboundUserMessageResets(conv.id);
        } catch (e) {
          const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
          console.log('[ANA_PIPELINE] inbound_skip', {
            reason: code === '23505' ? 'insert_unique_meta_message_id_conflict' : 'insert_message_failed',
            conversationId: conv.id,
            metaMessageId: mid,
            fromTail: phoneDigitsTail(msg.from, 4),
            pgCode: code || undefined,
            detail: e instanceof Error ? e.message : String(e),
          });
          continue;
        }
        console.log('[ANA_PIPELINE] message_persisted', {
          conversationId: conv.id,
          metaMessageId: mid,
          textLen: text.length,
          from: msg.from ?? null,
          fromTail: phoneDigitsTail(msg.from, 4),
          externalContactIdTail: phoneDigitsTail(conv.external_contact_id, 4),
          contactPhoneTail: phoneDigitsTail(conv.contact_phone, 4),
        });

        if (!aiReady) {
          console.log('[ANA_PIPELINE] ai_schedule_skipped', {
            conversationId: conv.id,
            metaMessageId: mid,
            fromTail: phoneDigitsTail(msg.from, 4),
            reason: !aiConfig ? 'sem_config_integracao' : !aiConfig.openaiApiKey?.trim() ? 'sem_api_key' : 'ai_disabled',
          });
          continue;
        }
        scheduleWhatsAppAiAfterUserMessage(conv.id, String(msg.from));
        console.log('[ANA_PIPELINE] ai_schedule_called', {
          conversationId: conv.id,
          metaMessageId: mid,
          fromTail: phoneDigitsTail(msg.from, 4),
        });
      }
    }
  }
}
