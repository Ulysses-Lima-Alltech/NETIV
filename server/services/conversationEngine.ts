import { statSync } from 'fs';
import {
  getMessagesByConversationId,
  getLastUserMessageNeedingReply,
  insertMessage,
  type MessageAttachmentPayload,
} from '../repositories/messageRepository.js';
import { getOpenAIConfig, getIntegrationModelStringsRaw } from '../repositories/openaiConfigRepository.js';
import {
  getConversationById,
  setConversationEnterpriseId,
  applyAnaConversationUpdate,
  maxLeadTemperature,
  incrementAnaCustomerNameMentions,
  mergeConversationCommercialFlowState,
  mergeConfirmedCustomerNameIfEmpty,
  markAnaAskedForCustomerName,
} from '../repositories/conversationRepository.js';
import { sendTextMessage, sendLocalMediaToWhatsApp } from './whatsappMetaService.js';
import {
  pickMaterialUnavailableNeutralReply,
  pickMaterialSendFailedNeutralReply,
} from '../utils/anaMaterialReply.js';
import {
  tryMatchEnterpriseFromUserCorpus,
  explainEnterpriseMentionMatch,
} from '../repositories/enterpriseMatch.js';
import {
  getActiveEnterpriseById,
  loadAgentKnowledgeText,
  listEnterpriseFiles,
  getFileForSend,
  getVariablesMap,
  logSentFile,
  listEnterprises,
  normalizeFileCategory,
  logAnaDocInventoryForEnterprise,
  type FileCategory,
  type EnterpriseRow,
} from '../repositories/enterpriseRepository.js';
import { loadRankedKnowledgeChunksForPrompt } from '../repositories/enterpriseKnowledgeChunkRepository.js';
import { isPipelineStale } from './conversationPipelineToken.js';
import {
  generateChatCompletion,
  type ChatMessage,
  type GenerateCompletionResult,
} from './openaiService.js';
import {
  resolveEnterpriseLocationContext,
  findMunicipioInMessage,
} from '../utils/anaEnterpriseLocationContext.js';
import {
  inferRequestedProductType,
  expandTiposForCommercialPool,
  expandCadastroTipoToPool,
  tiposComercialEquivalentes,
} from '../utils/anaRequestedProductType.js';
import {
  buildAnaSystemPrompt,
  type BuildAnaSystemPromptOpts,
  type CommercialSnapshot,
  type AnaStructuredReply,
  ANA_TECHNICAL_FALLBACK_NEUTRAL,
  parseAnaJson,
  detectStrongPurchaseIntentForLeadTemperature,
  hasCatalogReopenIntent,
} from './anaAgentService.js';
import {
  finalizeAnaReplyText,
  countCustomerNameMentionsInText,
  sleepMs,
  randomAnaReplyDelayMs,
  buildGreetingSafeFallback,
  sanitizeFirstReplyCommercialLeak,
  sanitizeFirstCampaignReplyShape,
  sanitizeFinancialNegotiationOverreach,
} from '../utils/anaReplyFinalize.js';
import { applyAnaCommercialSingleAxisGuard } from '../utils/anaCommercialAxisGuard.js';
import {
  extractCustomerNameFromUserUtterance,
  replyExplicitlyAsksCustomerName,
} from '../utils/extractCustomerNameFromMessage.js';
import {
  buildUserUtterancesContext,
  computeAppointmentPreflight,
} from '../utils/anaAppointmentIntent.js';
import { extractLeadDataFromConversation } from './leadWalletExtractionService.js';
import { registerAnaAppointmentIfConfirmed } from './anaAppointmentFromChatService.js';
import {
  findOpenAppointmentForConversationAndEnterprise,
  type AppointmentRow,
} from '../repositories/appointmentRepository.js';
import {
  parseCommercialFlowState,
  computeNextCommercialFlowState,
  resetCommercialScopeHints,
  isEmptyCommercialFlowState,
  type CommercialFlowState,
} from '../utils/commercialFlowState.js';
import { resolveAnaOpenAIModel } from '../utils/resolveAnaOpenAIModel.js';
import {
  isBareGreetingOnly,
  userExplicitlyAskedForMaterial,
  inferPreferredCategoryFromUserText,
  buildDocCategoryTryOrder,
  pickPostMediaAckText,
} from '../utils/anaDocSendIntent.js';
import { applyOperationalFactGuard } from '../utils/anaOperationalFactGuard.js';
import { resolveOperationalFactAnswer } from '../utils/anaOperationalFactResolver.js';

/** TEMP diagnóstico: ignorar `integration_settings.ai_enabled` no motor da Ana. Remover após investigação. */
const ANA_FORCE_AI_DIAGNOSTIC = true;

/** Desligado para rastrear o fluxo real com [ANA_ENGINE_TRACE]. */
const ANA_ENGINE_DIAGNOSTIC_FIXED_REPLY = false;
const ANA_ENGINE_DIAGNOSTIC_TEXT = 'Diagnóstico: cheguei no conversation engine.';

/** TEMP: logs [ANA_ENGINE_TRACE] (OpenAI/parse/envio). Desligar com false. */
const ANA_ENGINE_TRACE = true;

function anaEngineTrace(tag: string, payload: Record<string, unknown>): void {
  if (!ANA_ENGINE_TRACE) return;
  console.log(`[ANA_ENGINE_TRACE] ${tag}`, payload);
}

/** Motivo do fallback com `ANA_TECHNICAL_FALLBACK_NEUTRAL` (log [ANA_FALLBACK_TRACE]). */
type AnaFallbackTraceReason =
  | 'openai_failed'
  | 'openai_http_401'
  | 'openai_http_403'
  | 'openai_http_404'
  | 'openai_http_429'
  | 'empty_raw_content'
  | 'parse_rejected'
  | 'structured_missing_reply'
  | 'unexpected_error';

function computeAnaTechnicalFallbackTraceReason(
  result: GenerateCompletionResult,
  parseAttempted: boolean
): AnaFallbackTraceReason {
  if (!result.success) {
    const err = (result.error || '').toLowerCase();
    if (/resposta vazia|choices vazio|sem content/.test(err)) {
      return 'empty_raw_content';
    }
    const st = result.httpStatus;
    if (st === 401) return 'openai_http_401';
    if (st === 403) return 'openai_http_403';
    if (st === 404) return 'openai_http_404';
    if (st === 429) return 'openai_http_429';
    if (err.includes('abort') || err.includes('aborted') || err.includes('timeout')) {
      return 'unexpected_error';
    }
    if (st != null && st >= 400) return 'openai_failed';
    return 'openai_failed';
  }
  const raw = (result.content || '').trim();
  if (!raw) {
    return 'empty_raw_content';
  }
  if (parseAttempted) {
    return 'parse_rejected';
  }
  return 'unexpected_error';
}

function logAnaFallbackTrace(params: {
  reason: AnaFallbackTraceReason;
  conversationId: number;
  result: GenerateCompletionResult;
  parseAttempted: boolean;
}): void {
  const { reason, conversationId, result, parseAttempted } = params;
  const raw = result.content ?? '';
  const hasRaw = raw.trim().length > 0;
  console.log('[ANA_FALLBACK_TRACE] fallback_selected', true);
  console.log('[ANA_FALLBACK_TRACE] reason', reason);
  console.log('[ANA_FALLBACK_TRACE] conversationId', conversationId);
  console.log('[ANA_FALLBACK_TRACE] hasRawOpenAIResponse', hasRaw);
  console.log('[ANA_FALLBACK_TRACE] hasStructuredReply', false);
  console.log('[ANA_FALLBACK_TRACE] rawOpenAIResponseLen', raw.length);
  console.log('[ANA_FALLBACK_TRACE] parseAttempted', parseAttempted);
  console.log('[ANA_FALLBACK_TRACE] httpStatus', result.httpStatus ?? null);
}

function anaPhoneTail(raw: string | null | undefined, len = 6): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length ? d.slice(-len) : null;
}

function leadSourceRawIsBatchTemplate(raw: unknown): boolean {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) return false;
  return (raw as { source?: string }).source === 'batch_template_send';
}

function anaTechnicalFallbackStructured(classificationHint: string | null): AnaStructuredReply {
  return {
    reply: ANA_TECHNICAL_FALLBACK_NEUTRAL,
    intent: 'geral',
    productType: null,
    wantsCatalog: false,
    locationPreference: null,
    budgetPreference: null,
    bedroomsPreference: null,
    bathroomsPreference: null,
    nextBestQuestion: null,
    userGoal: null,
    lotSizePreference: null,
    shouldShowPortfolio: false,
    classification: (classificationHint || 'Novo').trim() || 'Novo',
    lead_temperature: null,
    project: '',
    handoff: false,
    customer_name: '',
    summary: '',
    send_file_category: null,
    appointment_confirmed: false,
    appointment_date: null,
    appointment_time: null,
    appointment_notes: null,
  };
}

function formatOpenAppointmentSummaryForPrompt(row: AppointmentRow, enterpriseName: string): string {
  const fmt = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
  const d = row.start_at instanceof Date ? row.start_at : new Date(row.start_at);
  return `Empreendimento: ${enterpriseName}. Visita agendada: ${fmt.format(d)}. Status: ${row.status}.`;
}

/** Garante que a resposta ao cliente cite o mesmo instante gravado no banco. */
function appendCanonicalToReply(reply: string, canonicalLine: string): string {
  const r = (reply || '').trim();
  const core = canonicalLine.replace(/^Registrado no sistema:\s*/i, '').trim();
  if (!core) return reply;
  if (r.toLowerCase().includes(core.slice(0, Math.min(28, core.length)).toLowerCase())) return reply;
  if (!r) return canonicalLine;
  return `${r}\n\n${canonicalLine}`.slice(0, 4000);
}

export interface IncomingMessageContext {
  conversationId: number;
  userMessage: string;
  toPhoneNumber: string;
  /** Rajada WhatsApp: quantas bolhas de usuário no fim do histórico foram fundidas em userMessage (omitir = 1 mensagem isolada). */
  trailingUserBubbles?: number;
  /** Token da janela de debounce; nova mensagem invalida envio pendente. */
  replyPipelineToken?: number;
  /** wamid da bolha persistida no webhook (correlação ponta a ponta nos logs). */
  inboundMetaMessageId?: string | null;
}

/** Reprocessa a última mensagem do usuário sem resposta quando handoff muda true→false. */
export async function reprocessLastUserMessage(conversationId: number): Promise<void> {
  console.log('[ANA REPROCESS]', { conversationId });
  const conv = await getConversationById(conversationId);
  if (!conv) return;
  const toPhoneNumber = (conv.contact_phone || conv.external_contact_id || '').trim();
  if (!toPhoneNumber) {
    console.warn('[ConversationEngine] reprocessLastUserMessage: sem telefone na conversa', conversationId);
    return;
  }
  const lastUserMsg = await getLastUserMessageNeedingReply(conversationId);
  if (!lastUserMsg?.content?.trim()) return;
  console.log('[ConversationEngine] Reprocessando última mensagem pendente ao sair de handoff', { conversationId });
  await handleIncomingMessage({
    conversationId,
    userMessage: lastUserMsg.content,
    toPhoneNumber,
    inboundMetaMessageId: lastUserMsg.meta_message_id ?? null,
  });
}

/** Lock leve por conversationId: garante que apenas UMA mensagem por conversa seja processada por vez. */
const processingConversations = new Map<string, Promise<void>>();

async function acquireConversationLock(conversationId: number): Promise<() => void> {
  const key = String(conversationId);
  const prev = processingConversations.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((r) => { release = r; });
  processingConversations.set(key, prev.then(() => next));
  await prev;
  return release;
}

const MAX_HISTORY = 14;

function rowsToHistory(
  rows: { role: string; content: string | null }[],
  excludeLastUserText: string | null,
  mergeTrailingUserBubbles?: number
): { role: 'user' | 'assistant'; content: string }[] {
  let list = rows.map((m) => ({
    role: (m.role === 'user' ? 'user' : 'assistant') as 'user' | 'assistant',
    content: (m.content || '').trim(),
  }));
  if (mergeTrailingUserBubbles != null && mergeTrailingUserBubbles > 1) {
    let n = mergeTrailingUserBubbles;
    while (n > 0 && list.length > 0 && list[list.length - 1].role === 'user') {
      list.pop();
      n--;
    }
    if (n > 0) {
      console.warn('[ConversationEngine] mergeTrailingUserBubbles: menos bolhas de usuário no histórico que o esperado', {
        mergeTrailingUserBubbles,
        remaining: n,
      });
    }
  } else if (
    excludeLastUserText &&
    list.length > 0 &&
    list[list.length - 1].role === 'user' &&
    list[list.length - 1].content === excludeLastUserText.trim()
  ) {
    list = list.slice(0, -1);
  }
  return list.filter((m) => m.content.length > 0).slice(-MAX_HISTORY);
}

const HANDOFF_INTENT_PATTERNS = [
  'quero falar com um humano', 'quero falar com humano', 'falar com um humano',
  'quero um atendente', 'quero atendente', 'preciso de atendente',
  'prefiro falar com uma pessoa', 'prefiro falar com pessoa', 'falar com pessoa',
  'me passa para alguem', 'passa para alguem', 'me passa um atendente',
  'quero atendimento humano', 'atendimento humano',
  'transferir para humano', 'transfere para humano',
  'quero ser atendido por pessoa', 'atendido por pessoa',
  'preciso falar com humano', 'preciso de um humano',
];

function normText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
}

function hasExplicitHandoffIntent(message: string): boolean {
  return HANDOFF_INTENT_PATTERNS.some((p) => normText(message).includes(p));
}

function userExplicitlyAskedPriceInCurrentTurn(message: string): boolean {
  const n = normText(message);
  if (!n) return false;
  if (/^(valores?|precos?)\??$/.test(n)) return true;
  const explicitAskPatterns: RegExp[] = [
    /\btem\s+valor\b/,
    /\bqual\s+o\s+preco\b/,
    /\bqual\s+o\s+valor\b/,
    /\bquanto\s+(?:sai|fica|custa)\b/,
    /\bme\s+passa\s+o\s+valor\b/,
    /\btem\s+entrada\b/,
    /\bcomo\s+fica\s+o\s+pagamento\b/,
    /\btem\s+parcela\b/,
    /\btem\s+parcelas\b/,
    /\bqual\s+o\s+investimento\b/,
    /\bcondic(?:ao|oes)\b/,
    /\bcondic(?:ao|oes)\s+de\s+pagamento\b/,
    /\bentrada\b/,
    /\bfinanciamento\b/,
    /\bdesconto\b/,
    /\bparcela(?:s)?\b/,
  ];
  return explicitAskPatterns.some((re) => re.test(n));
}

/** Intervalo curto entre mídia confirmada e texto complementar (naturalidade no WhatsApp). */
const ANA_MEDIA_THEN_TEXT_GAP_MS = 2200;

type ResolvedEnterpriseFile = NonNullable<Awaited<ReturnType<typeof getFileForSend>>>;

type AnaMediaFirstResult = { ok: true } | { ok: false; error: string; code?: number; fileName: string };

/**
 * Envio de mídia ANTES do texto da Ana. Só persiste no histórico se a Meta aceitar.
 * Em falha, não grava mensagem de sucesso; o chamador ajusta o texto ao cliente.
 */
async function sendAnaEnterpriseMediaFirst(params: {
  conversationId: number;
  toPhoneNumber: string;
  ent: EnterpriseRow;
  enterpriseIdForFile: number;
  cat: FileCategory;
  preResolvedFile: ResolvedEnterpriseFile;
}): Promise<AnaMediaFirstResult> {
  const { conversationId, toPhoneNumber, ent, enterpriseIdForFile, cat, preResolvedFile: file } = params;
  console.log('[ANA_DOC_SEND_START]', {
    conversationId,
    toPhoneTail: anaPhoneTail(toPhoneNumber),
    enterpriseId: enterpriseIdForFile,
    enterpriseName: ent.name,
    category: cat,
    preResolvedFileId: file.id,
    preResolvedFileName: file.originalName,
    preResolvedFilePath: file.path,
  });
  const mediaRes = await sendLocalMediaToWhatsApp(toPhoneNumber, file.path, file.originalName, file.mime, {
    logCtx: {
      enterpriseId: enterpriseIdForFile,
      enterpriseName: ent.name,
      conversationId,
      fileCategory: cat,
      enterpriseFileId: file.id,
      relativeStoragePath: file.relativeStoragePath,
      absolutePath: file.path,
    },
    caption: null,
  });
  console.log('[ANA_DOC_UPLOAD_RESULT]', {
    conversationId,
    enterpriseId: enterpriseIdForFile,
    category: cat,
    fileId: file.id,
    fileName: file.originalName,
    ok: mediaRes.success,
    messageKind: mediaRes.messageKind ?? null,
    metaMessageId: mediaRes.metaMessageId ?? null,
    code: mediaRes.code ?? null,
    error: mediaRes.error ?? null,
  });
  if (mediaRes.success && mediaRes.metaMessageId) {
    const mk =
      mediaRes.messageKind === 'image' ? 'image' : mediaRes.messageKind === 'video' ? 'video' : 'document';
    try {
      console.log('[ANA_DOC_LOG_SENT_FILE_START]', {
        conversationId,
        enterpriseId: enterpriseIdForFile,
        category: cat,
        fileId: file.id,
      });
      await logSentFile(conversationId, file.id);
      console.log('[ANA_DOC_LOG_SENT_FILE_OK]', {
        conversationId,
        enterpriseId: enterpriseIdForFile,
        category: cat,
        fileId: file.id,
      });

      let sizeBytes: number | undefined;
      try {
        sizeBytes = statSync(file.path).size;
      } catch {
        sizeBytes = undefined;
      }
      const attachment: MessageAttachmentPayload = {
        fileName: file.originalName,
        mimeType: file.mime,
        sizeBytes,
        whatsappMediaId: mediaRes.whatsappMediaId ?? null,
        caption: null,
        enterpriseFileId: file.id,
      };
      await insertMessage(conversationId, 'assistant', `[Arquivo: ${file.originalName}]`, mediaRes.metaMessageId, {
        messageKind: mk,
        attachment,
      });
      console.log('[ANA_DOC_SEND_SUCCESS]', {
        conversationId,
        metaMessageId: mediaRes.metaMessageId,
        fileId: file.id,
        fileName: file.originalName,
        messageKind: mk,
      });
      return { ok: true };
    } catch (e) {
      const err = e instanceof Error ? e.message : String(e);
      console.error('[ANA_DOC_POST_UPLOAD_FAILED]', {
        conversationId,
        enterpriseId: enterpriseIdForFile,
        category: cat,
        fileId: file.id,
        fileName: file.originalName,
        error: err,
      });
      return {
        ok: false,
        error: `Falha após upload/aceite pela Meta: ${err}`,
        code: mediaRes.code,
        fileName: file.originalName,
      };
    }
  }
  console.error('[ANA_DOC_SEND_FAILED]', {
    conversationId,
    enterpriseIdForFile,
    category: cat,
    fileName: file.originalName,
    error: mediaRes.error ?? null,
    code: mediaRes.code ?? null,
    phase: 'upload_or_messages_meta',
    note: 'Nenhuma linha de mídia gravada em messages; texto ao cliente será substituído por falha honesta.',
  });
  return {
    ok: false,
    error: mediaRes.error || 'Falha ao enviar mídia pela Meta',
    code: mediaRes.code,
    fileName: file.originalName,
  };
}

export async function handleIncomingMessage(ctx: IncomingMessageContext): Promise<void> {
  const {
    conversationId,
    userMessage,
    toPhoneNumber,
    trailingUserBubbles,
    replyPipelineToken,
    inboundMetaMessageId: inboundMetaFromCtx,
  } = ctx;

  console.log('[ANA DEBUG] handleIncomingMessage start', { conversationId, toPhoneNumber });

  const release = await acquireConversationLock(conversationId);
  try {
    console.log('[ANA_PIPELINE] engine_start', {
      conversationId,
      toPhoneTail: anaPhoneTail(toPhoneNumber),
      replyPipelineToken: replyPipelineToken ?? null,
      inboundMetaMessageId: inboundMetaFromCtx ?? null,
      rawUserLen: userMessage.length,
      trailingUserBubbles: trailingUserBubbles ?? 1,
    });

    const trimmed = userMessage.trim();
    if (!trimmed) {
      console.log('[ANA_PIPELINE] engine_skip', {
        reason: 'empty_user_message_after_trim',
        conversationId,
        replyPipelineToken: replyPipelineToken ?? null,
      });
      console.log('[ANA DEBUG] mensagem vazia após trim — ignorando');
      return;
    }

    const aiConfig = await getOpenAIConfig();
    console.log('[ANA DEBUG] aiConfig loaded (handleIncomingMessage)', {
      hasConfig: !!aiConfig,
      hasApiKey: !!aiConfig?.openaiApiKey?.trim(),
      aiEnabled: aiConfig?.aiEnabled,
      conversationId,
    });
    if (!aiConfig) {
      console.log('[ANA_PIPELINE] engine_skip', {
        reason: 'openai_config_null',
        conversationId,
        replyPipelineToken: replyPipelineToken ?? null,
      });
      console.error('[ANA DEBUG] getOpenAIConfig retornou null — ignorando mensagem.');
      return;
    }
    if (!aiConfig.openaiApiKey?.trim()) {
      console.log('[ANA_PIPELINE] engine_skip', {
        reason: 'openai_api_key_missing',
        conversationId,
        replyPipelineToken: replyPipelineToken ?? null,
      });
      console.warn('[ANA DEBUG] OpenAI API Key não configurada — ignorando mensagem.');
      return;
    }
    if (!aiConfig.aiEnabled && !ANA_FORCE_AI_DIAGNOSTIC) {
      console.log('[ANA_PIPELINE] engine_skip', {
        reason: 'ai_disabled_in_db',
        conversationId,
        replyPipelineToken: replyPipelineToken ?? null,
      });
      console.log('[ANA DEBUG] aiEnabled check blocked — ai_enabled=false no banco.');
      return;
    }
    if (ANA_FORCE_AI_DIAGNOSTIC && !aiConfig.aiEnabled) {
      console.log('[ANA_FORCE_AI]', {
        enabled: true,
        bypassWhere: 'conversationEngine.handleIncomingMessage',
        ai_enabled_in_db: aiConfig.aiEnabled,
        hasOpenaiKey: true,
        conversationId,
      });
    }
    console.log('[ANA DEBUG] aiEnabled check passed');

    let conv = await getConversationById(conversationId);
    if (!conv) {
      console.log('[ANA_PIPELINE] engine_skip', {
        reason: 'conversation_not_found',
        conversationId,
        replyPipelineToken: replyPipelineToken ?? null,
      });
      console.error('[ANA DEBUG] conversa inexistente', { conversationId });
      return;
    }
    let flowStateParsed: CommercialFlowState = parseCommercialFlowState(conv.commercial_flow_state) ?? {};
    const previousProductTypeHintForLog = flowStateParsed.productTypeHint ?? null;
    console.log('[ANA DEBUG] conversation loaded', { conversationId, handoff: conv.handoff, classification: conv.classification });
    console.log('[ANA_PIPELINE] conversation_state', {
      conversationId,
      enterpriseId: conv.enterprise_id ?? null,
      enterpriseOriginId: conv.enterprise_origin_id ?? null,
      handoff: conv.handoff,
      classification: conv.classification,
      manualClosedAt: conv.manual_closed_at != null,
    });
    console.log('[ANA_PIPELINE] conversation_phone_context', {
      conversationId,
      toPhoneTail: anaPhoneTail(toPhoneNumber),
      externalContactIdTail: anaPhoneTail(conv.external_contact_id),
      contactPhoneTail: anaPhoneTail(conv.contact_phone),
      externalMatchesToParam:
        String(toPhoneNumber).replace(/\D/g, '') === String(conv.external_contact_id ?? '').replace(/\D/g, ''),
    });

    // Revalidação imediata antes do bloqueio: sempre buscar estado mais recente (evita race: usuário muda Handoff→ANA durante processamento)
    const latestConv = await getConversationById(conversationId);
    let effectiveConv = latestConv ?? conv;

    console.log('[ANA DEBUG] handoff check', {
      handoff: effectiveConv.handoff,
      classification: effectiveConv.classification,
      conversationId,
    });

    // Decisão final SEMPRE com base no estado mais recente. Modo handoff: NÃO responder. Modo ANA: SEMPRE responder via IA.
    if (effectiveConv.handoff === true || effectiveConv.classification === 'Handoff') {
      if (ANA_ENGINE_DIAGNOSTIC_FIXED_REPLY) {
        console.log('[ANA_ENGINE_DIAGNOSTIC] skip_handoff', {
          conversationId,
          handoff: effectiveConv.handoff,
          classification: effectiveConv.classification,
        });
      }
      console.log('[ANA_PIPELINE] engine_blocked_handoff', {
        conversationId,
        handoff: effectiveConv.handoff,
        classification: effectiveConv.classification,
        toPhoneTail: anaPhoneTail(toPhoneNumber),
        inboundMetaMessageId: inboundMetaFromCtx ?? null,
      });
      console.log('[ANA DEBUG] handoff check blocked — conversa em modo humano, ANA não responde', {
        conversationId,
        handoff: effectiveConv.handoff,
        classification: effectiveConv.classification,
      });
      return;
    }
    console.log('[ANA DEBUG] handoff check passed');

    if (hasExplicitHandoffIntent(trimmed)) {
      const mergedLeadOnHandoff = maxLeadTemperature(
        effectiveConv.lead_temperature,
        detectStrongPurchaseIntentForLeadTemperature(trimmed) ? 'quente' : null
      );
      await applyAnaConversationUpdate(conversationId, {
        classification: 'Handoff',
        ...(mergedLeadOnHandoff != null ? { lead_temperature: mergedLeadOnHandoff } : {}),
        handoff: true,
      });
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        console.log('[ANA_PIPELINE] engine_cancelled_stale', {
          conversationId,
          replyPipelineToken: replyPipelineToken ?? null,
          phase: 'handoff_before_send',
          inboundMetaMessageId: inboundMetaFromCtx ?? null,
        });
        return;
      }
      const confirmMsg = finalizeAnaReplyText(
        'Entendido! Um atendente vai entrar em contato em breve. Enquanto isso, sua mensagem já foi registrada. Posso te ajudar com mais alguma coisa antes da transferência?'
      );
      await sleepMs(randomAnaReplyDelayMs({ replyLength: confirmMsg.length }));
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        console.log('[ANA_PIPELINE] engine_cancelled_stale', {
          conversationId,
          replyPipelineToken: replyPipelineToken ?? null,
          phase: 'after_handoff_intent_delay',
          inboundMetaMessageId: inboundMetaFromCtx ?? null,
        });
        return;
      }
      console.log('[ANA_PIPELINE] engine_send_attempt', {
        conversationId,
        toPhoneTail: anaPhoneTail(toPhoneNumber),
        inboundMetaMessageId: inboundMetaFromCtx ?? null,
        replyPipelineToken: replyPipelineToken ?? null,
        phase: 'handoff_intent_confirm',
        textLen: confirmMsg.length,
      });
      const sendResult = await sendTextMessage(toPhoneNumber, confirmMsg);
      if (sendResult.success && sendResult.metaMessageId) {
        await insertMessage(conversationId, 'assistant', confirmMsg, sendResult.metaMessageId);
        console.log('[ANA_PIPELINE] engine_send_success', {
          conversationId,
          phase: 'handoff_intent_confirm',
          outboundMetaMessageId: sendResult.metaMessageId,
          inboundMetaMessageId: inboundMetaFromCtx ?? null,
        });
      } else {
        console.log('[ANA_PIPELINE] engine_send_fail', {
          conversationId,
          phase: 'handoff_intent_confirm',
          inboundMetaMessageId: inboundMetaFromCtx ?? null,
          error: sendResult.error ?? null,
          code: sendResult.code ?? null,
          toPhoneTail: anaPhoneTail(toPhoneNumber),
        });
      }
      return;
    }

    if (ANA_ENGINE_DIAGNOSTIC_FIXED_REPLY) {
      console.log('[ANA_ENGINE_DIAGNOSTIC] engine_entered', {
        conversationId,
        inboundMetaMessageId: inboundMetaFromCtx ?? null,
      });
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        console.log('[ANA_ENGINE_DIAGNOSTIC] send_error', {
          conversationId,
          reason: 'pipeline_stale',
          replyPipelineToken: replyPipelineToken ?? null,
        });
        return;
      }
      console.log('[ANA_ENGINE_DIAGNOSTIC] sending', {
        conversationId,
        toPhoneTail: anaPhoneTail(toPhoneNumber),
      });
      try {
        const diagSend = await sendTextMessage(toPhoneNumber, ANA_ENGINE_DIAGNOSTIC_TEXT);
        if (diagSend.success && diagSend.metaMessageId) {
          await insertMessage(conversationId, 'assistant', ANA_ENGINE_DIAGNOSTIC_TEXT, diagSend.metaMessageId);
          console.log('[ANA_ENGINE_DIAGNOSTIC] sent_success', {
            conversationId,
            outboundMetaMessageId: diagSend.metaMessageId,
          });
        } else {
          console.log('[ANA_ENGINE_DIAGNOSTIC] send_error', {
            conversationId,
            error: diagSend.error ?? null,
            code: diagSend.code ?? null,
          });
        }
      } catch (e) {
        console.log('[ANA_ENGINE_DIAGNOSTIC] send_error', {
          conversationId,
          detail: e instanceof Error ? e.message : String(e),
        });
      }
      return;
    }

    const rows = await getMessagesByConversationId(conversationId);
    anaEngineTrace('rows_loaded', { conversationId, rowCount: rows.length });
    const lastAssistantBeforeUser = [...rows].reverse().find((m) => m.role === 'assistant');
    const lastAssistantPlain = lastAssistantBeforeUser?.content?.trim() || null;
    const trustedCustomerName =
      extractCustomerNameFromUserUtterance(trimmed, { lastAssistantPlain }) || null;
    if (trustedCustomerName) {
      const mergedName = await mergeConfirmedCustomerNameIfEmpty(conversationId, trustedCustomerName);
      if (mergedName) {
        const refreshedAfterName = await getConversationById(conversationId);
        if (refreshedAfterName) {
          effectiveConv = refreshedAfterName;
          conv = refreshedAfterName;
        }
      }
    }
    let lastUserMessageAt = new Date();
    for (let i = rows.length - 1; i >= 0; i--) {
      if (rows[i].role === 'user') {
        lastUserMessageAt = new Date(rows[i].created_at);
        break;
      }
    }
    const allActiveEnterprises = await listEnterprises(true);
    const fullUserUtterances = buildUserUtterancesContext(rows);
    const triageRequestedProductType = inferRequestedProductType(trimmed, fullUserUtterances);
    const acceptedTiposPool = expandTiposForCommercialPool(triageRequestedProductType);
    const enterprisesPool =
      acceptedTiposPool == null
        ? allActiveEnterprises
        : allActiveEnterprises.filter((e) => acceptedTiposPool.includes(e.tipo));
    const appointmentPreflight = computeAppointmentPreflight(trimmed, fullUserUtterances);
    const locGlobal = resolveEnterpriseLocationContext(trimmed, fullUserUtterances, allActiveEnterprises);

    const globalMatchId = tryMatchEnterpriseFromUserCorpus(trimmed, allActiveEnterprises);
    const mentionExplain = explainEnterpriseMentionMatch(trimmed, allActiveEnterprises, globalMatchId);

    let scopeMutated = false;
    const entFocusForScope =
      effectiveConv.enterprise_id != null ? await getActiveEnterpriseById(effectiveConv.enterprise_id) : null;
    if (entFocusForScope) {
      if (globalMatchId != null && globalMatchId !== entFocusForScope.id) {
        await setConversationEnterpriseId(conversationId, globalMatchId);
        await mergeConversationCommercialFlowState(conversationId, resetCommercialScopeHints(flowStateParsed));
        scopeMutated = true;
      } else if (locGlobal != null) {
        await setConversationEnterpriseId(conversationId, null);
        await mergeConversationCommercialFlowState(conversationId, resetCommercialScopeHints(flowStateParsed));
        scopeMutated = true;
      } else if (triageRequestedProductType !== 'INDEFINIDO' && !tiposComercialEquivalentes(entFocusForScope.tipo, triageRequestedProductType)) {
        await setConversationEnterpriseId(conversationId, null);
        await mergeConversationCommercialFlowState(conversationId, resetCommercialScopeHints(flowStateParsed));
        scopeMutated = true;
      } else if (!appointmentPreflight.active && hasCatalogReopenIntent(trimmed)) {
        await setConversationEnterpriseId(conversationId, null);
        await mergeConversationCommercialFlowState(conversationId, resetCommercialScopeHints(flowStateParsed));
        scopeMutated = true;
      }
    }
    if (scopeMutated) {
      const refreshed = await getConversationById(conversationId);
      if (refreshed) {
        effectiveConv = refreshed;
        flowStateParsed = parseCommercialFlowState(refreshed.commercial_flow_state) ?? {};
      }
    }

    const locationQueryContext = resolveEnterpriseLocationContext(
      trimmed,
      fullUserUtterances,
      enterprisesPool
    );

    const muni = findMunicipioInMessage(`${trimmed}\n${fullUserUtterances}`);
    console.log('[ANA_INTENT]', {
      conversationId,
      userText: trimmed.slice(0, 500),
      inferredProductType: triageRequestedProductType,
      inferredCity: muni?.n ?? null,
      mentionedEnterpriseName: mentionExplain.bestEnterpriseName,
      previousProductTypeHint: previousProductTypeHintForLog,
    });
    console.log('[ANA_MENTION_DEBUG]', {
      conversationId,
      userText: trimmed.slice(0, 400),
      mentionedEnterpriseName: mentionExplain.bestEnterpriseName,
      matchedByName: mentionExplain.matchedByName,
      matchedBySlug: mentionExplain.matchedBySlug,
      matchedEnterpriseId: globalMatchId,
    });

    let ent =
      effectiveConv.enterprise_id != null ? await getActiveEnterpriseById(effectiveConv.enterprise_id) : null;
    const inactiveLinked = Boolean(effectiveConv.enterprise_id && !ent);

    let openAppointmentSummary: string | null = null;
    if (ent?.id) {
      const openAppt = await findOpenAppointmentForConversationAndEnterprise(conversationId, ent.id);
      if (openAppt) {
        openAppointmentSummary = formatOpenAppointmentSummaryForPrompt(openAppt, ent.name);
      }
    }

    let mode: 'triage' | 'scoped' | 'inactive_linked' = 'triage';
    if (inactiveLinked) mode = 'inactive_linked';
    else if (ent) mode = 'scoped';

    const conversationPhase =
      inactiveLinked
        ? 'inactive'
        : appointmentPreflight.active
          ? 'appointment'
          : ent
            ? 'scoped'
            : locationQueryContext
              ? 'triage_location'
              : triageRequestedProductType === 'INDEFINIDO'
                ? 'triage_ask_type'
                : 'triage_catalog';

    const focusEnterprise = ent;
    const enterprisesForSameTipoAsEnt =
      focusEnterprise == null
        ? []
        : allActiveEnterprises.filter((e) => expandCadastroTipoToPool(focusEnterprise.tipo).includes(e.tipo));

    const vars = ent ? await getVariablesMap(ent.id) : {};
    let commercialSnapshots: CommercialSnapshot[] = [];
    if (mode === 'scoped' && ent) {
      commercialSnapshots = [{ enterpriseName: ent.name, variables: vars }];
    } else {
      for (const e of enterprisesPool) {
        commercialSnapshots.push({ enterpriseName: e.name, variables: await getVariablesMap(e.id) });
      }
    }

    const chunkHint = [trimmed, fullUserUtterances].filter(Boolean).join('\n').slice(0, 12_000);
    const knowledgeParts: string[] = [];
    const knowledgeIds =
      ent != null
        ? [ent.id]
        : enterprisesPool.length <= 6
          ? enterprisesPool.map((e) => e.id)
          : enterprisesPool.slice(0, 4).map((e) => e.id);
    for (const eid of knowledgeIds) {
      const row = allActiveEnterprises.find((x) => x.id === eid);
      if (!row) continue;
      const cityPriority = muni?.n ?? row.city ?? null;
      const chunk = await loadRankedKnowledgeChunksForPrompt(eid, `${row.name}\n${chunkHint}`, {
        targetCity: cityPriority,
      });
      const kb = await loadAgentKnowledgeText(eid);
      const merged = [chunk, kb].filter(Boolean).join('\n\n');
      if (merged.trim()) knowledgeParts.push(`--- ${row.name} ---\n${merged}`);
    }
    const knowledgeText = knowledgeParts.join('\n\n').slice(0, 52_000);

    let fileInventory = '';
    let hasSendableFiles = false;
    let sendableAnaCategories: FileCategory[] = [];
    if (ent) {
      const files = await listEnterpriseFiles(ent.id);
      const sendableRows = files.filter((f) => f.is_active && f.can_be_sent_by_ana);
      sendableAnaCategories = [
        ...new Set(
          sendableRows
            .map((f) => normalizeFileCategory(f.category))
            .filter((c): c is FileCategory => c != null)
        ),
      ];
      fileInventory = sendableRows.map((f) => `${f.category}: ${f.original_name}`).join('; ');
      hasSendableFiles = sendableAnaCategories.length > 0;
    }

    let allEnterpriseNames: string[] = [];
    if (mode === 'scoped' && ent) {
      allEnterpriseNames = enterprisesForSameTipoAsEnt.map((e) => e.name);
    } else if (locationQueryContext) {
      allEnterpriseNames = locationQueryContext.availableEnterprises.map((e) => e.name);
    } else {
      allEnterpriseNames =
        triageRequestedProductType === 'INDEFINIDO'
          ? []
          : enterprisesPool.map((e) => e.name);
    }

    const scopedEnterpriseNames =
      mode === 'scoped' && ent ? enterprisesForSameTipoAsEnt.map((e) => e.name) : [];

    const promptProductTypeForPrompt =
      mode === 'triage'
        ? triageRequestedProductType
        : mode === 'scoped' && ent
          ? ent.tipo
          : undefined;

    const persistedContextBlock = [
      `enterprise_id_conversa: ${effectiveConv.enterprise_id ?? 'null'}`,
      `estado_comercial_json: ${
        isEmptyCommercialFlowState(effectiveConv.commercial_flow_state) ? 'null' : JSON.stringify(flowStateParsed)
      }`,
      `tipo_interesse_inferido_hint: ${triageRequestedProductType}`,
    ].join('\n');

    const lastUserRowForLog = [...rows].reverse().find((r) => r.role === 'user');
    const inboundMetaMessageId = lastUserRowForLog?.meta_message_id ?? inboundMetaFromCtx ?? null;

    const history =
      trailingUserBubbles != null && trailingUserBubbles > 1
        ? rowsToHistory(rows, null, trailingUserBubbles)
        : rowsToHistory(rows, trimmed);
    const historyCount = history.length;
    const isFirstAnaReply = !rows.some((m) => m.role === 'assistant');
    const explicitPriceAskedThisTurn = userExplicitlyAskedPriceInCurrentTurn(trimmed);

    if (historyCount === 0) {
      console.log('[CLEAR_HISTORY_AFTER]', {
        conversationId,
        afterMessagesCount: rows.length,
        newStage: flowStateParsed.stage ?? null,
        newProductTypeHint: flowStateParsed.productTypeHint ?? null,
        newLastCatalogOfferedNames: flowStateParsed.lastCatalogOfferedNames ?? null,
        newLastSingleCatalogEnterpriseId: flowStateParsed.lastSingleCatalogEnterpriseId ?? null,
        clearedAt: flowStateParsed.clearedAt ?? null,
        note: 'openai_thread_empty_prior_turn',
      });
    }

    console.log('[ANA_SCOPE_DEBUG]', {
      conversationId,
      userText: trimmed.slice(0, 400),
      stage: conversationPhase,
      productTypeHint: flowStateParsed.productTypeHint ?? triageRequestedProductType,
      lastCatalogOfferedNames: flowStateParsed.lastCatalogOfferedNames ?? null,
      allEnterpriseNames: allActiveEnterprises.map((e) => e.name),
      scopedEnterpriseNames,
      finalEnterpriseNames: allEnterpriseNames,
      mode,
    });

    const stateBefore = {
      enterpriseId: effectiveConv.enterprise_id,
      flowState: flowStateParsed,
    };

    anaEngineTrace('prompt_build_start', { conversationId, historyCount, mode });
    const promptOpts: BuildAnaSystemPromptOpts = {
      mode,
      enterprise: ent,
      variablesMap: vars,
      knowledgeText,
      fileInventory,
      allEnterpriseNames,
      requestedProductType: promptProductTypeForPrompt,
      knownCustomerName: effectiveConv.customer_name,
      customerNameMentionsSoFar: effectiveConv.ana_customer_name_mentions ?? 0,
      anaAskedCustomerName: effectiveConv.ana_asked_customer_name === true,
      conversationClassification: effectiveConv.classification,
      appointmentPreflight,
      openAppointmentSummary,
      locationQueryContext:
        mode === 'scoped' && ent ? undefined : (locationQueryContext ?? undefined),
      commercialSnapshots: commercialSnapshots.length > 0 ? commercialSnapshots : undefined,
      persistedContextBlock,
      isFirstAnaReply,
      explicitPriceAskedThisTurn,
      postOutboundTemplateBatch:
        mode === 'scoped' && leadSourceRawIsBatchTemplate(effectiveConv.lead_source_raw),
    };

    const rawModels = await getIntegrationModelStringsRaw();
    const anaModelResolution = resolveAnaOpenAIModel({
      modelHotLeadFromDb: rawModels.modelHotLead,
      modelColdLeadFromDb: rawModels.modelColdLead,
    });
    const model = anaModelResolution.finalModel;

    console.log('[ANA_MODEL_RESOLVE]', {
      conversationId,
      messageId: inboundMetaMessageId,
      configuredModelFromDb: anaModelResolution.configuredModelFromDb,
      configuredModelFromEnv: anaModelResolution.configuredModelFromEnv,
      finalModel: anaModelResolution.finalModel,
      sourceOfFinalModel: anaModelResolution.sourceOfFinalModel,
    });

    console.log('[ANA_CHAT_AUDIT]', {
      conversationId,
      messageId: inboundMetaMessageId,
      userText: trimmed.slice(0, 500),
      historyCount,
      stateBefore,
      phase: 'pre_openai',
      openAiCalled: false,
      openAiModel: model,
      pipelineStale: isPipelineStale(conversationId, replyPipelineToken),
    });

    console.log('[ANA_PROMPT_COMMERCIAL]', {
      conversationId,
      productTypeHint: promptProductTypeForPrompt ?? flowStateParsed.productTypeHint ?? triageRequestedProductType,
      offeredNames: allEnterpriseNames,
    });

    const systemPrompt = buildAnaSystemPrompt(promptOpts);

    console.log('[ANA_HISTORY_LOAD]', {
      conversationId,
      userText: trimmed.slice(0, 500),
      historyCount,
      stage: flowStateParsed.stage ?? conversationPhase,
      productTypeHint: flowStateParsed.productTypeHint ?? null,
      lastCatalogOfferedNames: flowStateParsed.lastCatalogOfferedNames ?? null,
      clearedAt: flowStateParsed.clearedAt ?? null,
    });
    // [ANA_HISTORY_WINDOW] — rastreabilidade de quanto contexto chega ao modelo
    console.log('[ANA_HISTORY_WINDOW]', {
      conversationId,
      totalDbRows: rows.length,
      historyPassedToModel: historyCount,
      maxHistory: MAX_HISTORY,
      isGreeting: isBareGreetingOnly(trimmed),
    });

    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    for (const h of history) {
      messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: 'user', content: trimmed });

    anaEngineTrace('prompt_build_done', {
      conversationId,
      systemPromptLen: systemPrompt.length,
      messagesCount: messages.length,
    });

    console.log('[ANA MODEL] modelo_final_selecionado', {
      conversationId,
      model,
      model_used: model,
      sourceOfFinalModel: anaModelResolution.sourceOfFinalModel,
      mode,
      enterprise: ent?.name ?? null,
      appointmentPreflight: appointmentPreflight.active,
    });
    anaEngineTrace('openai_request_start', {
      conversationId,
      model,
      messagesCount: messages.length,
    });
    anaEngineTrace('generateChatCompletion_before', {
      conversationId,
      model,
      messagesCount: messages.length,
    });
    const result = await generateChatCompletion({
      apiKey: aiConfig.openaiApiKey,
      baseUrl: aiConfig.openaiBaseUrl,
      model,
      messages,
      temperature: Math.min(aiConfig.temperature ?? 0.5, 0.75),
      maxTokens: Math.max(aiConfig.maxTokens ?? 600, 800),
      responseFormatJson: true,
    });
    anaEngineTrace('generateChatCompletion_after', {
      conversationId,
      success: result.success,
      httpStatus: result.httpStatus ?? null,
      rawLen: (result.content || '').length,
      errorPreview: result.error ? String(result.error).slice(0, 200) : null,
    });

    const openAiApiError =
      !result.success && result.error ? result.error.slice(0, 800) : null;
    const openAiHttpStatus = result.httpStatus;

    if (result.success) {
      anaEngineTrace('openai_request_success', {
        conversationId,
        rawLen: (result.content || '').length,
        httpStatus: result.httpStatus ?? null,
      });
      console.log('[ANA MODEL] resposta_recebida', { conversationId, model, hasContent: !!result.content?.trim() });
      console.log('[ANA_MODEL_OUTPUT]', {
        conversationId,
        raw_model_output_preview: (result.content || '').slice(0, 260),
      });
    } else {
      anaEngineTrace('openai_request_error', {
        conversationId,
        error: result.error ?? null,
        httpStatus: openAiHttpStatus ?? null,
      });
      console.error('[ANA MODEL] chamada_falhou', {
        conversationId,
        model,
        error: result.error,
        httpStatus: openAiHttpStatus,
      });
    }

    const openAiCalled = true;
    let replySource: 'openai' | 'technical_fallback' = 'openai';
    let fallbackReason: string | null = null;
    const rawContent = result.content ?? '';
    const rawTrimmed = rawContent.trim();
    const parseAttempted = result.success && rawTrimmed.length > 0;
    anaEngineTrace('parse_start', {
      conversationId,
      rawLen: rawContent.length,
      willCallParse: parseAttempted,
    });
    anaEngineTrace('parseAnaJson_before', {
      conversationId,
      rawLen: rawTrimmed.length,
      willCallParse: parseAttempted,
    });
    let structured: AnaStructuredReply | null = parseAttempted
      ? parseAnaJson(rawContent, { conversationId, messageId: inboundMetaMessageId })
      : null;
    anaEngineTrace('parseAnaJson_after', {
      conversationId,
      ok: structured != null,
      hasStructuredReply: !!(structured?.reply?.trim()),
    });
    if (structured) {
      anaEngineTrace('parse_success', {
        conversationId,
        hasStructuredReply: !!(structured.reply?.trim()),
      });
    } else {
      anaEngineTrace('parse_error', {
        conversationId,
        reason: !result.success ? 'openai_failed' : !rawTrimmed ? 'empty_raw_content' : 'parse_rejected_or_null',
      });
    }
    console.log('[ANA_PARSE_FLOW]', {
      conversationId,
      parseAnaJson_success: Boolean(structured),
      parseAnaJson_fail: !structured,
    });
    if (!structured) {
      const traceReason = computeAnaTechnicalFallbackTraceReason(result, parseAttempted);
      logAnaFallbackTrace({
        reason: traceReason,
        conversationId,
        result,
        parseAttempted,
      });
      fallbackReason = traceReason;
      replySource = 'technical_fallback';

      const isGreetingForFallback = isBareGreetingOnly(trimmed);

      // [ANA_CONTINUATION_FALLBACK] — log centralizado para todo fallback técnico
      console.log('[ANA_CONTINUATION_FALLBACK]', {
        conversationId,
        messageId: inboundMetaMessageId,
        reason: fallbackReason,
        isGreeting: isGreetingForFallback,
        userTextPreview: trimmed.slice(0, 60),
        ...(openAiApiError && { openAiApiError, openAiHttpStatus }),
      });
      console.log('[ANA_PARSE_FLOW]', {
        conversationId,
        technical_fallback_used: true,
      });

      structured = anaTechnicalFallbackStructured(effectiveConv.classification);

      // ── GREETING BYPASS ────────────────────────────────────────────────────
      // Saudações simples (oi, olá, bom dia, etc.) NUNCA devem receber a
      // mensagem de erro técnico "Não consegui continuar daqui agora...".
      // Se o pipeline falhou por qualquer razão técnica mas a mensagem atual
      // é apenas uma saudação, substituímos por uma resposta neutra e humana.
      if (isGreetingForFallback) {
        const safeReply = buildGreetingSafeFallback(effectiveConv.customer_name);
        structured = { ...structured, reply: safeReply };
        console.log('[ANA_GREETING_BYPASS]', {
          conversationId,
          reason: 'technical_fallback_suppressed_for_bare_greeting',
          fallbackReason,
          safeReply: safeReply.slice(0, 100),
        });
      }
    }

    if (structured.project?.trim()) {
      const pid = tryMatchEnterpriseFromUserCorpus(structured.project.trim(), allActiveEnterprises);
      if (pid != null) {
        if (effectiveConv.enterprise_id !== pid) {
          await setConversationEnterpriseId(conversationId, pid);
          effectiveConv = (await getConversationById(conversationId)) ?? effectiveConv;
        }
        ent = await getActiveEnterpriseById(pid);
        if (ent) {
          const files = await listEnterpriseFiles(ent.id);
          const sendableRows = files.filter((f) => f.is_active && f.can_be_sent_by_ana);
          sendableAnaCategories = [
            ...new Set(
              sendableRows
                .map((f) => normalizeFileCategory(f.category))
                .filter((c): c is FileCategory => c != null)
            ),
          ];
          fileInventory = sendableRows.map((f) => `${f.category}: ${f.original_name}`).join('; ');
          hasSendableFiles = sendableAnaCategories.length > 0;
        }
      }
    }

    let preResolvedFileForAna: Awaited<ReturnType<typeof getFileForSend>> = null;
    let effectiveSendCategory: FileCategory | null = null;
    let requestedSendCategoryForLog: FileCategory | null = null;
    let fileResolutionSkipReason: string | null = null;
    const bareGreeting = isBareGreetingOnly(trimmed);

    // ─── ANA DOC GATE ────────────────────────────────────────────────────────
    // Regra: envio de arquivo SOMENTE quando a mensagem ATUAL do usuário contiver
    // pedido explícito de material (verbo de envio + substantivo de documento).
    // O campo send_file_category do LLM NÃO é usado como gatilho — ele pode
    // disparar por sinais indiretos (preço, localização, "quero saber mais") e
    // causaria envio não autorizado.
    const { explicit: userExplicit, matchedPattern: materialMatchedPattern } =
      userExplicitlyAskedForMaterial(trimmed);
    const userMaterialAsk = userExplicit && !bareGreeting;
    const shouldAttemptDocSend = !bareGreeting && userMaterialAsk;

    console.log('[ANA_DOC_GATE]', {
      conversationId,
      explicit: userMaterialAsk,
      bareGreeting,
      shouldAttemptDocSend,
      enterpriseId: ent?.id ?? null,
      sendableCategories: sendableAnaCategories,
      currentTrimmedPreview: trimmed.slice(0, 80),
    });
    if (materialMatchedPattern) {
      console.log('[ANA_DOC_GATE_REASON]', {
        conversationId,
        matched_pattern: materialMatchedPattern,
      });
    }

    if (!shouldAttemptDocSend) {
      structured = { ...structured, send_file_category: null };
      fileResolutionSkipReason = 'no_material_intent_this_turn';
      console.log('[ANA_DOC_SEND_SKIPPED]', {
        conversationId,
        reason: 'no_explicit_request',
      });
      console.log('[ANA_DOC_RESOLVE_SKIP]', {
        conversationId,
        enterpriseId: ent?.id ?? null,
        reason: fileResolutionSkipReason,
      });
    } else if (!hasSendableFiles || !ent) {
      fileResolutionSkipReason = !ent ? 'no_enterprise_focus_for_file' : 'no_sendable_files_in_enterprise_focus';
      console.log('[ANA_DOC_RESOLVE_SKIP]', {
        conversationId,
        enterpriseId: ent?.id ?? null,
        enterpriseName: ent?.name ?? null,
        requestedCategory: structured.send_file_category ?? null,
        hasSendableFiles,
        reason: fileResolutionSkipReason,
      });
      structured = { ...structured, send_file_category: null };
    } else {
      const userCatHint = inferPreferredCategoryFromUserText(trimmed);
      const llmCat = structured.send_file_category;
      requestedSendCategoryForLog = llmCat ?? userCatHint;
      const tryOrder = buildDocCategoryTryOrder(llmCat, userCatHint, sendableAnaCategories);
      await logAnaDocInventoryForEnterprise(ent.id);
      if (tryOrder.length === 0) {
        console.log('[ANA_DOC_LOOKUP_MISS_REASON]', {
          conversationId,
          enterpriseId: ent.id,
          reason: 'empty_try_order_no_category_passes_send_filters',
          sendableAnaCategories,
          note: 'Nenhum arquivo com is_active e can_be_sent_by_ana na listagem; getFileForSend não será chamado.',
        });
      }
      console.log('[ANA_DOC_RESOLVE_TRY]', {
        conversationId,
        enterpriseId: ent.id,
        enterpriseName: ent.name,
        tryOrder,
        llmCategory: llmCat,
        userHint: userCatHint,
        sendableAnaCategoriesFromEngine: sendableAnaCategories,
      });
      let resolvedFile: Awaited<ReturnType<typeof getFileForSend>> = null;
      let winningCat: FileCategory | null = null;
      for (const cat of tryOrder) {
        const f = await getFileForSend(ent.id, cat);
        if (f) {
          resolvedFile = f;
          winningCat = cat;
          break;
        }
      }
      if (!resolvedFile || !winningCat) {
        fileResolutionSkipReason = 'file_not_found_or_missing_on_disk_after_try_order';
        effectiveSendCategory = null;
        structured = { ...structured, send_file_category: null };
        console.log('[ANA_DOC_RESOLVE_SKIP]', {
          conversationId,
          enterpriseId: ent.id,
          enterpriseName: ent.name,
          tryOrder,
          reason: fileResolutionSkipReason,
        });
      } else {
        preResolvedFileForAna = resolvedFile;
        effectiveSendCategory = winningCat;
        structured = { ...structured, send_file_category: winningCat };
        console.log('[ANA_DOC_RESOLVE_OK]', {
          conversationId,
          enterpriseId: ent.id,
          enterpriseName: ent.name,
          category: effectiveSendCategory,
          preResolvedFileForAna: {
            id: resolvedFile.id,
            name: resolvedFile.originalName,
            path: resolvedFile.path,
          },
        });
      }
    }
    console.log('[ANA_PARSE_FLOW]', {
      conversationId,
      replySource,
      fallbackReason,
    });

    const prevClassification = effectiveConv.classification;

    console.log('[DOC_FLOW] structured final (pronto para texto + arquivo)', {
      conversationId,
      mode,
      send_file_category: structured.send_file_category,
      enterprise_id_conv: effectiveConv.enterprise_id,
      ent_id_loaded: ent?.id ?? null,
      ent_name: ent?.name ?? null,
      inactive_linked: inactiveLinked,
    });

    const mergedLeadForAna = maxLeadTemperature(
      effectiveConv.lead_temperature,
      structured.lead_temperature,
      detectStrongPurchaseIntentForLeadTemperature(trimmed) ? 'quente' : null
    );
    await applyAnaConversationUpdate(conversationId, {
      classification: structured.classification,
      ...(mergedLeadForAna != null ? { lead_temperature: mergedLeadForAna } : {}),
      ...(trustedCustomerName ? { customer_name: trustedCustomerName } : {}),
      handoff: structured.handoff,
    });

    let replyBody = structured.reply;
    const convForApptRegister = await getConversationById(conversationId);
    if (ent && structured.appointment_confirmed) {
      try {
        const apptRes = await registerAnaAppointmentIfConfirmed({
          conversationId,
          customerName: (convForApptRegister?.customer_name || trustedCustomerName || '').trim() || 'Cliente',
          customerPhone: (convForApptRegister?.contact_phone || convForApptRegister?.external_contact_id || '').replace(/\D/g, ''),
          enterpriseId: ent.id,
          city: '',
          appointmentConfirmed: true,
          appointmentDateYmd: structured.appointment_date,
          appointmentTimeHm: structured.appointment_time,
          notes: structured.appointment_notes,
          brokerId: convForApptRegister?.assigned_broker_id ?? null,
          userUtteranceText: fullUserUtterances.trim() || trimmed,
          referenceNow: lastUserMessageAt,
        });
        if (apptRes.persisted && apptRes.canonicalLine) {
          replyBody = appendCanonicalToReply(structured.reply, apptRes.canonicalLine);
        }
      } catch (e) {
        console.error('[ANA APPT]', e);
      }
    }

    // Guard leve de abertura comercial: só na primeira resposta da Ana e somente
    // quando o cliente NÃO pediu preço/valor/condições explicitamente.
    if (isFirstAnaReply && !explicitPriceAskedThisTurn) {
      const before = replyBody;
      const sanitized = sanitizeFirstReplyCommercialLeak(replyBody);
      if (sanitized.removedCommercialSentences > 0) {
        replyBody = sanitized.text;
        console.log('[ANA_FIRST_REPLY_COMMERCIAL_GUARD]', {
          conversationId,
          removedCommercialSentences: sanitized.removedCommercialSentences,
          beforePreview: before.slice(0, 120),
          afterPreview: replyBody.slice(0, 120),
        });
      }
    }

    // Guard estrutural da primeira resposta para reduzir atrito em leads de campanha.
    if (isFirstAnaReply) {
      const shaped = sanitizeFirstCampaignReplyShape(replyBody);
      if (shaped.trimmedSentences > 0 || shaped.removedQuestions > 0) {
        console.log('[ANA_FIRST_REPLY_SHAPE_GUARD]', {
          conversationId,
          trimmedSentences: shaped.trimmedSentences,
          removedQuestions: shaped.removedQuestions,
          beforePreview: replyBody.slice(0, 120),
          afterPreview: shaped.text.slice(0, 120),
        });
        replyBody = shaped.text;
      }
    }

    // ─── ANA OPERATIONAL FACT RESOLVER (camada determinística) ──────────────
    // Para perguntas sobre entrega, obras, infraestrutura, liberação para
    // construir e portaria/lazer, o pipeline busca a resposta nos dados
    // oficiais (variablesMap + knowledgeText) ANTES de usar o reply do LLM.
    // O LLM não tem liberdade de improvisar nesses tópicos.
    let operationalResolverFired = false;
    {
      const resolution = resolveOperationalFactAnswer(trimmed, knowledgeText, vars);
      if (resolution !== null) {
        operationalResolverFired = true;
        console.log('[ANA_OPERATIONAL_RESOLVER]', {
          conversationId,
          topic: resolution.topic,
          dataFound: resolution.dataFound,
          fragment: resolution.fragment?.slice(0, 100) ?? null,
          answer_preview: resolution.answer.slice(0, 100),
          original_llm_preview: replyBody.slice(0, 100),
        });
        replyBody = resolution.answer;
      }
    }

    // ─── ANA OPERATIONAL FACT GUARD (segurança adicional) ────────────────────
    // Só roda se o resolver não interceptou. Bloqueia claims operacionais
    // inventados que tenham passado pelo resolver (ex.: tópico não detectado,
    // mas o LLM ainda assim alucinouaaa).
    if (!operationalResolverFired) {
      const officialData = [
        ...Object.values(vars),
        knowledgeText.slice(0, 12_000),
      ]
        .filter(Boolean)
        .join('\n');

      const guardResult = applyOperationalFactGuard(replyBody, trimmed, officialData);

      if (guardResult.replaced) {
        console.log('[ANA_OPERATIONAL_FACT_GUARD]', {
          conversationId,
          replaced: true,
          unsupported_claims: guardResult.unsupportedClaims,
          grounded_claims: guardResult.groundedClaims,
          original_preview: replyBody.slice(0, 120),
        });
        replyBody = guardResult.text;
      } else if (guardResult.groundedClaims.length > 0) {
        console.log('[ANA_OPERATIONAL_FACT_GUARD]', {
          conversationId,
          replaced: false,
          grounded_claims: guardResult.groundedClaims,
        });
      }
    }

    // Guard financeiro: impede simulação/negociação indevida pela Ana e
    // conduz para validação com corretor, sem trocar a resposta inteira.
    {
      const financialGuard = sanitizeFinancialNegotiationOverreach(replyBody);
      if (financialGuard.replacedFinancialSentences > 0) {
        console.log('[ANA_FINANCIAL_NEGOTIATION_GUARD]', {
          conversationId,
          replacedFinancialSentences: financialGuard.replacedFinancialSentences,
          beforePreview: replyBody.slice(0, 120),
          afterPreview: financialGuard.text.slice(0, 120),
        });
        replyBody = financialGuard.text;
      }
    }

    {
      const axisGuard = applyAnaCommercialSingleAxisGuard({
        reply: replyBody,
        userMessage: trimmed,
        isFirstAnaReply,
        enterpriseName: ent?.name ?? null,
        conversationId,
      });
      if (axisGuard.changed) {
        replyBody = axisGuard.text;
      }
    }

    if (isPipelineStale(conversationId, replyPipelineToken)) {
      console.log('[ANA_PIPELINE] engine_cancelled_stale', {
        conversationId,
        replyPipelineToken: replyPipelineToken ?? null,
        phase: 'before_send',
        inboundMetaMessageId,
      });
      return;
    }

    const enterpriseIdForFile = ent != null ? Number(ent.id) : null;
    const willSendMediaFirst =
      preResolvedFileForAna != null &&
      effectiveSendCategory != null &&
      ent != null &&
      enterpriseIdForFile != null &&
      Number.isFinite(enterpriseIdForFile);

    let docMediaFirstSkipReason: string | null = null;
    if (!willSendMediaFirst) {
      if (!preResolvedFileForAna) docMediaFirstSkipReason = 'no_pre_resolved_file';
      else if (!effectiveSendCategory) docMediaFirstSkipReason = 'no_effective_category';
      else if (!ent) docMediaFirstSkipReason = 'no_enterprise_row';
      else if (enterpriseIdForFile == null || !Number.isFinite(enterpriseIdForFile))
        docMediaFirstSkipReason = 'invalid_enterprise_id';
      else docMediaFirstSkipReason = 'unknown';
    }
    console.log('[ANA_DOC_MEDIA_FIRST_DECISION]', {
      conversationId,
      willSendMediaFirst,
      skipReason: docMediaFirstSkipReason,
      effectiveSendCategory: effectiveSendCategory ?? null,
      fileName: preResolvedFileForAna?.originalName ?? null,
    });

    const rowsBeforeSend = await getMessagesByConversationId(conversationId);
    const lastAsstDup = [...rowsBeforeSend].reverse().find((m) => m.role === 'assistant');

    let canClaimMaterialWasSent = false;
    let mediaOutcome: AnaMediaFirstResult | null = null;

    if (willSendMediaFirst && preResolvedFileForAna && effectiveSendCategory && ent && enterpriseIdForFile != null) {
      console.log('[ANA_DOC_PIPELINE_START]', {
        conversationId,
        replyPipelineToken: replyPipelineToken ?? null,
        phase: 'before_media_send',
        file: preResolvedFileForAna.originalName,
      });
      console.log('[ANA_PIPELINE] engine_media_first_start', {
        conversationId,
        enterpriseIdForFile,
        category: effectiveSendCategory,
        file: preResolvedFileForAna.originalName,
      });
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        console.log('[ANA_DOC_PIPELINE_STALE_ABORT]', {
          conversationId,
          phase: 'before_media_send',
          replyPipelineToken: replyPipelineToken ?? null,
        });
        return;
      }
      mediaOutcome = await sendAnaEnterpriseMediaFirst({
        conversationId,
        toPhoneNumber,
        ent,
        enterpriseIdForFile,
        cat: effectiveSendCategory as FileCategory,
        preResolvedFile: preResolvedFileForAna,
      });
      canClaimMaterialWasSent = mediaOutcome.ok === true;
      console.log('[ANA_PIPELINE] engine_doc_send_outcome', {
        conversationId,
        canClaimMaterialWasSent,
        fileName: mediaOutcome.ok ? preResolvedFileForAna.originalName : mediaOutcome.fileName,
        ok: mediaOutcome.ok,
      });
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        console.log('[ANA_DOC_PIPELINE_STALE_ABORT]', {
          conversationId,
          phase: 'immediately_after_sendAnaEnterpriseMediaFirst',
          replyPipelineToken: replyPipelineToken ?? null,
        });
        return;
      }
    }

    /** Envio OK + ACK: um único texto e encerra o turno — sem delay longo nem pós-processamento duplicado. */
    if (shouldAttemptDocSend && canClaimMaterialWasSent) {
      console.log('[ANA_DOC_PIPELINE_START]', {
        conversationId,
        replyPipelineToken: replyPipelineToken ?? null,
        phase: 'material_ack_only_turn_end',
      });
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        console.log('[ANA_DOC_PIPELINE_STALE_ABORT]', {
          conversationId,
          phase: 'before_ack_text',
          replyPipelineToken: replyPipelineToken ?? null,
        });
        return;
      }
      const ackText = pickPostMediaAckText(lastAsstDup?.content ?? null);
      const lastContentPreAck = (lastAsstDup?.content || '').trim();
      const ageDupPreAck = lastAsstDup ? Date.now() - new Date(lastAsstDup.created_at).getTime() : Infinity;
      if (lastContentPreAck && lastContentPreAck === ackText.trim() && ageDupPreAck < 55_000) {
        console.log('[ANA_DOC_DUPLICATE_SUPPRESSED]', {
          conversationId,
          reason: 'ack_would_duplicate_last_assistant',
        });
        return;
      }
      anaEngineTrace('final_send_start', { conversationId, phase: 'doc_ack', replyLen: ackText.length });
      const sendAckResult = await sendTextMessage(toPhoneNumber, ackText);
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        console.log('[ANA_DOC_PIPELINE_STALE_ABORT]', {
          conversationId,
          phase: 'after_ack_sendTextMessage',
          replyPipelineToken: replyPipelineToken ?? null,
        });
        return;
      }
      if (!sendAckResult.success || !sendAckResult.metaMessageId) {
        anaEngineTrace('final_send_error', {
          conversationId,
          phase: 'doc_ack',
          error: sendAckResult.error ?? null,
          code: sendAckResult.code ?? null,
        });
        console.log('[ANA_PIPELINE] engine_send_fail', {
          conversationId,
          phase: 'doc_ack_after_media',
          error: sendAckResult.error ?? null,
          code: sendAckResult.code ?? null,
        });
        return;
      }
      await insertMessage(conversationId, 'assistant', ackText, sendAckResult.metaMessageId);
      anaEngineTrace('final_send_success', {
        conversationId,
        phase: 'doc_ack',
        outboundMetaMessageId: sendAckResult.metaMessageId,
      });
      console.log('[ANA_DOC_ACK_SENT]', {
        conversationId,
        outboundMetaMessageId: sendAckResult.metaMessageId,
        replyLen: ackText.length,
      });
      const convAfterAck = await getConversationById(conversationId);
      const nameConfirmedForCount = (convAfterAck?.customer_name || '').trim();
      const deltaAck =
        nameConfirmedForCount.length >= 2
          ? countCustomerNameMentionsInText(ackText, nameConfirmedForCount)
          : 0;
      if (deltaAck > 0) await incrementAnaCustomerNameMentions(conversationId, deltaAck);
      if (!nameConfirmedForCount && replyExplicitlyAsksCustomerName(ackText)) {
        await markAnaAskedForCustomerName(conversationId);
      }
      const prevForFlowAck = parseCommercialFlowState(convAfterAck?.commercial_flow_state) ?? flowStateParsed;
      const nextFlowAck = computeNextCommercialFlowState(prevForFlowAck, ackText, {
        conversationPhase,
        enterpriseIdResolved: effectiveConv.enterprise_id ?? null,
        enterprises: allActiveEnterprises,
        productTypeHint:
          mode === 'scoped' && ent
            ? ent.tipo
            : triageRequestedProductType === 'INDEFINIDO'
              ? undefined
              : triageRequestedProductType,
      });
      await mergeConversationCommercialFlowState(conversationId, nextFlowAck);
      console.log('[ANA_DOC_POST_SEND_STATE_CLEARED]', {
        conversationId,
        note: 'flow_state_merged_after_doc_ack_then_return',
      });
      console.log('[ANA_DOC_SEND_SUCCESS_RETURNING]', { conversationId });
      console.log('[ANA_PIPELINE] engine_send_success', {
        conversationId,
        phase: 'ana_doc_ack_only',
        inboundMetaMessageId,
        outboundMetaMessageId: sendAckResult.metaMessageId,
        replyLen: ackText.length,
      });
      if (structured.classification === 'Carteira' && prevClassification !== 'Carteira') {
        const convRef = await getConversationById(conversationId);
        void extractLeadDataFromConversation(
          conversationId,
          convRef?.customer_name ?? trustedCustomerName ?? null,
          ent?.name ?? null
        ).catch((e) => console.error('[Carteira extract]', e));
      }
      return;
    }

    anaEngineTrace('final_reply_choice_before', {
      conversationId,
      replySource,
      fallbackReason: fallbackReason ?? null,
      replyBodyLen: replyBody.length,
      branch: shouldAttemptDocSend ? 'doc_or_material' : 'normal_finalize',
    });

    let replyText: string;
    if (shouldAttemptDocSend) {
      if (mediaOutcome != null && !mediaOutcome.ok) {
        replyText = pickMaterialSendFailedNeutralReply(lastAsstDup?.content ?? null);
        console.log('[ANA_DOC_HARD_FAIL_NO_FALLBACK]', {
          conversationId,
          branch: 'meta_send_failed',
        });
      } else {
        replyText = pickMaterialUnavailableNeutralReply(lastAsstDup?.content ?? null);
        const branch =
          !ent || !hasSendableFiles
            ? 'no_enterprise_or_no_sendable_files'
            : 'file_not_found_after_category_try';
        console.log('[ANA_DOC_HARD_FAIL_NO_FALLBACK]', {
          conversationId,
          branch,
        });
      }
    } else {
      replyText = finalizeAnaReplyText(replyBody, {
        userMessage: trimmed,
        conversationMode: mode,
      }).slice(0, 4000);
    }

    anaEngineTrace('final_reply_choice_after', {
      conversationId,
      replySource,
      replyTextLen: replyText.length,
      usedTechnicalFallbackNeutral: replyText.trim() === ANA_TECHNICAL_FALLBACK_NEUTRAL.trim(),
    });

    anaEngineTrace('final_reply_ready', {
      conversationId,
      replyTextLen: replyText.length,
      hasStructuredReply: !!(structured?.reply?.trim()),
      replySource,
      fallbackReason: fallbackReason ?? null,
    });

    const lastContent = (lastAsstDup?.content || '').trim();
    const ageDup = lastAsstDup ? Date.now() - new Date(lastAsstDup.created_at).getTime() : Infinity;
    if (lastContent && lastContent === replyText.trim() && ageDup < 55_000) {
      console.warn('[ANA_PIPELINE] duplicate_reply_unchanged', { conversationId, ageMs: ageDup });
    }
    console.log('[ANA_PIPELINE] engine_reply_generated', {
      conversationId,
      inboundMetaMessageId,
      replyPipelineToken: replyPipelineToken ?? null,
      replyLen: replyText.length,
      replySource,
      fallbackReason,
      canClaimMaterialWasSent,
    });
    console.log('[ANA_PIPELINE] engine_send_attempt', {
      conversationId,
      toPhoneTail: anaPhoneTail(toPhoneNumber),
      inboundMetaMessageId,
      replyPipelineToken: replyPipelineToken ?? null,
      phase: willSendMediaFirst ? 'ana_media_then_text' : 'ana_main_reply',
      replyLen: replyText.length,
      willSendMediaFirst,
      canClaimMaterialWasSent,
    });
    await sleepMs(randomAnaReplyDelayMs({ replyLength: replyText.length }));
    if (isPipelineStale(conversationId, replyPipelineToken)) {
      console.log('[ANA_PIPELINE] engine_cancelled_stale', {
        conversationId,
        replyPipelineToken: replyPipelineToken ?? null,
        phase: 'after_reply_delay',
        inboundMetaMessageId,
      });
      return;
    }

    anaEngineTrace('final_send_start', {
      conversationId,
      phase: 'ana_main_reply',
      replyLen: replyText.length,
    });
    const sendResult = await sendTextMessage(toPhoneNumber, replyText);
    if (sendResult.success && sendResult.metaMessageId) {
      await insertMessage(conversationId, 'assistant', replyText, sendResult.metaMessageId);
      anaEngineTrace('final_send_success', {
        conversationId,
        phase: 'ana_main_reply',
        outboundMetaMessageId: sendResult.metaMessageId,
      });
      console.log('[ANA_PIPELINE] engine_send_success', {
        conversationId,
        phase: 'ana_main_reply',
        inboundMetaMessageId,
        outboundMetaMessageId: sendResult.metaMessageId,
        replyLen: replyText.length,
      });
      console.log('[ANA DEBUG] WhatsApp reply sent', { metaMessageId: sendResult.metaMessageId });
      console.log('[ANA DEBUG] assistant message saved');
      const convAfterSend = await getConversationById(conversationId);
      const nameConfirmedForCount = (convAfterSend?.customer_name || '').trim();
      const delta =
        nameConfirmedForCount.length >= 2
          ? countCustomerNameMentionsInText(replyText, nameConfirmedForCount)
          : 0;
      if (delta > 0) await incrementAnaCustomerNameMentions(conversationId, delta);
      if (!nameConfirmedForCount && replyExplicitlyAsksCustomerName(replyText)) {
        await markAnaAskedForCustomerName(conversationId);
      }
      const prevForFlow = parseCommercialFlowState(convAfterSend?.commercial_flow_state) ?? flowStateParsed;
      const nextFlow = computeNextCommercialFlowState(prevForFlow, replyText, {
        conversationPhase,
        enterpriseIdResolved: effectiveConv.enterprise_id ?? null,
        enterprises: allActiveEnterprises,
        productTypeHint:
          mode === 'scoped' && ent
            ? ent.tipo
            : triageRequestedProductType === 'INDEFINIDO'
              ? undefined
              : triageRequestedProductType,
      });
      await mergeConversationCommercialFlowState(conversationId, nextFlow);
      const stateAfter = {
        enterpriseId: effectiveConv.enterprise_id,
        flowState: nextFlow,
      };
      console.log('[ANA_CHAT_AUDIT]', {
        conversationId,
        messageId: inboundMetaMessageId,
        userText: trimmed.slice(0, 500),
        historyCount,
        stateBefore,
        phase: 'post_send',
        openAiCalled,
        openAiModel: model,
        openAiReplyPreview: replyText.slice(0, 260),
        fallbackUsed: replySource === 'technical_fallback',
        fallbackReason,
        ...(openAiApiError && { openAiApiError, openAiHttpStatus }),
        replySource,
        stateAfter,
      });
      console.log('[ANA_MSG]', {
        conversationId,
        metaMessageId: inboundMetaMessageId,
        phase: 'sent',
        replySource,
        finalEnterpriseId: effectiveConv.enterprise_id,
        conversationPhase,
        replyLen: replyText.length,
      });
    } else {
      anaEngineTrace('final_send_error', {
        conversationId,
        phase: 'ana_main_reply',
        error: sendResult.error ?? null,
        code: sendResult.code ?? null,
      });
      console.log('[ANA_PIPELINE] engine_send_fail', {
        conversationId,
        phase: 'ana_main_reply',
        inboundMetaMessageId,
        error: sendResult.error ?? null,
        code: sendResult.code ?? null,
        toPhoneTail: anaPhoneTail(toPhoneNumber),
      });
      console.error('[ANA DEBUG] Falha ao enviar WhatsApp:', sendResult.error, { toPhoneNumber });
    }

    if (structured.classification === 'Carteira' && prevClassification !== 'Carteira') {
      const convRef = await getConversationById(conversationId);
      void extractLeadDataFromConversation(
        conversationId,
        convRef?.customer_name ?? trustedCustomerName ?? null,
        ent?.name ?? null
      ).catch((e) => console.error('[Carteira extract]', e));
    }

  } finally {
    release();
  }
}
