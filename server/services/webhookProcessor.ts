import type { WebhookPayload, WebhookMessage } from '../types/webhook.js';
import { logWebhookEvent } from '../repositories/webhookEventRepository.js';
import {
  findOrCreateConversation,
  applyInboundUserMessageResets,
  getConversationById,
  getConversationManualClassificationOverrides,
  saveLeadClassificationAudit,
  setConversationEnterpriseId,
  setConversationEnterpriseIdAndOrigin,
  setConversationFunnelStatusAutomatic,
  setConversationLeadTemperature,
  mergeConfirmedCustomerNameIfEmpty,
  type ConversationRow,
} from '../repositories/conversationRepository.js';
import {
  insertMessage,
  findMessageByMetaId,
  getRecentConversationMessages,
  updateMessageDeliveryStatusByMetaId,
} from '../repositories/messageRepository.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { scheduleWhatsAppAiAfterUserMessage } from './whatsappAiDebounce.js';
import { handleIncomingMessage } from './conversationEngine.js';
import { leadOriginFromMetaWhatsAppMessage } from './leadOriginResolver.js';
import { sendAnaTextMessageWithQuota } from './anaOutboundQuotaService.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import { mergeContactNameIfMissing } from '../repositories/contactsRepository.js';
import { listEnterprises } from '../repositories/enterpriseRepository.js';
import { listEnterpriseAliasRowsForActiveEnterprises } from '../repositories/enterpriseMatch.js';
import { classifyLeadConversation } from './leadClassificationService.js';
import {
  isAnaEmergencyHandoffEnabled,
  sendAnaEmergencyHandoff,
} from '../utils/anaEmergencyHandoff.js';
import {
  isAnaAutomationBlockedByHandoff,
  logAnaAutomationBlockedByHandoff,
} from '../utils/anaHandoffPolicy.js';

import {
  extractCustomerNameFromUserUtterance,
  replyExplicitlyAsksCustomerName,
} from '../utils/extractCustomerNameFromMessage.js';
/** Desligado enquanto se testa o bypass no conversationEngine (`ANA_ENGINE_DIAGNOSTIC_FIXED_REPLY`). Se true, dá `continue` e o motor não corre. */
const ANA_DIAGNOSTIC_FIXED_REPLY = false;
const ANA_DIAGNOSTIC_FIXED_TEXT = 'Diagnóstico: recebi sua mensagem no fluxo automático.';

const NON_TEXT_MESSAGE = 'No momento só consigo responder a mensagens de texto.';
const ANA_EVORA_DEFAULT_PHONE_NUMBER_ID = '1070497299485505';

function phoneDigitsTail(raw: string | null | undefined, len = 6): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length ? d.slice(-len) : null;
}

function getMessageBody(msg: WebhookMessage): string | null {
  if (msg.text?.body) return msg.text.body;
  if (msg.image?.caption) return msg.image.caption;
  return null;
}

function getNonTextInboxContent(msg: WebhookMessage): string {
  const caption = getMessageBody(msg)?.trim();
  if (caption) return caption;
  switch (msg.type) {
    case 'image':
      return '[Imagem recebida]';
    case 'video':
      return '[V?deo recebido]';
    case 'audio':
      return '[?udio recebido]';
    case 'document':
      return msg.document?.filename?.trim()
        ? `[Documento recebido: ${msg.document.filename.trim()}]`
        : '[Documento recebido]';
    default:
      return `[Mensagem ${msg.type || 'n?o textual'} recebida]`;
  }
}

function normalizeInboundEnterpriseText(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inboundMentionsEvora(text: string): boolean {
  const n = normalizeInboundEnterpriseText(text);
  if (!n) return false;
  return /\b(?:lote(?:amento)?\s+)?evora\b/.test(n);
}

function isEvoraEnterpriseNameForInbound(name: string | null | undefined, slug?: string | null): boolean {
  const n = normalizeInboundEnterpriseText(`${name ?? ''} ${slug ?? ''}`);
  return /\bevora\b/.test(n);
}

async function resolveAnaEnterpriseBeforeEngine(params: {
  conversation: ConversationRow;
  userMessage: string;
  phoneNumberId: string | null | undefined;
  metaMessageId: string;
}): Promise<ConversationRow> {
  const phoneNumberId = String(params.phoneNumberId ?? '').trim() || null;
  const matchedByMessage = inboundMentionsEvora(params.userMessage);
  const matchedByPhoneDefault =
    !matchedByMessage &&
    params.conversation.enterprise_id == null &&
    phoneNumberId === ANA_EVORA_DEFAULT_PHONE_NUMBER_ID;

  if (!matchedByMessage && !matchedByPhoneDefault) return params.conversation;

  const activeEnterprises = await listEnterprises(true);
  const evoraEnterprise =
    activeEnterprises.find((enterprise) => isEvoraEnterpriseNameForInbound(enterprise.name, enterprise.slug)) ?? null;
  const matchedBy = matchedByMessage ? 'message_evora_keyword' : 'phone_number_default_evora';
  const reason = matchedByMessage ? 'inbound_message_mentions_evora' : 'phone_number_default_enterprise';

  console.log('[ANA_ENTERPRISE_RESOLVE]', {
    conversationId: params.conversation.id,
    metaMessageId: params.metaMessageId,
    reason,
    phoneNumberId,
    enterpriseId: evoraEnterprise?.id ?? null,
    enterpriseName: evoraEnterprise?.name ?? null,
    matchedBy,
  });

  if (!evoraEnterprise) return params.conversation;

  const updated = await setConversationEnterpriseIdAndOrigin(params.conversation.id, evoraEnterprise.id);
  const finalConversation = updated ?? params.conversation;
  if (finalConversation.enterprise_id !== evoraEnterprise.id) {
    console.log('[ANA_ENTERPRISE_RESOLVE]', {
      conversationId: params.conversation.id,
      metaMessageId: params.metaMessageId,
      reason: 'enterprise_update_not_applied',
      phoneNumberId,
      enterpriseId: finalConversation.enterprise_id ?? null,
      enterpriseName: evoraEnterprise.name,
      matchedBy,
    });
  }
  return finalConversation;
}

function anaWebhookTrace(tag: string, payload: Record<string, unknown>): void {
  console.log(`[ANA_WEBHOOK_TRACE] ${tag}`, payload);
}

async function shouldBlockAnaWebhookAutomation(params: {
  conversationId: number;
  automationType: string;
  blockedAt: 'inbound_entry' | 'before_ai';
}): Promise<boolean> {
  const conversation = await getConversationById(params.conversationId);
  if (!isAnaAutomationBlockedByHandoff(conversation)) return false;
  logAnaAutomationBlockedByHandoff(conversation!, {
    conversationId: params.conversationId,
    automationType: params.automationType,
    blockedAt: params.blockedAt,
    source: 'whatsapp_webhook',
  });
  return true;
}

function errorStackShort(e: unknown): string | null {
  if (!(e instanceof Error) || !e.stack) return null;
  return e.stack.split('\n').slice(0, 5).join('\n');
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

  const anaEmergencyHandoffActive = isAnaEmergencyHandoffEnabled();
  if (anaEmergencyHandoffActive) {
    console.log('[ANA_EMERGENCY_HANDOFF] webhook_ai_gate_bypassed', {
      reason: 'emergency_handoff_active',
    });
  }
  console.log('[ANA_PIPELINE] integration_ai_gate', {
    ana_emergency_handoff: anaEmergencyHandoffActive,
    note:
      'Decisao de chave/API bloqueada por empreendimento foi movida para conversationEngine + enterpriseAiSettingsService.',
  });
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
          const rawErrors = Array.isArray(st.errors) && st.errors.length > 0 ? st.errors : value.errors ?? [];
          const firstError = rawErrors[0] ?? null;
          const occurredAt = /^\d+$/.test(String(st.timestamp ?? ''))
            ? new Date(Number(st.timestamp) * 1000)
            : new Date();
          await updateMessageDeliveryStatusByMetaId({
            metaMessageId: String(st.id),
            status: st.status,
            occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
            failure: st.status === 'failed'
              ? {
                  code: typeof firstError?.code === 'number' ? firstError.code : null,
                  title: typeof firstError?.title === 'string' ? firstError.title.slice(0, 300) : null,
                  message: String(firstError?.message ?? firstError?.title ?? 'Falha informada pela Meta.').slice(0, 1000),
                }
              : null,
          });
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

        let conversationIdForCatch: number | null = null;
        try {
          anaWebhookTrace('inbound_loop_enter', {
            metaMessageId: mid,
            fromTail: phoneDigitsTail(msg.from, 4),
            type: msg.type ?? 'unknown',
          });

          anaWebhookTrace('dedupe_check_start', { metaMessageId: mid });
          const alreadyProcessed = await findMessageByMetaId(mid);
          anaWebhookTrace('dedupe_check_result', {
            metaMessageId: mid,
            isDuplicate: !!alreadyProcessed,
            conversationId: alreadyProcessed?.conversation_id ?? null,
          });
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
          const fromCanon = normalizePhoneE164(String(msg.from)) ?? String(msg.from).replace(/\D/g, '');

          anaWebhookTrace('find_or_create_conversation_start', { metaMessageId: mid });
          let conv: Awaited<ReturnType<typeof findOrCreateConversation>>;
          try {
            conv = await findOrCreateConversation(
              'whatsapp',
              String(msg.from),
              msg.from,
              phoneNumberId ?? null,
              leadOrigin,
              { whatsappDisplayName: waDisplay }
            );
          } catch (e) {
            anaWebhookTrace('find_or_create_conversation_error', {
              metaMessageId: mid,
              errorMessage: e instanceof Error ? e.message : String(e),
              stackShort: errorStackShort(e),
            });
            throw e;
          }
          conversationIdForCatch = conv.id;
          anaWebhookTrace('find_or_create_conversation_success', {
            conversationId: conv.id,
            metaMessageId: mid,
          });

          console.log('[WHATSAPP_INBOUND_THREAD]', {
            metaMessageId: mid,
            conversationId: conv.id,
            fromCanon,
            phoneNumberId: phoneNumberId ?? null,
            enterpriseIdOnConv: conv.enterprise_id ?? null,
          });

          const type = msg.type ?? 'unknown';
          const bodyText = getMessageBody(msg);

          if (type !== 'text' || !bodyText?.trim()) {
            console.log('[ANA_PIPELINE] non_text_branch', { conversationId: conv.id, metaMessageId: mid, type });
            // Mensagens n?o textuais tamb?m precisam chegar ao inbox. insertMessage
            // publica message.created e conversation.updated pelo mesmo caminho do texto.
            await insertMessage(conv.id, 'user', getNonTextInboxContent(msg), mid);
            await applyInboundUserMessageResets(conv.id);
            if (
              await shouldBlockAnaWebhookAutomation({
                conversationId: conv.id,
                automationType: 'webhook_non_text_reply',
                blockedAt: 'inbound_entry',
              })
            ) {
              continue;
            }
            if (anaEmergencyHandoffActive) {
              const emergencyResult = await sendAnaEmergencyHandoff({
                conversationId: conv.id,
                toPhoneNumber: String(msg.from),
                sendTextMessage: (to, text) =>
                  sendAnaTextMessageWithQuota({
                    conversationId: conv.id,
                    to,
                    text,
                    phase: 'ana_webhook_emergency_handoff',
                  }),
                insertAssistantMessage: (conversationId, text, metaMessageId) =>
                  insertMessage(conversationId, 'assistant', text, metaMessageId),
              });
              console.log('[ANA_EMERGENCY_HANDOFF] non_text_handled', {
                conversationId: conv.id,
                metaMessageId: mid,
                sent: emergencyResult.sent,
                outboundMetaMessageId: emergencyResult.metaMessageId,
                error: emergencyResult.error,
              });
              continue;
            }
            if (waReady) {
              try {
                const r = await sendAnaTextMessageWithQuota({
                  conversationId: conv.id,
                  to: String(msg.from),
                  text: NON_TEXT_MESSAGE,
                  phase: 'ana_webhook_non_text_reply',
                });
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

          anaWebhookTrace('insert_message_start', {
            conversationId: conv.id,
            metaMessageId: mid,
            textLen: text.length,
          });
          try {
            await insertMessage(conv.id, 'user', text, mid);
            anaWebhookTrace('insert_message_success', { conversationId: conv.id, metaMessageId: mid });
          } catch (e) {
            const code = e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : '';
            anaWebhookTrace('insert_message_error', {
              conversationId: conv.id,
              metaMessageId: mid,
              pgCode: code || undefined,
              errorMessage: e instanceof Error ? e.message : String(e),
              stackShort: errorStackShort(e),
            });
            console.log('[ANA_PIPELINE] inbound_skip', {
              reason: code === '23505' ? 'insert_unique_meta_message_id_conflict' : 'insert_message_failed',
              conversationId: conv.id,
              metaMessageId: mid,
              fromTail: phoneDigitsTail(msg.from, 4),
              pgCode: code || undefined,
              detail: e instanceof Error ? e.message : String(e),
            });
            throw e;
          }

          anaWebhookTrace('inbound_resets_start', { conversationId: conv.id, metaMessageId: mid });
          try {
            await applyInboundUserMessageResets(conv.id);
            anaWebhookTrace('inbound_resets_success', { conversationId: conv.id, metaMessageId: mid });
          } catch (e) {
            anaWebhookTrace('inbound_resets_error', {
              conversationId: conv.id,
              metaMessageId: mid,
              errorMessage: e instanceof Error ? e.message : String(e),
              stackShort: errorStackShort(e),
            });
            throw e;
          }

          // O inbound j? foi persistido e publicado por insertMessage. A partir
          // daqui nenhum classificador, debounce, IA, job ou resposta autom?tica
          // pode rodar se o estado atual da conversa estiver em HANDOFF.
          if (
            await shouldBlockAnaWebhookAutomation({
              conversationId: conv.id,
              automationType: 'inbound_message',
              blockedAt: 'inbound_entry',
            })
          ) {
            console.log('[ANA_PIPELINE] inbound_automation_stopped_handoff', {
              conversationId: conv.id,
              metaMessageId: mid,
            });
            continue;
          }

          conv = await resolveAnaEnterpriseBeforeEngine({
            conversation: conv,
            userMessage: text,
            phoneNumberId,
            metaMessageId: mid,
          });

          console.log('[ANA_PIPELINE] message_persisted', {
            conversationId: conv.id,
            metaMessageId: mid,
            textLen: text.length,
            from: msg.from ?? null,
            fromTail: phoneDigitsTail(msg.from, 4),
            externalContactIdTail: phoneDigitsTail(conv.external_contact_id, 4),
            contactPhoneTail: phoneDigitsTail(conv.contact_phone, 4),
          });


          // HOTFIX: resposta curta de nome não pode depender do lead classifier.
          // Fluxo correto: pediu nome -> cliente respondeu nome -> salva nome -> responde qualificação -> continue.
          {
            const recentForName = await getRecentConversationMessages(conv.id, 12);
            const lastAssistantNameQuestion =
              [...recentForName]
                .reverse()
                .find((m) => {
                  const content = String(m.content ?? '').trim();
                  return m.role === 'assistant' && replyExplicitlyAsksCustomerName(content);
                }) ?? null;

            const lastAssistantNameQuestionText = lastAssistantNameQuestion
              ? String(lastAssistantNameQuestion.content ?? '').trim()
              : null;

            const nameFromWebhookBoundary = lastAssistantNameQuestionText
              ? extractCustomerNameFromUserUtterance(text, {
                  lastAssistantPlain: lastAssistantNameQuestionText,
                })
              : null;

            if (nameFromWebhookBoundary && lastAssistantNameQuestionText) {
              console.log('[ANA_WEBHOOK_NAME_CAPTURE_BYPASS_CLASSIFIER]', {
                conversationId: conv.id,
                metaMessageId: mid,
                customerName: nameFromWebhookBoundary,
                lastAssistantQuestion: lastAssistantNameQuestionText.slice(0, 160),
              });

              if (conv.contact_id != null) {
                try {
                  await mergeContactNameIfMissing(conv.contact_id, nameFromWebhookBoundary);
                  console.log('[ANA_WEBHOOK_NAME_CONTACT_MERGED]', {
                    conversationId: conv.id,
                    contactId: conv.contact_id,
                    customerName: nameFromWebhookBoundary,
                  });
                } catch (e) {
                  console.error('[ANA_WEBHOOK_NAME_CONTACT_MERGE_FAILED]', {
                    conversationId: conv.id,
                    contactId: conv.contact_id,
                    error: e instanceof Error ? e.message : String(e),
                  });
                }
              }
              await mergeConfirmedCustomerNameIfEmpty(conv.id, nameFromWebhookBoundary);

              console.log('[ANA_WEBHOOK_NAME_CAPTURE_SCHEDULE_ENGINE]', {
                conversationId: conv.id,
                metaMessageId: mid,
                customerName: nameFromWebhookBoundary,
              });

              scheduleWhatsAppAiAfterUserMessage(conv.id, String(msg.from), mid);

              console.log('[ANA_WEBHOOK_NAME_SCHEDULED_AFTER_CAPTURE]', {
                conversationId: conv.id,
                metaMessageId: mid,
              });

              continue;
            }
          }

                    const normalizedTextForLocationDeepDive = text
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase();

          const shouldReplyLocationDeepDiveFromWebhook =
            !anaEmergencyHandoffActive &&
            /\b(fale mais da localizacao|fala mais da localizacao|quero entender mais.*localizacao|quero saber mais.*localizacao|mais da localizacao|localizacao|regiao|atibaia)\b/i.test(normalizedTextForLocationDeepDive);

          if (false && shouldReplyLocationDeepDiveFromWebhook) {
            const locationDeepDiveReply = [
              'Atibaia faz parte da regi\u00E3o bragantina, uma das regi\u00F5es mais valorizadas e desenvolvidas do estado.',
              'Fica a aproximadamente 50 minutos de S\u00E3o Paulo, o que torna o \u00C9vora uma op\u00E7\u00E3o interessante tanto para moradia quanto para casa de veraneio.',
              'A cidade tamb\u00E9m \u00E9 forte em gastronomia. A Avenida Lucas Nogueira Garc\u00EAs concentra restaurantes, bares e com\u00E9rcios, funcionando como um shopping a c\u00E9u aberto.',
              'O \u00C9vora fica na regi\u00E3o da Pedreira, no bairro Rio Abaixo, com acesso pela Rodovia Dom Pedro I.',
              'Voc\u00EA quer que eu siga te explicando pela estrutura do loteamento, lazer ou formas de pagamento?'
            ].join('\n\n');

            const locationReply = await sendAnaTextMessageWithQuota({
              conversationId: conv.id,
              to: String(msg.from),
              text: locationDeepDiveReply,
              phase: 'ana_webhook_location_deep_dive',
            });

            if (locationReply.success && locationReply.metaMessageId) {
              await insertMessage(conv.id, 'assistant', locationDeepDiveReply, locationReply.metaMessageId ?? null);
              console.log('[ANA_WEBHOOK_LOCATION_DEEP_DIVE_REPLY_SENT]', {
                conversationId: conv.id,
                metaMessageId: mid,
                outboundMetaMessageId: locationReply.metaMessageId,
              });
            } else {
              console.error('[ANA_WEBHOOK_LOCATION_DEEP_DIVE_REPLY_FAILED]', {
                conversationId: conv.id,
                metaMessageId: mid,
                error: locationReply.error ?? null,
                code: locationReply.code ?? null,
              });
            }

            continue;
          }

const shouldFastScheduleAnaBeforeClassifier =


            !anaEmergencyHandoffActive &&


            (


              text.length <= 100 ||


              /^(sim|quero|quero entender|quero saber|fala|fale|me fala|me explica|entender|regi[aã]o|localiza[cç][aã]o|lazer|seguran[cç]a|valor|valores|pagamento|formas|lote|lotes)\b/i.test(text)


            );



          if (shouldFastScheduleAnaBeforeClassifier) {


            console.log('[ANA_WEBHOOK_FAST_SCHEDULE_BEFORE_CLASSIFIER]', {


              conversationId: conv.id,


              metaMessageId: mid,


              textPreview: text.slice(0, 120),


              reason: 'short_or_contextual_customer_reply',


            });



            scheduleWhatsAppAiAfterUserMessage(conv.id, String(msg.from), mid);



            console.log('[ANA_WEBHOOK_FAST_SCHEDULE_CONTINUE]', {


              conversationId: conv.id,


              metaMessageId: mid,


            });



            continue;


          }


          try {
            const liveConv = (await getConversationById(conv.id)) ?? conv;
            const manualOverrides = getConversationManualClassificationOverrides(liveConv.commercial_flow_state);
            const recentMessages = await getRecentConversationMessages(conv.id, 12);
            const activeEnterprises = await listEnterprises(true);
            const aliasRows =
              activeEnterprises.length > 0
                ? await listEnterpriseAliasRowsForActiveEnterprises(activeEnterprises.map((item) => item.id))
                : [];
            const decision = await classifyLeadConversation({
              conversationId: conv.id,
              contactId: liveConv.contact_id ?? null,
              latestCustomerMessage: text,
              recentMessages,
              currentTemperature: liveConv.lead_temperature ?? null,
              currentEnterpriseId: liveConv.enterprise_id ?? null,
              currentFunnelStatus: liveConv.classification ?? null,
              availableEnterprises: activeEnterprises,
              enterpriseAliasRows: aliasRows,
              manualOverrideFlags: manualOverrides,
            });

            const oldTemperature = liveConv.lead_temperature ?? null;
            const oldEnterpriseId = liveConv.enterprise_id ?? null;
            const oldFunnelStatus = liveConv.classification ?? null;
            let appliedTemperature = false;
            let appliedEnterprise = false;
            let appliedFunnel = false;

            if (decision.shouldUpdateTemperature) {
              const tempLower = decision.temperature.toLowerCase();
              if (tempLower === 'frio' || tempLower === 'morno' || tempLower === 'quente') {
                await setConversationLeadTemperature(conv.id, tempLower);
                appliedTemperature = true;
              }
            }
            if (decision.shouldUpdateEnterprise && decision.enterpriseId != null) {
              await setConversationEnterpriseId(conv.id, decision.enterpriseId);
              appliedEnterprise = true;
            }
            if (decision.shouldUpdateFunnel && decision.funnelStatus != null) {
              await setConversationFunnelStatusAutomatic(conv.id, decision.funnelStatus);
              appliedFunnel = true;
            }

            const updatedAfterClassification = await getConversationById(conv.id);
            const classificationAudit = {
              oldTemperature,
              newTemperature: updatedAfterClassification?.lead_temperature ?? oldTemperature,
              oldEnterpriseId,
              newEnterpriseId: updatedAfterClassification?.enterprise_id ?? oldEnterpriseId,
              oldFunnelStatus,
              newFunnelStatus: updatedAfterClassification?.classification ?? oldFunnelStatus,
              confidence: {
                temperature: decision.temperatureConfidence,
                enterprise: decision.enterpriseConfidence,
                funnel: decision.funnelConfidence,
              },
              reason: {
                temperature: decision.temperatureReason,
                enterprise: decision.enterpriseReason,
                ignored: decision.ignoredReasons,
              },
              applied: {
                temperature: appliedTemperature,
                enterprise: appliedEnterprise,
                funnel: appliedFunnel,
              },
              ignoredReason: decision.ignoredReasons.length > 0 ? decision.ignoredReasons.join(';') : null,
              mainIntent: decision.mainIntent,
              classifierSource: decision.source,
            } as const;
            await saveLeadClassificationAudit(conv.id, classificationAudit);
            console.log('[LEAD_CLASSIFICATION]', {
              conversationId: conv.id,
              ...classificationAudit,
              updates: {
                shouldUpdateTemperature: decision.shouldUpdateTemperature,
                shouldUpdateEnterprise: decision.shouldUpdateEnterprise,
                shouldUpdateFunnel: decision.shouldUpdateFunnel,
              },
            });
          } catch (classificationError) {
            console.error('[LEAD_CLASSIFICATION] classify_or_persist_error', {
              conversationId: conv.id,
              detail:
                classificationError instanceof Error ? classificationError.message : String(classificationError),
            });
          }

          if (ANA_DIAGNOSTIC_FIXED_REPLY) {
            const live = await getConversationById(conv.id);
            const inHandoff = isAnaAutomationBlockedByHandoff(live);
            console.log('[ANA_DIAGNOSTIC_FIXED_REPLY] received_inbound', {
              conversationId: conv.id,
              metaMessageId: mid,
              inHandoff,
            });
            if (inHandoff) {
              console.log('[ANA_DIAGNOSTIC_FIXED_REPLY] skip_handoff', { conversationId: conv.id });
            } else if (!waReady) {
              console.log('[ANA_DIAGNOSTIC_FIXED_REPLY] send_error', {
                conversationId: conv.id,
                metaMessageId: mid,
                reason: 'whatsapp_nao_configurado',
              });
              continue;
            } else {
              console.log('[ANA_DIAGNOSTIC_FIXED_REPLY] sending', {
                conversationId: conv.id,
                metaMessageId: mid,
                toTail: phoneDigitsTail(msg.from, 4),
              });
              try {
                const dr = await sendAnaTextMessageWithQuota({
                  conversationId: conv.id,
                  to: String(msg.from),
                  text: ANA_DIAGNOSTIC_FIXED_TEXT,
                  phase: 'ana_webhook_diagnostic_fixed_reply',
                });
                if (dr.success && dr.metaMessageId) {
                  await insertMessage(conv.id, 'assistant', ANA_DIAGNOSTIC_FIXED_TEXT, dr.metaMessageId);
                  console.log('[ANA_DIAGNOSTIC_FIXED_REPLY] sent_success', {
                    conversationId: conv.id,
                    outboundMetaMessageId: dr.metaMessageId,
                  });
                } else {
                  console.log('[ANA_DIAGNOSTIC_FIXED_REPLY] send_error', {
                    conversationId: conv.id,
                    error: dr.error ?? null,
                    code: dr.code ?? null,
                  });
                }
              } catch (e) {
                console.log('[ANA_DIAGNOSTIC_FIXED_REPLY] send_error', {
                  conversationId: conv.id,
                  detail: e instanceof Error ? e.message : String(e),
                });
              }
              continue;
            }
          }

          if (anaEmergencyHandoffActive) {
            console.log('[ANA_EMERGENCY_HANDOFF] engine_direct_call', {
              conversationId: conv.id,
              metaMessageId: mid,
              fromTail: phoneDigitsTail(msg.from, 4),
            });
            await handleIncomingMessage({
              conversationId: conv.id,
              userMessage: text,
              toPhoneNumber: String(msg.from),
              trailingUserBubbles: 1,
              inboundMetaMessageId: mid,
            });
            continue;
          }

          anaWebhookTrace('schedule_call_start', { conversationId: conv.id, metaMessageId: mid });
          try {
            scheduleWhatsAppAiAfterUserMessage(conv.id, String(msg.from), mid);
            anaWebhookTrace('schedule_call_success', { conversationId: conv.id, metaMessageId: mid });
          } catch (e) {
            anaWebhookTrace('schedule_call_error', {
              conversationId: conv.id,
              metaMessageId: mid,
              errorMessage: e instanceof Error ? e.message : String(e),
              stackShort: errorStackShort(e),
            });
            throw e;
          }
          console.log('[ANA_PIPELINE] ai_schedule_called', {
            conversationId: conv.id,
            metaMessageId: mid,
            fromTail: phoneDigitsTail(msg.from, 4),
          });
        } catch (e) {
          anaWebhookTrace('inbound_message_processing_error', {
            conversationId: conversationIdForCatch,
            metaMessageId: mid,
            errorMessage: e instanceof Error ? e.message : String(e),
            stackShort: errorStackShort(e),
          });
          throw e;
        }
      }
    }
  }
}

