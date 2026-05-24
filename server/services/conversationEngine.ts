import { statSync } from 'fs';
import {
  getMessagesByConversationId,
  getLastUserMessageNeedingReply,
  insertMessage,
  type MessageAttachmentPayload,
} from '../repositories/messageRepository.js';
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
import {
  sendAnaLocalMediaToWhatsAppWithQuota as sendLocalMediaToWhatsApp,
  sendAnaTextMessageWithQuota as sendTextMessage,
} from './anaOutboundQuotaService.js';
import { sendTextMessage as sendMetaTextMessage } from './whatsappMetaService.js';
import {
  pickMaterialUnavailableNeutralReply,
  pickMaterialSendFailedNeutralReply,
  stripMaterialDeliveryClaims,
  textHasMaterialDeliveryClaim,
} from '../utils/anaMaterialReply.js';
import {
  tryMatchEnterpriseFromUserCorpus,
  explainEnterpriseMentionMatch,
  enterpriseHasStrongNameSignalInTrimmed,
  debugEnterpriseMentionScores,
  resolveEnterpriseForAnaTurn,
  type AnaEnterpriseResolution,
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
  resolveSendableEnterpriseFileCurrentVersion,
  type MaterialFileResolveFailureReason,
  type FileCategory,
  type EnterpriseRow,
} from '../repositories/enterpriseRepository.js';
import { loadRankedKnowledgeChunksForPromptWithMeta } from '../repositories/enterpriseKnowledgeChunkRepository.js';
import { isPipelineStale } from './conversationPipelineToken.js';
import {
  generateChatCompletion,
  type ChatMessage,
  type GenerateCompletionResult,
} from './openaiService.js';
import {
  resolveAiSettingsForEnterprise,
  type ResolvedEnterpriseAiSettings,
} from './enterpriseAiSettingsService.js';
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
  extractRecoveredReplyFromMalformedJsonLikeRaw,
  validateRecoveredReplyQuality,
  buildRecoveredReplyStructured,
  detectStrongPurchaseIntentForLeadTemperature,
  hasCatalogReopenIntent,
} from './anaAgentService.js';
import {
  finalizeAnaReplyText,
  containsInternalLimitationLanguage,
  applyAnaHardLengthGuard,
  evaluateAnaOutboundText,
  repliesSemanticallySimilar,
  countCustomerNameMentionsInText,
  sleepMs,
  randomAnaReplyDelayMs,
  buildGreetingSafeFallback,
  sanitizeFirstReplyCommercialLeak,
  sanitizeFirstCampaignReplyShape,
  sanitizeFinancialNegotiationOverreach,
  evaluateAnaEmptyFallbackGuard,
  applyFirstUsefulGreetingStyle,
  sanitizeTooManyQuestionsReply,
} from '../utils/anaReplyFinalize.js';
import {
  applyAnaCommercialSingleAxisGuard,
  detectCommercialAxes,
  inferResolvedPurchaseIntent,
  inferUserRequestedAxis,
  type CommercialAxis,
} from '../utils/anaCommercialAxisGuard.js';
import {
  extractCustomerNameFromUserUtterance,
  replyExplicitlyAsksCustomerName,
} from '../utils/extractCustomerNameFromMessage.js';
import {
  buildAnaEnterpriseEvidence,
  hasAnaEvidenceForNeed,
  applyAnaEvidenceGuardToReply,
} from '../utils/anaEnterpriseEvidence.js';
import {
  buildAnaDecisionPolicy,
  detectExplicitExactLocationRequest,
  detectExplicitPaymentSimulationRequest,
  detectStructuredListIntent,
} from '../utils/anaDecisionPolicy.js';
import { resolveAnaOpenAIModel } from '../utils/resolveAnaOpenAIModel.js';
import {
  buildUserUtterancesContext,
  computeAppointmentPreflight,
  ANA_FALLBACK_APPOINTMENT_CONTINUATION_REPLY,
  ANA_FALLBACK_APPOINTMENT_FLOW_REPLY,
} from '../utils/anaAppointmentIntent.js';
import { extractLeadDataFromConversation } from './leadWalletExtractionService.js';
import { registerAnaAppointmentIfConfirmed } from './anaAppointmentFromChatService.js';
import {
  findOpenAppointmentForConversationAndEnterprise,
  type AppointmentRow,
} from '../repositories/appointmentRepository.js';
import { findContactById, mergeContactNameIfMissing } from '../repositories/contactsRepository.js';
import {
  parseCommercialFlowState,
  computeNextCommercialFlowState,
  resetCommercialScopeHints,
  isEmptyCommercialFlowState,
  type CommercialFlowState,
  type MaterialSendStatus,
} from '../utils/commercialFlowState.js';
import {
  isBareGreetingOnly,
  userExplicitlyAskedForMaterial,
  isFollowupMaterialCommand,
  userAskedAboutMaterialTopic,
  inferPreferredCategoryFromUserText,
  buildDocCategoryTryOrder,
  pickPostMediaAckText,
} from '../utils/anaDocSendIntent.js';
import {
  handleVisitSchedulingDeterministically,
  hasProhibitedVisitSchedulingPhrase,
  isVisitSchedulingIntent,
  isVisitSchedulingLoopFallbackReply,
  isVisitSchedulingRefusalMessage,
} from '../utils/anaDirectVisitScheduling.js';
import { applyOperationalFactGuard } from '../utils/anaOperationalFactGuard.js';
import {
  resolveOperationalFactAnswer,
  type OperationalTopic,
} from '../utils/anaOperationalFactResolver.js';
import {
  applyAnaNoRepeatMessageGuard,
  applyAnaVisitOfferGuard,
  applyEvoraLocationGuard,
  blockLegacyAggressiveVisitCtaByIntent,
  containsLegacyAggressiveVisitCta,
  hasRecentExplicitVisitCta,
} from '../utils/anaEvoraCommercialGuards.js';
import { applyAnaVisitSchedulingGuard } from '../utils/anaVisitSchedulingGuard.js';
import {
  createAnaTurnAudit,
  getLastAnaTurnAuditByConversation,
  updateAnaTurnAuditOutcome,
  type AnaTurnAuditOutboundStatus,
} from '../repositories/anaTurnAuditRepository.js';
import {
  classifyLlmProviderError,
  detectLlmProvider,
  type LlmClassifiedError,
  type LlmProvider,
} from '../utils/llmProviderDiagnostics.js';
import {
  extractRetryAfterMs,
  isRetryableLlmError,
  mapRetryReason,
  sanitizeRetryErrorMessage,
} from '../utils/llmRetry.js';
import { scheduleAnaRetry } from './anaRetrySchedulerService.js';
import {
  createAnaTurnDiagnostics,
  markAnaTurnStage,
  type AnaTurnDiagnostics,
} from '../utils/anaTurnDiagnostics.js';
import {
  ANA_EMERGENCY_HANDOFF_MESSAGE,
  isAnaEmergencyHandoffEnabled,
  sendAnaEmergencyHandoff,
  type AnaEmergencyHandoffSendResult,
} from '../utils/anaEmergencyHandoff.js';
import {
  buildAnaDeterministicOperationalMessages,
  detectAnaDeterministicOperationalSubtype,
  isEvoraEnterpriseName,
  isGenericInterestFollowup,
  isUserIrritated,
  isVisitSchedulingRefusal,
  resolveAnaCommercialRule,
} from './anaCommercialRulesService.js';
import { ANA_COMMERCIAL_RULES } from '../config/anaCommercialRules.js';

/** Desligado para rastrear o fluxo real com [ANA_ENGINE_TRACE]. */
const ANA_ENGINE_DIAGNOSTIC_FIXED_REPLY = false;
const ANA_ENGINE_DIAGNOSTIC_TEXT = 'Diagnóstico: cheguei no conversation engine.';
const ANA_PROVIDER_FAILURE_HANDOFF_REPLY =
  'Vou encaminhar seu atendimento para um consultor te ajudar com essa informação certinho.';
const ANA_FIRST_GREETING_SAFE_FALLBACK_BODY =
  'O Évora é um loteamento fechado em Atibaia, com lotes a partir de 360 m², infraestrutura planejada, lazer completo e segurança 24 horas.\nFica em Atibaia, com fácil acesso pela Rodovia Dom Pedro I, perto da área da Pedreira, a aproximadamente 50 minutos de São Paulo.\nMe conta, quais são suas dúvidas? Vou responder todas.';
const MAX_ANA_GENERATION_ATTEMPTS = 5;

type AnaEmergencyHandoffTransport = {
  sendTextMessage: (to: string, text: string) => Promise<AnaEmergencyHandoffSendResult>;
  insertAssistantMessage: (conversationId: number, text: string, metaMessageId: string) => Promise<unknown>;
};

const defaultAnaEmergencyHandoffTransport: AnaEmergencyHandoffTransport = {
  sendTextMessage: sendMetaTextMessage,
  insertAssistantMessage: (conversationId, text, metaMessageId) =>
    insertMessage(conversationId, 'assistant', text, metaMessageId),
};

let anaEmergencyHandoffTransport: AnaEmergencyHandoffTransport = defaultAnaEmergencyHandoffTransport;

export function __setAnaEmergencyHandoffTransportForTest(
  overrides: Partial<AnaEmergencyHandoffTransport>
): () => void {
  const previous = anaEmergencyHandoffTransport;
  anaEmergencyHandoffTransport = { ...previous, ...overrides };
  return () => {
    anaEmergencyHandoffTransport = previous;
  };
}

type AnaGenerationStrategy =
  | 'primary_json'
  | 'same_context_retry'
  | 'json_repair'
  | 'secondary_provider'
  | 'rag_empty_fallback_retry';

/** TEMP: logs [ANA_ENGINE_TRACE] (OpenAI/parse/envio). Desligar com false. */
const ANA_ENGINE_TRACE = true;
const logger = {
  info: (message: string, payload?: Record<string, unknown>) => console.log(message, payload ?? {}),
};

function anaEngineTrace(tag: string, payload: Record<string, unknown>): void {
  if (!ANA_ENGINE_TRACE) return;
  console.log(`[ANA_ENGINE_TRACE] ${tag}`, payload);
}

function isGenericFirstGreetingMessage(userMessage: string): boolean {
  const n = normText(userMessage || '')
    .replace(/[!?,.;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) return false;
  return /^(oi|ola|oi tudo bem|ola tudo bem|bom dia|boa tarde|boa noite)$/.test(n);
}

function isFirstContactGeneralInterestMessage(userMessage: string): boolean {
  const n = normText(userMessage || '')
    .replace(/[!?,.;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) return false;
  if (/(tenho interesse|quero saber mais|gostaria de saber mais|vi o anuncio|vi o anúncio|me passa mais detalhes|gostaria de informacoes|gostaria de informações)/.test(n)) {
    return true;
  }
  if (/(informacoes|informações|detalhes)/.test(n) && /(evora|empreendimento|loteamento)/.test(n)) {
    return true;
  }
  return false;
}

function userExplicitlyAskedHowAreYou(userMessage: string): boolean {
  const n = normText(userMessage || '')
    .replace(/[!?,.;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return /\b(tudo bem|td bem|como vai|como voce esta|como você esta|como voce esta)\b/.test(n);
}

function buildFirstGreetingSafeFallback(userMessage: string): string {
  if (userExplicitlyAskedHowAreYou(userMessage)) {
    return `Oi! Tudo bem sim 😊 ${ANA_FIRST_GREETING_SAFE_FALLBACK_BODY}`;
  }
  return `Olá! Claro.\n${ANA_FIRST_GREETING_SAFE_FALLBACK_BODY}`;
}

function logAnaOutboundBlocked(params: {
  reason: string;
  userMessage: string;
  conversationId: number;
  replyCandidate: string;
}): void {
  console.log('[ANA_OUTBOUND_BLOCKED]');
  console.log(`[ANA_OUTBOUND_BLOCKED] reason=${params.reason}`);
  console.log(`[ANA_OUTBOUND_BLOCKED] user_message=${params.userMessage.slice(0, 500)}`);
  console.log(`[ANA_OUTBOUND_BLOCKED] conversation_id=${params.conversationId}`);
  console.log(`[ANA_OUTBOUND_BLOCKED] reply_candidate=${params.replyCandidate.slice(0, 500)}`);
}

function isProviderFailureClassifiedError(
  classifiedError: LlmClassifiedError | null | undefined
): boolean {
  return (
    classifiedError === 'OPENAI_INSUFFICIENT_QUOTA_OR_BILLING' ||
    classifiedError === 'OPENAI_RATE_LIMIT' ||
    classifiedError === 'OPENAI_AUTH_ERROR' ||
    classifiedError === 'OPENAI_MODEL_NOT_FOUND' ||
    classifiedError === 'OPENAI_CONTEXT_LENGTH' ||
    classifiedError === 'OPENAI_BAD_REQUEST' ||
    classifiedError === 'OPENAI_TIMEOUT_OR_NETWORK' ||
    classifiedError === 'UNKNOWN_LLM_ERROR'
  );
}

function buildSafeOutboundRecoveryReply(params: {
  userMessage: string;
  knownCustomerName: string | null | undefined;
  appointmentActive: boolean;
  requestedAxis?: 'preco' | 'metragem_tipologia' | 'localizacao' | 'lazer' | 'financiamento' | 'disponibilidade' | 'visita_agendamento' | 'intencao_compra' | null;
}): string {
  void params;
  return '';
}

function buildSpecificMissingAxisReply(
  requestedAxis: ReturnType<typeof inferUserRequestedAxis> | null
): string | null {
  void requestedAxis;
  return null;
}

function buildRepeatedMissingAxisReply(axis: CommercialAxis | null): string | null {
  void axis;
  return null;
}

function hasBlockedGenericFallbackPhrase(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return (
    /\bqual ponto pesa mais\b/.test(n) ||
    /\bme diz so qual ponto pesa mais\b/.test(n) ||
    /\bme conta qual informacao voce quer priorizar\b/.test(n)
  );
}

function buildDirectAxisFallbackReply(axis: CommercialAxis): string {
  void axis;
  return '';
}

function axisHumanLabel(axis: CommercialAxis): string {
  if (axis === 'metragem_tipologia') return 'metragem';
  if (axis === 'financiamento') return 'formas de pagamento';
  if (axis === 'preco') return 'preco';
  if (axis === 'localizacao') return 'localizacao';
  if (axis === 'lazer') return 'lazer';
  if (axis === 'disponibilidade') return 'disponibilidade';
  if (axis === 'visita_agendamento') return 'visita';
  if (axis === 'intencao_compra') return 'intencao de compra';
  return 'esse ponto';
}

function normalizeStructuredReplyCandidate(
  reply: string,
  opts?: { preserveAllItems?: boolean }
): string {
  const raw = (reply || '').trim();
  if (!raw) return raw;
  const preserveAllItems = opts?.preserveAllItems === true;
  const sanitizeListPart = (part: string): string =>
    part
      .replace(/\s*,?\s*entre outros\.?\s*$/i, '')
      .replace(/\s+entre outros\.?\s*$/i, '')
      .trim();
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length >= 2) {
    const normalized = (preserveAllItems ? lines : lines.slice(0, 7))
      .map((line) => (preserveAllItems ? sanitizeListPart(line) : line))
      .filter(Boolean);
    return normalized.join('\n');
  }
  const parts = raw
    .split(/\s*;\s*/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length >= 3) {
    const selected = preserveAllItems ? parts : parts.slice(0, 7);
    return selected
      .map((part) => `- ${sanitizeListPart(part.replace(/[.!?]+$/g, '').trim())}`)
      .filter((part) => part !== '-')
      .join('\n');
  }
  return preserveAllItems ? sanitizeListPart(raw) : raw;
}

const COMMERCIAL_AXIS_SET: ReadonlySet<CommercialAxis> = new Set<CommercialAxis>([
  'preco',
  'metragem_tipologia',
  'localizacao',
  'lazer',
  'financiamento',
  'disponibilidade',
  'visita_agendamento',
  'intencao_compra',
]);

interface AnaAxisRepetitionAuditSnapshot {
  detectedIntent: string | null;
  lastAxis: CommercialAxis | null;
  currentAxis: CommercialAxis | null;
  alreadyAnswered: boolean;
  evidenceFound: boolean;
  responseMode: 'short' | 'structured' | null;
  reasonForNotRepeatingAnswer: string | null;
}

function isCommercialAxis(value: unknown): value is CommercialAxis {
  return typeof value === 'string' && COMMERCIAL_AXIS_SET.has(value as CommercialAxis);
}

function hasLazerSignal(text: string | null | undefined): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return (
    /\blazer\b/.test(n) ||
    /\bamenidades?\b/.test(n) ||
    /\b(area|areas)\s+(de\s+)?lazer\b/.test(n) ||
    /\bareas?\s+comuns?\b/.test(n)
  );
}

function inferAxisFromAssistantText(text: string | null | undefined): CommercialAxis | null {
  const raw = (text || '').trim();
  if (!raw) return null;
  const detected = detectCommercialAxes(raw);
  if (detected.length > 0) return detected[0] ?? null;
  if (hasLazerSignal(raw) && /\n\s*(?:[-*•]|\d+[.)])\s+/u.test(raw)) {
    return 'lazer';
  }
  return null;
}

function asksForMoreItems(message: string): boolean {
  const n = normText(message);
  if (!n) return false;
  if (/^(mais|tem mais|tem outras|outras)\??$/.test(n)) return true;
  return (
    /\b(tem mais|mais areas?|mais itens?|tem outras?|outras areas?|outros itens?)\b/.test(n) ||
    /\b(alem dessas|alem disso|algo a mais)\b/.test(n)
  );
}

function normalizeListItemForCompare(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(de|da|do|das|dos|e|com)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeListItems(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const clean = item.replace(/[.]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const key = normalizeListItemForCompare(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function extractReplyListItems(text: string | null | undefined): string[] {
  const raw = (text || '').trim();
  if (!raw) return [];
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets = lines
    .map((line) => line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/u))
    .filter((m): m is RegExpMatchArray => m != null)
    .map((m) => m[1]!.trim());
  if (bullets.length > 0) return dedupeListItems(bullets);

  const inlineLine = lines.find((line) => /\b(incluem|inclui|conta com)\b/i.test(line) && /[,;|]/.test(line));
  if (!inlineLine) return [];
  const normalized = inlineLine.replace(/^.*?:\s*/u, '');
  const parts = normalized
    .split(/[;,|]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return dedupeListItems(parts);
}

function stripGenericOperationalOpening(text: string): string {
  const raw = (text || '').trim();
  if (!raw) return raw;
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) return raw;
  const first = lines[0] ?? '';
  const firstNorm = normText(first);
  const genericOpeners = [
    /^(claro|perfeito|otima pergunta|boa pergunta|excelente pergunta|com certeza|sem duvida|entendi|legal|que bom|faz sentido)\b/,
    /^(certo|show|beleza)\b/,
  ];
  const hasListOrFactAfter =
    lines.slice(1).some((line) => /^(?:[-*•]|\d+[.)])\s+/u.test(line)) ||
    /\b(r\$\s*[\d.,]+|\d+\s*m[²2]|fica em|localizacao|areas? de lazer|metragem)\b/i.test(lines.slice(1).join(' '));
  if (!hasListOrFactAfter) return raw;
  if (!genericOpeners.some((re) => re.test(firstNorm))) return raw;
  return lines.slice(1).join('\n').trim();
}

function stripGenericAxisFollowupQuestion(text: string): string {
  const raw = (text || '').trim();
  if (!raw) return raw;
  const genericQuestionRe = [
    /\bqual ponto\b.*\b(agora|primeiro)\b.*\?/i,
    /\bo que voce quer\b.*\b(detalhar|aprofundar)\b.*\?/i,
    /\bme diz\b.*\b(pesa mais|priorizar)\b.*\?/i,
    /\bposso te ajudar com outras informacoes\b.*\?/i,
    /\bqual informacao voce quer priorizar\b.*\?/i,
  ];
  const normalizedRaw = normText(raw);
  if (!genericQuestionRe.some((re) => re.test(normalizedRaw))) return raw;

  const sentences = raw
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const kept = sentences.filter((s) => !genericQuestionRe.some((re) => re.test(normText(s))));
  if (kept.length > 0) return kept.join(' ').trim();

  const stripped = raw
    .replace(/(?:\s*[,.!?-]\s*)?\bqual ponto\b[\s\S]*$/i, '')
    .replace(/(?:\s*[,.!?-]\s*)?\bme diz\b[\s\S]*$/i, '')
    .replace(/(?:\s*[,.!?-]\s*)?\bqual informacao voce quer priorizar\b[\s\S]*$/i, '')
    .trim();
  return stripped || raw;
}

function buildNoAdditionalLazerReply(): string {
  return '';
}

function buildOnlyNewLazerItemsReply(newItems: string[]): string {
  void newItems;
  return '';
}

function userAskedDirectOperationalAxis(
  userMessage: string,
  currentAxis: CommercialAxis | null
): boolean {
  if (currentAxis == null) return false;
  const askedAxis = inferUserRequestedAxis(userMessage);
  return askedAxis === currentAxis;
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

function recordAnaGenerationAttempt(params: {
  diagnostics: AnaTurnDiagnostics;
  attempt: number;
  strategy: AnaGenerationStrategy;
  result: GenerateCompletionResult;
  parsed: boolean;
  failureReason: AnaFallbackTraceReason | null;
  model: string;
}): void {
  const { diagnostics, attempt, strategy, result, parsed, failureReason, model } = params;
  diagnostics.llm.attempts.push({
    attempt,
    strategy,
    provider: result.provider ?? diagnostics.llm.provider,
    model: result.model ?? model,
    success: result.success,
    parsed,
    httpStatus: result.httpStatus ?? null,
    errorCode: result.errorCode ?? null,
    errorType: result.errorType ?? null,
    sanitizedMessage: result.success ? null : result.error ?? null,
    failureReason,
    rawLength: (result.content || '').length,
  });
  diagnostics.updatedAt = new Date().toISOString();
}

function latestAnaGenerationFailureResult(
  attempts: GenerateCompletionResult[]
): GenerateCompletionResult | null {
  return [...attempts].reverse().find((candidate) => candidate.success === false) ?? null;
}

function getConfiguredAnaSecondaryProvider(
  _primaryModel: string,
  _primaryApiKey: string,
  _primaryBaseUrl: string | null
): {
  apiKey: string;
  baseUrl: string | null;
  model: string;
  provider: LlmProvider;
} | null {
  // Regra do projeto: não usar fallback operacional de modelo/provedor para a Ana.
  return null;
}

function containsProhibitedTechnicalFallbackText(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return [
    'posso te explicar os principais pontos por aqui de forma objetiva',
    'posso te ajudar com informacoes comerciais',
    'tem algum ponto especifico que voce gostaria de saber primeiro',
    'voce quer saber valor localizacao ou planta',
    'sobre esse ponto eu te passo apenas o que esta validado',
    'sobre metragem eu te passo apenas o que esta validado',
    'sobre formas de pagamento eu te passo apenas o que esta validado',
  ].some((phrase) => n.includes(phrase));
}

function isMultiTopicCommercialMessage(userMessage: string): boolean {
  const raw = (userMessage || '').trim();
  if (!raw) return false;
  const hasTopicFormatting = /\n/.test(raw) || /(?:^|\n)\s*[-*•]\s+/u.test(raw);
  const n = normText(raw);
  const topics = [
    /\blocalizacao\b/,
    /\bonde fica\b/,
    /\bpaviment/,
    /\basfalto\b/,
    /\binfra\b/,
    /\bestrutura\b/,
    /\blazer\b/,
    /\bseguranca\b/,
    /\bvalor(?:es)?\b/,
    /\bpreco\b/,
    /\bdisponibilidade\b/,
    /\bvisita\b/,
  ];
  const matched = topics.filter((re) => re.test(n)).length;
  return hasTopicFormatting && matched >= 2;
}

function buildSafeCommercialPartialReply(params: {
  userMessage: string;
  enterpriseName: string | null;
  enterpriseCity: string | null;
}): string {
  const n = normText(params.userMessage || '');
  const name = (params.enterpriseName || 'o empreendimento').trim();
  const city = (params.enterpriseCity || '').trim();
  const blocks: string[] = [];

  if (/\blocalizacao\b|\bonde fica\b/.test(n)) {
    if (city) blocks.push(`${name} fica em ${city}.`);
    else blocks.push(`Sobre localizacao, te explico os acessos e a regiao principal de ${name} no atendimento.`);
  }

  if (/\bpaviment|\basfalto|infra|estrutura|lazer|seguranca\b/.test(n)) {
    blocks.push('Sobre a estrutura, e um empreendimento com infraestrutura planejada, lazer e seguranca.');
  }

  if (/\bvalor(?:es)?|preco|disponibilidade|simul|desconto|condic|entrada|parcela\b/.test(n)) {
    blocks.push(
      'Esses detalhes variam conforme as opcoes disponiveis. O corretor te passa tudo certinho no atendimento. Que tal marcarmos uma visita?'
    );
    console.log('ANA_UNSUPPORTED_DETAIL_ROUTED_TO_BROKER', {
      detailType: 'pricing_or_availability_or_custom_condition',
    });
  }

  if (blocks.length === 0) {
    blocks.push(
      'Consigo te adiantar os pontos gerais do empreendimento e, para os detalhes especificos, o corretor te passa tudo certinho no atendimento. Que tal marcarmos uma visita?'
    );
  }

  return blocks.join('\n\n');
}

function diagnosticsHasTechnicalGenerationFailure(diagnostics: AnaTurnDiagnostics): boolean {
  const technicalReasons = new Set([
    'openai_http_429',
    'openai_failed',
    'empty_raw_content',
    'parse_rejected',
    'structured_missing_reply',
    'unexpected_error',
  ]);
  return diagnostics.llm.attempts.some((attempt) =>
    attempt.failureReason != null && technicalReasons.has(attempt.failureReason)
  );
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
  if (isAnaEmergencyHandoffEnabled()) {
    console.log('[ANA_EMERGENCY_HANDOFF] reprocess_skipped', { conversationId });
    return;
  }
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
const ANA_OUTBOUND_MAX_CHARS = 260;

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

function isGratitudeOnlyMessage(text: string): boolean {
  const n = normText(text || '');
  return /^(obrigad[oa]|muito obrigad[oa]|ok obrigad[oa]|valeu|vlw|agradeco|agradeço)[.! ]*$/.test(n);
}

function toFirstName(value: string | null | undefined): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  const first = raw.split(/\s+/)[0]?.trim() || '';
  return first.length >= 2 ? first : null;
}

function isWeakEntregaAnswer(text: string): boolean {
  const n = normText(text || '');
  if (!n) return true;
  if (/^previs[aã]o de entrega\s*:?\s*$/.test(n)) return true;
  if (/^a previs[aã]o de entrega\s*:?\s*$/.test(n)) return true;
  return false;
}

const ANA_INTERNAL_LEAK_PATTERNS: RegExp[] = [
  /finalizar com pergunta aberta e natural/i,
  /sem resposta fixa deterministica/i,
  /pergunta aberta e natural/i,
  /\bfinalizar com\b/i,
  /\bnao mencionar\b/i,
  /\binstrucao\b/i,
  /\bregra\b/i,
];

function hasAnaInternalInstructionLeak(text: string): boolean {
  const normalized = normText(text || '');
  if (!normalized) return false;
  return ANA_INTERNAL_LEAK_PATTERNS.some((re) => re.test(normalized));
}

function sanitizeAnaInternalInstructionLeak(text: string): { text: string; changed: boolean } {
  const raw = (text || '').trim();
  if (!raw) return { text: raw, changed: false };
  const parts = raw.split(/(?<=[.!?…])\s+|\r?\n+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { text: raw, changed: false };
  let changed = false;
  const kept = parts.filter((part) => {
    const leaked = hasAnaInternalInstructionLeak(part);
    if (leaked) changed = true;
    return !leaked;
  });
  if (!changed) return { text: raw, changed: false };
  const cleaned = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  return { text: cleaned, changed: true };
}

function isEvoraLocationQuestion(userMessage: string): boolean {
  const n = normText(userMessage || '');
  if (!n) return false;

  const hasLocationIntent =
    /\b(onde fica|fica onde|localizacao|localizacao do|qual o endereco|endereco|bairro|cidade|regiao|rodovia|dom pedro|pedreira)\b/.test(n) ||
    /\b(como chegar|como chego|rota|caminho)\b/.test(n) ||
    /\b(perto de|proximo a|proxima a|distancia|fica perto|fica em|esta localizado|esta localizada|localizado em|localizada em)\b/.test(n);

  const hasNonLocationIntent =
    /\b(lazer|playground|quadra|churrasco|salao|piscina|seguranca|portaria|valor|preco|entrada|parcela|desconto|tabela|financ|lote|terreno|metragem|tamanho|foto|book|material|documentacao|reserva|simulacao)\b/.test(n);

  if (hasNonLocationIntent && !hasLocationIntent) return false;

  return hasLocationIntent;
}

const EVORA_LOCATION_REPLY_CHUNKS = [
  'O Évora fica em Atibaia, próximo à região da Pedreira.',
  'Tem fácil acesso pela Rodovia Dom Pedro I, em uma localização que combina tranquilidade, natureza e boa conexão com a cidade.',
  'Quer que eu te envie mais detalhes sobre o acesso ou prefere agendar uma visita para conhecer?',
];

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

function buildNoEnterpriseResolvedReply(userMessage: string): string {
  void userMessage;
  return '';
}

function buildAmbiguousEnterpriseReply(candidates: AnaEnterpriseResolution['candidates']): string {
  void candidates;
  return '';
}

function looksLikeStandaloneNameReply(message: string): boolean {
  const t = (message || '').trim();
  if (!t || t.length > 40 || t.includes('?') || t.includes('@')) return false;
  return /^[\p{L}]+(?:\s+[\p{L}]+){0,2}$/u.test(t);
}

function isAppointmentContextualQuestion(message: string): boolean {
  const n = normText(message);
  if (!n) return false;
  return (
    /\b(quem eu procuro|quem procuro|com quem falo|quem me atende)\b/.test(n) ||
    /\b(onde eu chego|onde chego|qual o endereco|qual endereco|qual o endereço|endereco|endereço)\b/.test(n) ||
    /\b(estacionamento|tem vaga|tem estacionamento)\b/.test(n)
  );
}

function isShortGenericFollowUpMessage(message: string): boolean {
  const n = normText(message);
  if (!n) return false;
  if (n.length > 48) return false;
  return (
    n === 'sim' ||
    n === 'continua' ||
    /\b(quero mais detalhes|me fala mais|me fale mais|mais detalhes|quero saber mais|mais informacoes|mais informa[cç][aã]o)\b/.test(
      n
    )
  );
}

function expandShortFollowUpWithContext(params: {
  userMessage: string;
  enterpriseName: string | null;
  awaitingName: boolean;
  appointmentActive: boolean;
}): { expanded: string; expandedApplied: boolean; reason: string | null } {
  const raw = (params.userMessage || '').trim();
  if (!raw) return { expanded: raw, expandedApplied: false, reason: null };

  if (params.awaitingName && looksLikeStandaloneNameReply(raw)) {
    return { expanded: raw, expandedApplied: false, reason: 'awaiting_name_raw_preserved' };
  }
  if (!isShortGenericFollowUpMessage(raw)) {
    return { expanded: raw, expandedApplied: false, reason: null };
  }

  const ent = (params.enterpriseName || '').trim();
  if (ent) {
    return {
      expanded: `${raw} sobre ${ent}`.trim(),
      expandedApplied: true,
      reason: 'generic_followup_with_active_enterprise',
    };
  }
  if (params.appointmentActive) {
    return {
      expanded: `${raw} sobre a visita agendada`.trim(),
      expandedApplied: true,
      reason: 'generic_followup_with_appointment_context',
    };
  }
  return { expanded: raw, expandedApplied: false, reason: 'no_context_to_expand' };
}

function userAskedAboutSpecificEnterprise(message: string): boolean {
  const n = normText(message);
  if (!n) return false;
  if (/\b(station|empreendimento|residencial|condominio|condomínio)\b/.test(n)) return true;
  return /\b(sobre|do|da|de|no|na)\s+[a-z0-9][a-z0-9\s-]{1,60}\b/.test(n);
}

/** Intervalo curto entre mídia confirmada e texto complementar (naturalidade no WhatsApp). */
const ANA_MEDIA_THEN_TEXT_GAP_MS = 2200;

type ResolvedEnterpriseFile = NonNullable<Awaited<ReturnType<typeof getFileForSend>>>;

type AnaMediaFirstResult = { ok: true } | { ok: false; error: string; code?: number; fileName: string };

type MaterialRequestTurnStatus =
  | 'MATERIAL_SENT'
  | 'MATERIAL_NOT_FOUND'
  | 'ENTERPRISE_NOT_RESOLVED'
  | 'MATERIAL_TYPE_NOT_RESOLVED'
  | 'SEND_FAILED';

type MaterialFlowFailureReason =
  | MaterialFileResolveFailureReason
  | 'enterprise_not_resolved'
  | 'material_type_not_resolved'
  | 'no_pending_material_context'
  | 'policy_table_requires_broker'
  | 'policy_visual_material_unavailable'
  | 'policy_material_text_fallback'
  | 'outbound_send_failed'
  | 'llm_bypassed'
  | 'guard_blocked_promise_without_send';

type MaterialFlowLogPayload = {
  userMessage: string;
  detectedMaterialRequest: boolean;
  isFollowupMaterialCommand: boolean;
  activeEnterpriseId: number | null;
  resolvedEnterpriseId: number | null;
  resolvedEnterpriseName: string | null;
  requestedMaterialType: FileCategory | null;
  pendingAction: string | null;
  pendingMaterialType: FileCategory | null;
  candidateFilesCount: number;
  candidateVersionsCount: number;
  selectedFileId: number | null;
  selectedFileVersionId: number | null;
  selectedStorageKey: string | null;
  selectedBucket: string | null;
  sendAttempted: boolean;
  sendSucceeded: boolean;
  failureReason: MaterialFlowFailureReason | null;
};

type MaterialRequestTurnResult =
  | {
      handled: false;
      log: MaterialFlowLogPayload;
    }
  | {
      handled: true;
      status: MaterialRequestTurnStatus;
      log: MaterialFlowLogPayload;
      textFallbackSent?: boolean;
    };

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
  const mediaRes = await sendLocalMediaToWhatsApp({
    conversationId,
    to: toPhoneNumber,
    filePath: file.path,
    filename: file.originalName,
    mimeFromDb: file.mime,
    phase: 'ana_media_first',
    options: {
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
    },
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

function toMaterialSendStatus(status: MaterialRequestTurnStatus): MaterialSendStatus {
  if (status === 'MATERIAL_SENT') return 'sent';
  if (status === 'MATERIAL_NOT_FOUND') return 'not_found';
  if (status === 'ENTERPRISE_NOT_RESOLVED') return 'enterprise_not_resolved';
  if (status === 'MATERIAL_TYPE_NOT_RESOLVED') return 'material_type_not_resolved';
  return 'send_failed';
}

function buildMaterialFlowLog(params: {
  userMessage: string;
  detectedMaterialRequest: boolean;
  isFollowupMaterialCommand: boolean;
  activeEnterpriseId: number | null;
  pendingAction: string | null;
  pendingMaterialType: FileCategory | null;
}): MaterialFlowLogPayload {
  return {
    userMessage: params.userMessage.slice(0, 500),
    detectedMaterialRequest: params.detectedMaterialRequest,
    isFollowupMaterialCommand: params.isFollowupMaterialCommand,
    activeEnterpriseId: params.activeEnterpriseId,
    resolvedEnterpriseId: null,
    resolvedEnterpriseName: null,
    requestedMaterialType: null,
    pendingAction: params.pendingAction,
    pendingMaterialType: params.pendingMaterialType,
    candidateFilesCount: 0,
    candidateVersionsCount: 0,
    selectedFileId: null,
    selectedFileVersionId: null,
    selectedStorageKey: null,
    selectedBucket: null,
    sendAttempted: false,
    sendSucceeded: false,
    failureReason: null,
  };
}

function buildMaterialFlowState(
  prev: CommercialFlowState,
  patch: {
    pendingAction: 'send_material' | null;
    pendingMaterialType: FileCategory | null;
    pendingEnterpriseId: number | null;
    lastRequestedMaterialType: FileCategory | null;
    status: MaterialRequestTurnStatus;
    lastMaterialSentId?: number | null;
  }
): CommercialFlowState {
  const nowIso = new Date().toISOString();
  return {
    ...prev,
    pending_action: patch.pendingAction,
    pending_material_type: patch.pendingMaterialType,
    pending_enterprise_id: patch.pendingEnterpriseId,
    last_requested_material_type: patch.lastRequestedMaterialType,
    last_material_request_at: nowIso,
    last_material_sent_id:
      patch.lastMaterialSentId ??
      (patch.status === 'MATERIAL_SENT' ? null : prev.last_material_sent_id ?? null),
    last_material_send_status: toMaterialSendStatus(patch.status),
    updatedAt: nowIso,
  };
}

async function sendMaterialFlowTextMessage(params: {
  conversationId: number;
  toPhoneNumber: string;
  text: string;
  replyPipelineToken?: number;
}): Promise<boolean> {
  if (isPipelineStale(params.conversationId, params.replyPipelineToken)) {
    return false;
  }
  const sendResult = await sendTextMessage({
    conversationId: params.conversationId,
    to: params.toPhoneNumber,
    text: params.text,
    phase: 'material_flow_text',
  });
  if (!sendResult.success || !sendResult.metaMessageId) {
    return false;
  }
  await insertMessage(params.conversationId, 'assistant', params.text, sendResult.metaMessageId);
  return true;
}

function isTableCommercialMaterialRequest(userMessage: string): boolean {
  const n = normText(userMessage || '');
  if (!n) return false;
  return /\b(tabela(?:\s+comercial)?|planilha|lista de precos?|tabela de precos?)\b/.test(n);
}

function isVisualMaterialRequest(userMessage: string): boolean {
  const n = normText(userMessage || '');
  if (!n) return false;
  return /\b(foto|fotos|imagem|imagens|video|videos)\b/.test(n);
}

function buildTableCommercialFallbackText(enterpriseName: string, hasSendableBook: boolean): string {
  if (hasSendableBook) {
    return `A tabela comercial é enviada pelo corretor, porque depende da disponibilidade e das condições do momento. Posso te passar os principais detalhes por aqui e, se quiser, o corretor te ajuda com a opção ideal.`;
  }
  return 'A tabela comercial é enviada pelo corretor, porque depende da disponibilidade e das condições do momento. Posso te passar os principais detalhes por aqui e, se quiser, o corretor te ajuda com a opção ideal.';
}

function buildVisualMaterialUnavailableFallbackText(): string {
  return 'Ainda não tenho fotos liberadas para envio por aqui. Quer que eu te conte os principais detalhes do empreendimento?';
}

async function handleMaterialRequestTurn(params: {
  conversationId: number;
  toPhoneNumber: string;
  userMessage: string;
  lastAssistantMessage: string | null;
  allActiveEnterprises: EnterpriseRow[];
  activeEnterprise: EnterpriseRow | null;
  flowState: CommercialFlowState;
  replyPipelineToken?: number;
}): Promise<MaterialRequestTurnResult> {
  const trimmed = params.userMessage.trim();
  const explicitMaterialAsk = userExplicitlyAskedForMaterial(trimmed).explicit;
  const followupMaterialCommand = isFollowupMaterialCommand(trimmed);
  const materialTopicMention = userAskedAboutMaterialTopic(trimmed);
  const detectedMaterialRequest = explicitMaterialAsk || followupMaterialCommand || materialTopicMention;
  const pendingAction = params.flowState.pending_action ?? null;
  const pendingMaterialType = params.flowState.pending_material_type ?? null;
  const activeEnterpriseId = params.activeEnterprise?.id ?? null;

  const logPayload = buildMaterialFlowLog({
    userMessage: trimmed,
    detectedMaterialRequest,
    isFollowupMaterialCommand: followupMaterialCommand,
    activeEnterpriseId,
    pendingAction,
    pendingMaterialType,
  });

  if (!detectedMaterialRequest) {
    return { handled: false, log: logPayload };
  }

  const requestedMaterialType =
    inferPreferredCategoryFromUserText(trimmed) ??
    params.flowState.pending_material_type ??
    params.flowState.last_requested_material_type ??
    null;
  const askedForTableCommercial = isTableCommercialMaterialRequest(trimmed);
  const askedForVisualMaterial = isVisualMaterialRequest(trimmed);
  logPayload.requestedMaterialType = requestedMaterialType;

  let resolvedEnterprise: EnterpriseRow | null = null;
  const enterpriseByMentionId = tryMatchEnterpriseFromUserCorpus(trimmed, params.allActiveEnterprises);
  if (enterpriseByMentionId != null) {
    resolvedEnterprise = params.allActiveEnterprises.find((item) => item.id === enterpriseByMentionId) ?? null;
  }
  if (!resolvedEnterprise && params.activeEnterprise) {
    resolvedEnterprise = params.activeEnterprise;
  }
  if (!resolvedEnterprise && params.flowState.pending_enterprise_id != null) {
    resolvedEnterprise =
      params.allActiveEnterprises.find((item) => item.id === params.flowState.pending_enterprise_id) ?? null;
  }
  if (!resolvedEnterprise && params.flowState.lastSingleCatalogEnterpriseId != null) {
    resolvedEnterprise =
      params.allActiveEnterprises.find((item) => item.id === params.flowState.lastSingleCatalogEnterpriseId) ?? null;
  }
  if (!resolvedEnterprise && params.flowState.lastInferredEnterpriseId != null) {
    resolvedEnterprise =
      params.allActiveEnterprises.find((item) => item.id === params.flowState.lastInferredEnterpriseId) ?? null;
  }

  logPayload.resolvedEnterpriseId = resolvedEnterprise?.id ?? null;
  logPayload.resolvedEnterpriseName = resolvedEnterprise?.name ?? null;

  if (!resolvedEnterprise) {
    logPayload.failureReason =
      followupMaterialCommand && pendingAction !== 'send_material'
        ? 'no_pending_material_context'
        : 'enterprise_not_resolved';
    const state = buildMaterialFlowState(params.flowState, {
      pendingAction: 'send_material',
      pendingMaterialType: requestedMaterialType,
      pendingEnterpriseId: null,
      lastRequestedMaterialType: requestedMaterialType,
      status: 'ENTERPRISE_NOT_RESOLVED',
      lastMaterialSentId: null,
    });
    await mergeConversationCommercialFlowState(params.conversationId, state);
    // Sem fallback determinístico: o engine vai bloquear outbound e acionar handoff operacional.
    console.log('[MATERIAL_FLOW]', logPayload);
    return { handled: true, status: 'ENTERPRISE_NOT_RESOLVED', log: logPayload };
  }

  if (askedForTableCommercial) {
    const sendableBook = await resolveSendableEnterpriseFileCurrentVersion(resolvedEnterprise.id, 'book');
    const fallbackText = buildTableCommercialFallbackText(resolvedEnterprise.name, Boolean(sendableBook.file));
    const textSent = await sendMaterialFlowTextMessage({
      conversationId: params.conversationId,
      toPhoneNumber: params.toPhoneNumber,
      text: fallbackText,
      replyPipelineToken: params.replyPipelineToken,
    });
    if (textSent) {
      logPayload.failureReason = 'policy_table_requires_broker';
      logPayload.sendSucceeded = true;
      const state = buildMaterialFlowState(params.flowState, {
        pendingAction: null,
        pendingMaterialType: null,
        pendingEnterpriseId: null,
        lastRequestedMaterialType: 'book',
        status: 'MATERIAL_NOT_FOUND',
        lastMaterialSentId: null,
      });
      await mergeConversationCommercialFlowState(params.conversationId, state);
      console.log('[MATERIAL_FLOW]', logPayload);
      return { handled: true, status: 'MATERIAL_NOT_FOUND', log: logPayload, textFallbackSent: true };
    }
    logPayload.failureReason = 'outbound_send_failed';
    console.log('[MATERIAL_FLOW]', logPayload);
    return { handled: true, status: 'SEND_FAILED', log: logPayload };
  }

  if (requestedMaterialType == null) {
    const fallbackText = askedForVisualMaterial
      ? buildVisualMaterialUnavailableFallbackText()
      : 'No momento nao consegui identificar um material para envio, mas posso te passar os principais detalhes do empreendimento por aqui. Que tal marcarmos uma visita?';
    const textSent = await sendMaterialFlowTextMessage({
      conversationId: params.conversationId,
      toPhoneNumber: params.toPhoneNumber,
      text: fallbackText,
      replyPipelineToken: params.replyPipelineToken,
    });
    if (textSent) {
      logPayload.failureReason = askedForVisualMaterial
        ? 'policy_visual_material_unavailable'
        : 'material_type_not_resolved';
      logPayload.sendSucceeded = true;
      const state = buildMaterialFlowState(params.flowState, {
        pendingAction: null,
        pendingMaterialType: null,
        pendingEnterpriseId: null,
        lastRequestedMaterialType: null,
        status: 'MATERIAL_TYPE_NOT_RESOLVED',
        lastMaterialSentId: null,
      });
      await mergeConversationCommercialFlowState(params.conversationId, state);
      console.log('[MATERIAL_FLOW]', logPayload);
      return { handled: true, status: 'MATERIAL_TYPE_NOT_RESOLVED', log: logPayload, textFallbackSent: true };
    }
    logPayload.failureReason = 'outbound_send_failed';
    console.log('[MATERIAL_FLOW]', logPayload);
    return { handled: true, status: 'SEND_FAILED', log: logPayload };
  }

  const fileResolution = await resolveSendableEnterpriseFileCurrentVersion(
    resolvedEnterprise.id,
    requestedMaterialType
  );
  logPayload.candidateFilesCount = fileResolution.candidateFilesCount;
  logPayload.candidateVersionsCount = fileResolution.candidateVersionsCount;

  if (!fileResolution.file) {
    const fallbackText = askedForVisualMaterial
      ? buildVisualMaterialUnavailableFallbackText()
      : 'No momento nao localizei esse material para envio, mas posso te passar os principais detalhes do empreendimento por aqui. Que tal marcarmos uma visita?';
    const textSent = await sendMaterialFlowTextMessage({
      conversationId: params.conversationId,
      toPhoneNumber: params.toPhoneNumber,
      text: fallbackText,
      replyPipelineToken: params.replyPipelineToken,
    });
    if (textSent) {
      logPayload.failureReason = askedForVisualMaterial
        ? 'policy_visual_material_unavailable'
        : (fileResolution.failureReason ?? 'policy_material_text_fallback');
      logPayload.sendSucceeded = true;
      const state = buildMaterialFlowState(params.flowState, {
        pendingAction: null,
        pendingMaterialType: null,
        pendingEnterpriseId: null,
        lastRequestedMaterialType: requestedMaterialType,
        status: 'MATERIAL_NOT_FOUND',
        lastMaterialSentId: null,
      });
      await mergeConversationCommercialFlowState(params.conversationId, state);
      console.log('[MATERIAL_FLOW]', logPayload);
      return { handled: true, status: 'MATERIAL_NOT_FOUND', log: logPayload, textFallbackSent: true };
    }
    logPayload.failureReason = 'outbound_send_failed';
    const state = buildMaterialFlowState(params.flowState, {
      pendingAction: 'send_material',
      pendingMaterialType: requestedMaterialType,
      pendingEnterpriseId: resolvedEnterprise.id,
      lastRequestedMaterialType: requestedMaterialType,
      status: 'MATERIAL_NOT_FOUND',
      lastMaterialSentId: null,
    });
    await mergeConversationCommercialFlowState(params.conversationId, state);
    console.log('[MATERIAL_FLOW]', logPayload);
    return { handled: true, status: 'MATERIAL_NOT_FOUND', log: logPayload };
  }

  const selectedFile = fileResolution.file;
  logPayload.selectedFileId = selectedFile.id;
  logPayload.selectedFileVersionId = selectedFile.versionId;
  logPayload.selectedStorageKey = selectedFile.storageKey;
  logPayload.selectedBucket = selectedFile.bucketName;
  logPayload.sendAttempted = true;

  if (isPipelineStale(params.conversationId, params.replyPipelineToken)) {
    logPayload.failureReason = 'outbound_send_failed';
    console.log('[MATERIAL_FLOW]', logPayload);
    return { handled: true, status: 'SEND_FAILED', log: logPayload };
  }

  const mediaOutcome = await sendAnaEnterpriseMediaFirst({
    conversationId: params.conversationId,
    toPhoneNumber: params.toPhoneNumber,
    ent: resolvedEnterprise,
    enterpriseIdForFile: resolvedEnterprise.id,
    cat: requestedMaterialType,
    preResolvedFile: selectedFile,
  });

  if (!mediaOutcome.ok) {
    logPayload.failureReason = 'outbound_send_failed';
    const state = buildMaterialFlowState(params.flowState, {
      pendingAction: 'send_material',
      pendingMaterialType: requestedMaterialType,
      pendingEnterpriseId: resolvedEnterprise.id,
      lastRequestedMaterialType: requestedMaterialType,
      status: 'SEND_FAILED',
      lastMaterialSentId: null,
    });
    await mergeConversationCommercialFlowState(params.conversationId, state);
    // Sem fallback determinístico: falha de envio vira bloqueio/handoff.
    console.log('[MATERIAL_FLOW]', logPayload);
    return { handled: true, status: 'SEND_FAILED', log: logPayload };
  }

  const ackSent = await sendMaterialFlowTextMessage({
    conversationId: params.conversationId,
    toPhoneNumber: params.toPhoneNumber,
    text: 'Enviei o material aqui para voce.',
    replyPipelineToken: params.replyPipelineToken,
  });

  if (!ackSent) {
    logPayload.failureReason = 'outbound_send_failed';
    const state = buildMaterialFlowState(params.flowState, {
      pendingAction: 'send_material',
      pendingMaterialType: requestedMaterialType,
      pendingEnterpriseId: resolvedEnterprise.id,
      lastRequestedMaterialType: requestedMaterialType,
      status: 'SEND_FAILED',
      lastMaterialSentId: selectedFile.id,
    });
    await mergeConversationCommercialFlowState(params.conversationId, state);
    console.log('[MATERIAL_FLOW]', logPayload);
    return { handled: true, status: 'SEND_FAILED', log: logPayload };
  }

  logPayload.sendSucceeded = true;
  logPayload.failureReason = 'llm_bypassed';
  const state = buildMaterialFlowState(params.flowState, {
    pendingAction: null,
    pendingMaterialType: null,
    pendingEnterpriseId: null,
    lastRequestedMaterialType: requestedMaterialType,
    status: 'MATERIAL_SENT',
    lastMaterialSentId: selectedFile.id,
  });
  await mergeConversationCommercialFlowState(params.conversationId, state);
  console.log('[MATERIAL_FLOW]', logPayload);
  return { handled: true, status: 'MATERIAL_SENT', log: logPayload };
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
  const blockInternalConversation = (conversationType: unknown): boolean => {
    const normalized = String(conversationType ?? 'CLIENT').toUpperCase();
    return normalized === 'CORRETOR' || normalized === 'ADMIN';
  };

  console.log('[ANA DEBUG] handleIncomingMessage start', { conversationId, toPhoneNumber });

  const trimmed = userMessage.trim();
  if (!trimmed) {
    console.log('[ANA_PIPELINE] engine_skip', {
      reason: 'empty_user_message_after_trim',
      conversationId,
      replyPipelineToken: replyPipelineToken ?? null,
    });
    console.log('[ANA DEBUG] mensagem vazia apos trim - ignorando');
    return;
  }

  if (isAnaEmergencyHandoffEnabled()) {
    console.log('[ANA_EMERGENCY_HANDOFF] active', {
      conversationId,
      toPhoneTail: anaPhoneTail(toPhoneNumber),
      inboundMetaMessageId: inboundMetaFromCtx ?? null,
      replyPipelineToken: replyPipelineToken ?? null,
    });
    const emergencyResult = await sendAnaEmergencyHandoff({
      conversationId,
      toPhoneNumber,
      sendTextMessage: anaEmergencyHandoffTransport.sendTextMessage,
      insertAssistantMessage: anaEmergencyHandoffTransport.insertAssistantMessage,
    });
    console.log('[ANA_EMERGENCY_HANDOFF] handled', {
      conversationId,
      sent: emergencyResult.sent,
      outboundMetaMessageId: emergencyResult.metaMessageId,
      error: emergencyResult.error,
      replyLen: ANA_EMERGENCY_HANDOFF_MESSAGE.length,
    });
    return;
  }

  const release = await acquireConversationLock(conversationId);
  let anaTurnAuditId: number | null = null;
  let anaTurnAuditOutcome: AnaTurnAuditOutboundStatus = 'silent';
  let anaTurnAuditBlockedReason: string | null = null;
  let anaTurnAuditGuardsApplied: Record<string, unknown> = {};
  let anaTurnAuditDecisionJson: Record<string, unknown> = {};
  let anaRepetitionAudit: AnaAxisRepetitionAuditSnapshot | null = null;
  let anaTurnAuditMissingInformationFlagCreated = false;
  let anaTurnAuditMissingInformationSubject: string | null = null;
  let anaTurnAuditProvider: string | null = null;
  let anaTurnAuditModel: string | null = null;
  let anaTurnAuditApiKeySource: 'enterprise' | 'global_fallback' | null = null;
  let anaTurnAuditOpenaiApiKeyId: string | null = null;
  let anaTurnAuditOpenaiProjectId: string | null = null;
  let anaTurnAuditInputTokens: number | null = null;
  let anaTurnAuditOutputTokens: number | null = null;
  let anaTurnAuditCachedInputTokens: number | null = null;
  let anaTurnAuditRequestType: string | null = 'ana_main_reply';
  let anaTurnAuditLlmStatus: 'success' | 'blocked' | 'skipped' | 'error' | null = null;
  let anaTurnAuditLlmHttpStatus: number | null = null;
  let anaTurnAuditErrorCode: string | null = null;
  let anaTurnAuditErrorMessage: string | null = null;
  let anaEnterpriseResolutionForAudit: AnaEnterpriseResolution = {
    source: 'unresolved',
    enterpriseId: null,
    enterpriseName: null,
    candidates: [],
    reasonWhenNoEnterprise: null,
  };
  let anaRagWasLoadedForAudit = false;
  let anaTurnDiagnostics: AnaTurnDiagnostics = createAnaTurnDiagnostics({});
  try {
    console.log('[ANA_PIPELINE] engine_start', {
      conversationId,
      toPhoneTail: anaPhoneTail(toPhoneNumber),
      replyPipelineToken: replyPipelineToken ?? null,
      inboundMetaMessageId: inboundMetaFromCtx ?? null,
      rawUserLen: userMessage.length,
      trailingUserBubbles: trailingUserBubbles ?? 1,
    });

    markAnaTurnStage(anaTurnDiagnostics, 'inbound_received', 'passed', {
      conversationId,
      userMessageLength: trimmed.length,
      inboundMetaMessageId: inboundMetaFromCtx ?? null,
    });

    let resolvedAiSettings: ResolvedEnterpriseAiSettings | null = null;
    const captureLlmAudit = (result: GenerateCompletionResult, requestType: string): void => {
      anaTurnAuditProvider = result.provider ?? anaTurnAuditProvider ?? null;
      anaTurnAuditModel = result.model ?? anaTurnAuditModel ?? null;
      anaTurnAuditRequestType = requestType;
      anaTurnAuditLlmHttpStatus = result.httpStatus ?? anaTurnAuditLlmHttpStatus;
      if (result.usage) {
        anaTurnAuditInputTokens = result.usage.inputTokens;
        anaTurnAuditOutputTokens = result.usage.outputTokens;
        anaTurnAuditCachedInputTokens = result.usage.cachedInputTokens;
      }
      if (result.success) {
        anaTurnAuditLlmStatus = 'success';
        anaTurnAuditErrorCode = null;
        anaTurnAuditErrorMessage = null;
      } else {
        anaTurnAuditLlmStatus = 'error';
        anaTurnAuditErrorCode =
          result.errorCode ?? result.classifiedError ?? 'UNKNOWN_LLM_ERROR';
        anaTurnAuditErrorMessage = result.error ?? null;
      }
    };

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
    anaTurnDiagnostics.contactId = conv.contact_id ?? null;
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

    // Revalidacao imediata antes do bloqueio: sempre buscar estado mais recente (evita race: usuario muda Handoff->ANA durante processamento)
    const latestConv = await getConversationById(conversationId);
    let effectiveConv = latestConv ?? conv;
    if (blockInternalConversation(effectiveConv.conversation_type)) {
      logger.info('Ana bloqueada para conversa interna', {
        conversationId: effectiveConv.id,
        reason: 'conversation_type_internal',
        conversationType: String(effectiveConv.conversation_type ?? 'CLIENT').toUpperCase(),
      });
      return;
    }

    console.log('[ANA DEBUG] handoff check', {
      handoff: effectiveConv.handoff,
      classification: effectiveConv.classification,
      conversationId,
    });

    // Decisao final SEMPRE com base no estado mais recente. Modo handoff: NAO responder. Modo ANA: SEMPRE responder via IA.
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
      console.log('[ANA DEBUG] handoff check blocked - conversa em modo humano, ANA nao responde', {
        conversationId,
        handoff: effectiveConv.handoff,
        classification: effectiveConv.classification,
      });
      return;
    }
    console.log('[ANA DEBUG] handoff check passed');

    if (hasExplicitHandoffIntent(trimmed)) {
      console.warn('explicit_handoff_intent_detected_no_auto_handoff', {
        origin: 'conversationEngine.hasExplicitHandoffIntent',
        conversationId,
      });
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
        const diagSend = await sendTextMessage({
          conversationId,
          to: toPhoneNumber,
          text: ANA_ENGINE_DIAGNOSTIC_TEXT,
          phase: 'engine_diagnostic_fixed_reply',
        });
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
    const isFirstAnaReply = !rows.some((m) => m.role === 'assistant');
    const lastAssistantBeforeUser = [...rows].reverse().find((m) => m.role === 'assistant');
    const lastAssistantPlain = lastAssistantBeforeUser?.content?.trim() || null;
    let trustedCustomerName =
      extractCustomerNameFromUserUtterance(trimmed, { lastAssistantPlain }) || null;
    if (!trustedCustomerName && effectiveConv.ana_asked_customer_name === true) {
      trustedCustomerName =
        extractCustomerNameFromUserUtterance(trimmed, { lastAssistantPlain: 'Como posso te chamar?' }) || null;
    }
    if (trustedCustomerName) {
      const mergedName = await mergeConfirmedCustomerNameIfEmpty(conversationId, trustedCustomerName);
      if (mergedName) {
        const refreshedAfterName = await getConversationById(conversationId);
        if (refreshedAfterName) {
          effectiveConv = refreshedAfterName;
          conv = refreshedAfterName;
        }
      }
      if (effectiveConv.contact_id != null) {
        await mergeContactNameIfMissing(effectiveConv.contact_id, trustedCustomerName);
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
    const linkedContact =
      effectiveConv.contact_id != null ? await findContactById(effectiveConv.contact_id) : null;
    let enterpriseResolution = await resolveEnterpriseForAnaTurn({
      userMessage: trimmed,
      activeEnterprises: allActiveEnterprises,
      conversationEnterpriseId: effectiveConv.enterprise_id,
      campaignEnterpriseId: effectiveConv.enterprise_origin_id ?? null,
      contactEnterpriseId: linkedContact?.enterprise_id ?? null,
    });
    anaEnterpriseResolutionForAudit = enterpriseResolution;
    if (
      enterpriseResolution.enterpriseId != null &&
      effectiveConv.enterprise_id !== enterpriseResolution.enterpriseId
    ) {
      const updated = await setConversationEnterpriseId(conversationId, enterpriseResolution.enterpriseId);
      if (updated) {
        effectiveConv = updated;
        conv = updated;
        flowStateParsed = parseCommercialFlowState(updated.commercial_flow_state) ?? flowStateParsed;
      }
    }
    console.log('[ANA_ENTERPRISE_RESOLUTION]', {
      conversationId,
      contactId: effectiveConv.contact_id ?? null,
      enterpriseResolutionSource: enterpriseResolution.source,
      resolvedEnterpriseId: enterpriseResolution.enterpriseId,
      resolvedEnterpriseName: enterpriseResolution.enterpriseName,
      enterpriseCandidates: enterpriseResolution.candidates,
      reasonWhenNoEnterprise: enterpriseResolution.reasonWhenNoEnterprise,
    });
    let enterpriseSourceForAudit: string = enterpriseResolution.source;
    const fullUserUtterances = buildUserUtterancesContext(rows);
    const lastUserRowForLog = [...rows].reverse().find((r) => r.role === 'user');
    const inboundMetaMessageId = lastUserRowForLog?.meta_message_id ?? inboundMetaFromCtx ?? null;
    const enterpriseIdForAi =
      effectiveConv.enterprise_id ??
      enterpriseResolution.enterpriseId ??
      linkedContact?.enterprise_id ??
      null;
    resolvedAiSettings = await resolveAiSettingsForEnterprise(enterpriseIdForAi);
    anaTurnDiagnostics.provider = detectLlmProvider(resolvedAiSettings.openaiBaseUrl);
    anaTurnDiagnostics.llm.provider = anaTurnDiagnostics.provider;
    console.log('[ANA AI SETTINGS RESOLUTION]', {
      conversationId,
      enterpriseIdForAi,
      blocked: resolvedAiSettings.blocked,
      reason: resolvedAiSettings.reason,
      apiKeySource: resolvedAiSettings.apiKeySource,
      hasApiKey: Boolean(resolvedAiSettings.openaiApiKey),
      emergencyBlockEnabled: resolvedAiSettings.emergencyBlockEnabled,
      aiEnabled: resolvedAiSettings.aiEnabled,
      useGlobalDefaults: resolvedAiSettings.useGlobalDefaults,
    });
    anaTurnAuditProvider = resolvedAiSettings.provider;
    anaTurnAuditApiKeySource = resolvedAiSettings.apiKeySource;
    anaTurnAuditOpenaiApiKeyId = resolvedAiSettings.openaiApiKeyId;
    anaTurnAuditOpenaiProjectId = resolvedAiSettings.openaiProjectId;

    // Legado desativado: esclarecimento sem empreendimento também deve passar pelo LLM/policy.
    if (false && (enterpriseResolution.source === 'ambiguous' || enterpriseResolution.source === 'unresolved')) {
      const deterministicReply: string =
        enterpriseResolution.source === 'ambiguous'
          ? buildAmbiguousEnterpriseReply(enterpriseResolution.candidates)
          : buildNoEnterpriseResolvedReply(trimmed);
      anaTurnDiagnostics.rag.consulted = false;
      anaTurnDiagnostics.rag.enterpriseResolved = false;
      anaTurnDiagnostics.rag.enterpriseId = null;
      anaTurnDiagnostics.rag.includedInPrompt = false;
      anaTurnDiagnostics.rag.reason =
        enterpriseResolution.source === 'ambiguous'
          ? 'RAG_NO_ENTERPRISE_LINK_AMBIGUOUS'
          : 'RAG_NO_ENTERPRISE_LINK';
      markAnaTurnStage(
        anaTurnDiagnostics,
        'enterprise_resolution',
        enterpriseResolution.source === 'ambiguous' ? 'failed' : 'skipped',
        {
          source: enterpriseResolution.source,
          candidates: enterpriseResolution.candidates,
          reasonWhenNoEnterprise: enterpriseResolution.reasonWhenNoEnterprise,
        }
      );
      markAnaTurnStage(anaTurnDiagnostics, 'rag_retrieval', 'skipped', {
        reason: anaTurnDiagnostics.rag.reason,
      });
      const turnAudit = await createAnaTurnAudit({
        conversationId,
        messageId: lastUserRowForLog?.id ?? null,
        enterpriseId: null,
        contactId: effectiveConv.contact_id ?? null,
        userMessage: trimmed,
        resolvedIntent: enterpriseResolution.source,
        resolvedProductType: null,
        primaryAxis: null,
        responseMode: 'short',
        evidenceJson: {},
        decisionJson: { enterpriseResolution },
        guardsAppliedJson: { enterpriseResolutionGuard: true },
        diagnosticsJson: anaTurnDiagnostics,
        outboundStatus: 'silent',
        blockedReason: null,
        missingInformationFlagCreated: false,
        missingInformationSubject: null,
        enterpriseResolutionSource: enterpriseResolution.source,
        resolvedEnterpriseId: null,
        resolvedEnterpriseName: null,
        enterpriseCandidates: enterpriseResolution.candidates,
        ragWasLoaded: false,
        reasonWhenNoEnterprise: enterpriseResolution.reasonWhenNoEnterprise,
      });
      anaTurnAuditId = turnAudit.id;
      anaTurnAuditDecisionJson = { enterpriseResolution };
      anaTurnAuditGuardsApplied = { enterpriseResolutionGuard: true };
      anaTurnAuditMissingInformationFlagCreated = false;
      anaTurnAuditMissingInformationSubject = null;

      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_enterprise_clarification';
        anaTurnDiagnostics.finalResponse.replySource = 'enterprise_resolution_clarification';
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        return;
      }
      const sendClarification = await sendTextMessage({
        conversationId,
        to: toPhoneNumber,
        text: deterministicReply,
        phase: 'enterprise_resolution_clarification',
      });
      if (sendClarification.success && sendClarification.metaMessageId) {
        await insertMessage(conversationId, 'assistant', deterministicReply, sendClarification.metaMessageId ?? null);
        anaTurnAuditOutcome = 'sent';
        anaTurnAuditBlockedReason = null;
        anaTurnDiagnostics.finalResponse.replySource = 'enterprise_resolution_clarification';
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
          replySource: 'enterprise_resolution_clarification',
          outboundStatus: anaTurnAuditOutcome,
        });
      } else {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'enterprise_resolution_clarification_send_failed';
        anaTurnDiagnostics.finalResponse.replySource = 'enterprise_resolution_clarification';
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
          replySource: 'enterprise_resolution_clarification',
          outboundStatus: anaTurnAuditOutcome,
          blockedReason: anaTurnAuditBlockedReason,
        });
      }
      return;
    }
    const currentFocusedEnterprise =
      effectiveConv.enterprise_id != null ? await getActiveEnterpriseById(effectiveConv.enterprise_id) : null;
    const flowHintEnterpriseId =
      flowStateParsed.lastSingleCatalogEnterpriseId ?? flowStateParsed.lastInferredEnterpriseId ?? null;
    const flowHintEnterpriseName =
      currentFocusedEnterprise?.name ??
      (flowHintEnterpriseId != null
        ? allActiveEnterprises.find((e) => e.id === flowHintEnterpriseId)?.name ?? null
        : null);
    const appointmentPreflight = computeAppointmentPreflight(trimmed, fullUserUtterances);
    const awaitingNameForExpansion =
      !(effectiveConv.customer_name || '').trim() && effectiveConv.ana_asked_customer_name === true;
    const expansion = expandShortFollowUpWithContext({
      userMessage: trimmed,
      enterpriseName: flowHintEnterpriseName,
      awaitingName: awaitingNameForExpansion,
      appointmentActive: appointmentPreflight.active,
    });
    const userMessageForReasoning = expansion.expandedApplied ? expansion.expanded : trimmed;
    if (expansion.expandedApplied || expansion.reason) {
      console.log('[ANA_CONTEXT_EXPANSION]', {
        conversationId,
        reason: expansion.reason,
        original_user_message: trimmed.slice(0, 220),
        expanded_user_message: userMessageForReasoning.slice(0, 220),
        enterpriseId: currentFocusedEnterprise?.id ?? null,
        enterpriseName: flowHintEnterpriseName,
        appointmentActive: appointmentPreflight.active,
        awaitingName: awaitingNameForExpansion,
      });
    }

    const triageRequestedProductType = inferRequestedProductType(userMessageForReasoning, fullUserUtterances);
    const acceptedTiposPool = expandTiposForCommercialPool(triageRequestedProductType);
    const enterprisesPool =
      acceptedTiposPool == null
        ? allActiveEnterprises
        : allActiveEnterprises.filter((e) => acceptedTiposPool.includes(e.tipo));
    const locGlobal = resolveEnterpriseLocationContext(
      userMessageForReasoning,
      fullUserUtterances,
      allActiveEnterprises
    );

    const globalMatchId =
      enterpriseResolution.source === 'message_alias' ? enterpriseResolution.enterpriseId : null;
    const mentionExplain = explainEnterpriseMentionMatch(
      userMessageForReasoning,
      allActiveEnterprises,
      globalMatchId
    );
    if (globalMatchId == null && userAskedAboutSpecificEnterprise(userMessageForReasoning)) {
      const topCandidates = debugEnterpriseMentionScores(userMessageForReasoning, allActiveEnterprises, 5);
      console.log('[ANA_ENTERPRISE_MATCH_FAIL]', {
        conversationId,
        userText: userMessageForReasoning.slice(0, 260),
        normalizedUserText: userMessageForReasoning
          .toLowerCase()
          .normalize('NFD')
          .replace(/\p{M}/gu, '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 260),
        activeEnterprisesCount: allActiveEnterprises.length,
        topCandidates,
        reason: topCandidates.length > 1 ? 'ambiguous_or_tie' : 'no_candidate',
      });
    }

    let scopeMutated = false;
    const entFocusForScope = (
      effectiveConv.enterprise_id != null ? await getActiveEnterpriseById(effectiveConv.enterprise_id) : null
    ) as EnterpriseRow;
    if (globalMatchId != null && effectiveConv.enterprise_id == null) {
      await setConversationEnterpriseId(conversationId, globalMatchId);
      enterpriseSourceForAudit = 'inferred';
      await mergeConversationCommercialFlowState(conversationId, resetCommercialScopeHints(flowStateParsed));
      scopeMutated = true;
    } else if (false && entFocusForScope) {
      const explicitEnterpriseAsk = userAskedAboutSpecificEnterprise(userMessageForReasoning);
      const userStillRefersToCurrentFocus = enterpriseHasStrongNameSignalInTrimmed(
        entFocusForScope.id,
        userMessageForReasoning,
        allActiveEnterprises
      );
      if (globalMatchId != null && globalMatchId !== entFocusForScope.id) {
        await setConversationEnterpriseId(conversationId, globalMatchId);
        enterpriseSourceForAudit = 'inferred';
        await mergeConversationCommercialFlowState(conversationId, resetCommercialScopeHints(flowStateParsed));
        scopeMutated = true;
      } else if (explicitEnterpriseAsk && globalMatchId == null && !userStillRefersToCurrentFocus) {
        // Cliente puxou novo empreendimento nominal, mas sem match único;
        // limpa foco antigo para evitar fallback sequestrado por contexto anterior.
        await setConversationEnterpriseId(conversationId, null);
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
    if (enterpriseResolution.source === 'message_alias') {
      await mergeConversationCommercialFlowState(conversationId, resetCommercialScopeHints(flowStateParsed));
      scopeMutated = true;
    }
    if (scopeMutated) {
      const refreshed = await getConversationById(conversationId);
      if (refreshed) {
        effectiveConv = refreshed;
        flowStateParsed = parseCommercialFlowState(refreshed.commercial_flow_state) ?? {};
      }
    }

    const locationQueryContext = resolveEnterpriseLocationContext(
      userMessageForReasoning,
      fullUserUtterances,
      enterprisesPool
    );

    const muni = findMunicipioInMessage(`${userMessageForReasoning}\n${fullUserUtterances}`);
    console.log('[ANA_INTENT]', {
      conversationId,
      userText: userMessageForReasoning.slice(0, 500),
      inferredProductType: triageRequestedProductType,
      inferredCity: muni?.n ?? null,
      mentionedEnterpriseName: mentionExplain.bestEnterpriseName,
      previousProductTypeHint: previousProductTypeHintForLog,
    });
    console.log('[ANA_MENTION_DEBUG]', {
      conversationId,
      userText: userMessageForReasoning.slice(0, 400),
      mentionedEnterpriseName: mentionExplain.bestEnterpriseName,
      matchedByName: mentionExplain.matchedByName,
      matchedBySlug: mentionExplain.matchedBySlug,
      matchedEnterpriseId: globalMatchId,
    });

    let ent =
      effectiveConv.enterprise_id != null ? await getActiveEnterpriseById(effectiveConv.enterprise_id) : null;
    const inactiveLinked = Boolean(effectiveConv.enterprise_id && !ent);
    anaTurnDiagnostics.rag.enterpriseResolved = ent != null;
    anaTurnDiagnostics.rag.enterpriseId = ent?.id ?? effectiveConv.enterprise_id ?? null;
    anaTurnDiagnostics.rag.reason =
      ent == null && effectiveConv.enterprise_id == null
        ? 'RAG_NO_ENTERPRISE_LINK'
        : inactiveLinked
          ? 'RAG_NO_ACTIVE_FILES'
          : null;
    markAnaTurnStage(
      anaTurnDiagnostics,
      'enterprise_resolution',
      ent != null ? 'passed' : 'skipped',
      {
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        inactiveLinked,
        conversationEnterpriseId: effectiveConv.enterprise_id ?? null,
      }
    );

    const materialTurnResult = await handleMaterialRequestTurn({
      conversationId,
      toPhoneNumber,
      userMessage: trimmed,
      lastAssistantMessage: lastAssistantPlain,
      allActiveEnterprises,
      activeEnterprise: ent,
      flowState: flowStateParsed,
      replyPipelineToken,
    });
    if (materialTurnResult.handled) {
      if (materialTurnResult.status === 'MATERIAL_SENT') {
        anaTurnAuditOutcome = 'material_sent';
        anaTurnAuditBlockedReason = null;
      } else if (materialTurnResult.textFallbackSent) {
        anaTurnAuditOutcome = 'sent';
        anaTurnAuditBlockedReason = null;
      } else if (materialTurnResult.status === 'SEND_FAILED') {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'material_flow_send_failed_handoff';
      } else {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = `material_flow_${materialTurnResult.status.toLowerCase()}_handoff`;
      }
      if (materialTurnResult.status !== 'MATERIAL_SENT' && !materialTurnResult.textFallbackSent) {
        console.log('[ANA_MATERIAL_FLOW_BLOCKED]', {
          conversationId,
          status: materialTurnResult.status,
          blockedReason: anaTurnAuditBlockedReason,
        });
      } else if (materialTurnResult.textFallbackSent) {
        console.log('[ANA_MATERIAL_FLOW_TEXT_FALLBACK]', {
          conversationId,
          status: materialTurnResult.status,
        });
      }
      return;
    }

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

    const chunkHint = [userMessageForReasoning, fullUserUtterances].filter(Boolean).join('\n').slice(0, 12_000);
    const knowledgeParts: string[] = [];
    let ragChunksFound = 0;
    let ragRetrievalError: string | null = null;
    const ragSourceFiles = new Set<string>();
    const ragChunkIds = new Set<number>();
    const knowledgeIds = ent != null ? [ent.id] : [];
    for (const eid of knowledgeIds) {
      const row = allActiveEnterprises.find((x) => x.id === eid);
      if (!row) continue;
      const cityPriority = muni?.n ?? row.city ?? null;
      const chunkMeta = await loadRankedKnowledgeChunksForPromptWithMeta(eid, `${row.name}\n${chunkHint}`, {
        targetCity: cityPriority,
      });
      const chunk = chunkMeta.promptText;
      if (chunkMeta.retrievalError && !ragRetrievalError) {
        ragRetrievalError = chunkMeta.retrievalError;
      }
      ragChunksFound += chunkMeta.selectedChunkCount;
      for (const chunkId of chunkMeta.selectedChunkIds) ragChunkIds.add(chunkId);
      for (const fileName of chunkMeta.sourceFiles) ragSourceFiles.add(fileName);
      const kb = await loadAgentKnowledgeText(eid);
      const merged = [chunk, kb].filter(Boolean).join('\n\n');
      if (merged.trim()) knowledgeParts.push(`--- ${row.name} ---\n${merged}`);
    }
    const knowledgeText = knowledgeParts.join('\n\n').slice(0, 52_000);
    anaRagWasLoadedForAudit = knowledgeText.trim().length > 0;

    let fileInventory = '';
    let hasSendableFiles = false;
    let sendableAnaCategories: FileCategory[] = [];
    let enterpriseFilesInventory: Awaited<ReturnType<typeof listEnterpriseFiles>> = [];
    if (ent) {
      const files = await listEnterpriseFiles(ent.id);
      enterpriseFilesInventory = files;
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
    anaTurnDiagnostics.rag.consulted = knowledgeIds.length > 0;
    anaTurnDiagnostics.rag.activeKnowledgeFileCount = enterpriseFilesInventory.filter(
      (f) => f.is_active && f.can_be_used_as_knowledge
    ).length;
    anaTurnDiagnostics.rag.evidenceChunkCount = ragChunksFound;
    anaTurnDiagnostics.rag.evidenceChunkIds = Array.from(ragChunkIds).slice(0, 80);
    anaTurnDiagnostics.rag.sourceFiles = Array.from(ragSourceFiles).slice(0, 20);
    anaTurnDiagnostics.rag.reason =
      ragRetrievalError != null
        ? 'RAG_RETRIEVAL_ERROR'
        : ent == null && effectiveConv.enterprise_id == null
          ? 'RAG_NO_ENTERPRISE_LINK'
          : anaTurnDiagnostics.rag.activeKnowledgeFileCount === 0 && ent != null
            ? 'RAG_NO_ACTIVE_FILES'
            : ragChunksFound === 0
              ? 'RAG_NO_RELEVANT_CHUNKS'
              : null;
    markAnaTurnStage(
      anaTurnDiagnostics,
      'rag_retrieval',
      ragRetrievalError == null ? 'passed' : 'failed',
      {
        knowledgeIds,
        evidenceChunkCount: ragChunksFound,
        evidenceChunkIds: anaTurnDiagnostics.rag.evidenceChunkIds,
        sourceFiles: anaTurnDiagnostics.rag.sourceFiles,
        reason: anaTurnDiagnostics.rag.reason,
      }
    );

    const enterpriseEvidence = buildAnaEnterpriseEvidence({
      enterprise: ent,
      files: enterpriseFilesInventory.map((f) => ({
        category: f.category,
        is_active: f.is_active,
        can_be_sent_by_ana: f.can_be_sent_by_ana,
        can_be_used_as_knowledge: f.can_be_used_as_knowledge,
        original_name: f.original_name,
      })),
      variablesMap: vars,
      knowledgeText,
    });
    const structuredFactsFound = Object.values(vars).some((value) => String(value ?? '').trim().length > 0);
    console.log('[ANA_EVIDENCE]', {
      conversationId,
      enterprise: ent?.name ?? null,
      enterpriseId: ent?.id ?? null,
      hasSendableBook: enterpriseEvidence.hasSendableBook,
      hasSendableFloorplan: enterpriseEvidence.hasSendableFloorplan,
      hasAnySendableMaterial: enterpriseEvidence.hasAnySendableMaterial,
      hasExactLocation: enterpriseEvidence.hasExactLocation,
      hasPricingInfo: enterpriseEvidence.hasPricingInfo,
      hasFinancingInfo: enterpriseEvidence.hasFinancingInfo,
      hasUsableKnowledgeChunks: enterpriseEvidence.hasUsableKnowledgeChunks,
    });
    const validatedEvidenceBlock = [
      `book_enviavel_disponivel: ${enterpriseEvidence.hasSendableBook ? 'sim' : 'não'}`,
      `planta_enviavel_disponivel: ${enterpriseEvidence.hasSendableFloorplan ? 'sim' : 'não'}`,
      `material_enviavel_disponivel: ${enterpriseEvidence.hasAnySendableMaterial ? 'sim' : 'não'}`,
      `localizacao_exata_disponivel: ${enterpriseEvidence.hasExactLocation ? 'sim' : 'não'}`,
      `preco_estruturado_disponivel: ${enterpriseEvidence.hasPricingInfo ? 'sim' : 'não'}`,
      `financiamento_estruturado_disponivel: ${enterpriseEvidence.hasFinancingInfo ? 'sim' : 'não'}`,
      `conhecimento_textual_disponivel: ${enterpriseEvidence.hasUsableKnowledgeChunks ? 'sim' : 'não'}`,
      'Regra: só prometa envio/posse quando o respectivo campo acima estiver em "sim".',
    ].join('\n');

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

    const history =
      trailingUserBubbles != null && trailingUserBubbles > 1
        ? rowsToHistory(rows, null, trailingUserBubbles)
        : rowsToHistory(rows, trimmed);
    const historyCount = history.length;
    const previousTurnAudit = await getLastAnaTurnAuditByConversation(conversationId);
    const lastTurnWasMissingInformation = Boolean(previousTurnAudit?.missing_information_subject);
    const explicitPriceAskedThisTurn = userExplicitlyAskedPriceInCurrentTurn(trimmed);
    const bareGreeting = isBareGreetingOnly(trimmed);
    const materialAskIntentThisTurn = userExplicitlyAskedForMaterial(trimmed);
    const explicitMaterialRequestThisTurn = materialAskIntentThisTurn.explicit && !bareGreeting;
    const userResolvedPurchaseIntentThisTurn = inferResolvedPurchaseIntent(trimmed);
    const resolvedPurchaseIntentForTurn =
      userResolvedPurchaseIntentThisTurn ?? flowStateParsed.purchaseIntent ?? null;
    const requestedAxisForPolicy = inferUserRequestedAxis(userMessageForReasoning);
    const lastAxisFromAudit = isCommercialAxis(previousTurnAudit?.primary_axis ?? null)
      ? (previousTurnAudit?.primary_axis as CommercialAxis)
      : null;
    const lastAxisFromAssistant = inferAxisFromAssistantText(lastAssistantPlain);
    const lastAxisForRepetition = lastAxisFromAudit ?? lastAxisFromAssistant;
    const asksForMoreThisTurn = asksForMoreItems(trimmed);
    const evidenceHasAnswer =
      requestedAxisForPolicy != null
        ? hasAnaEvidenceForNeed(enterpriseEvidence, requestedAxisForPolicy)
        : enterpriseEvidence.hasUsableKnowledgeChunks;
    const explicitExactLocationRequestThisTurn = detectExplicitExactLocationRequest(trimmed);
    const explicitPaymentSimulationRequestThisTurn = detectExplicitPaymentSimulationRequest(trimmed);
    const asksListStyleInfoThisTurn = detectStructuredListIntent(trimmed, requestedAxisForPolicy);
    const asksSpecificInfoWithoutEvidenceThisTurn =
      explicitExactLocationRequestThisTurn || requestedAxisForPolicy != null;
    const policyDetectedIntent =
      explicitMaterialRequestThisTurn
        ? 'pedir_material'
        : requestedAxisForPolicy ?? (appointmentPreflight.active ? 'agendar' : 'geral');
    const anaDecision = buildAnaDecisionPolicy({
      detectedIntent: policyDetectedIntent,
      requestedAxis: requestedAxisForPolicy,
      lastAxis: lastAxisForRepetition,
      requestedProductType: triageRequestedProductType,
      enterpriseResolved: ent != null,
      enterpriseId: ent?.id ?? null,
      enterpriseEvidence,
      conversationContext: {
        phase: conversationPhase,
        historyCount,
        hasOpenAppointment: appointmentPreflight.active || !!openAppointmentSummary,
      },
      turnFlags: {
        isBareGreeting: bareGreeting,
        isShortFollowUp: isShortGenericFollowUpMessage(trimmed),
        isFirstAnaReply,
        explicitMaterialRequest: explicitMaterialRequestThisTurn,
        explicitExactLocationRequest: explicitExactLocationRequestThisTurn,
        explicitPaymentSimulationRequest: explicitPaymentSimulationRequestThisTurn,
        asksListStyleInfo: asksListStyleInfoThisTurn,
        asksSpecificInfoWithoutEvidence: asksSpecificInfoWithoutEvidenceThisTurn,
      },
      userMessage: trimmed,
    });
    const asksForMoreOnSameAxisPolicy = anaDecision.isAskingForMoreOnSameAxis === true;
    const asksForMoreThisTurnNormalized = asksForMoreThisTurn || asksForMoreOnSameAxisPolicy;
    const currentAxisForRepetition: CommercialAxis | null =
      isCommercialAxis(anaDecision.currentAxis)
        ? anaDecision.currentAxis
        : requestedAxisForPolicy ??
          (asksForMoreThisTurnNormalized && lastAxisForRepetition != null ? lastAxisForRepetition : null) ??
          (isCommercialAxis(anaDecision.primaryAxis) ? anaDecision.primaryAxis : null);
    const evidenceFoundForCurrentAxis =
      currentAxisForRepetition != null
        ? hasAnaEvidenceForNeed(enterpriseEvidence, currentAxisForRepetition)
        : enterpriseEvidence.hasUsableKnowledgeChunks;
    anaRepetitionAudit = {
      detectedIntent: policyDetectedIntent,
      lastAxis: lastAxisForRepetition,
      currentAxis: currentAxisForRepetition,
      alreadyAnswered: false,
      evidenceFound: evidenceFoundForCurrentAxis,
      responseMode: anaDecision.responseMode,
      reasonForNotRepeatingAnswer: null,
    };
    anaTurnAuditDecisionJson = {
      ...anaDecision,
      repetitionAudit: anaRepetitionAudit,
      ragAudit: {
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        retrievedChunkCount: ragChunksFound,
        retrievedChunkIds: anaTurnDiagnostics.rag.evidenceChunkIds,
        sourceFiles: anaTurnDiagnostics.rag.sourceFiles,
        retry: false,
        emptyFallbackBlocked: false,
        finalResponsePreview: null,
      },
    };
    console.log('[ANA_REPETITION_AUDIT]', {
      conversationId,
      phase: 'policy',
      ...anaRepetitionAudit,
    });
    console.log('[ANA_DECISION_POLICY]', {
      conversationId,
      policyVersion: anaDecision.policyVersion,
      resolvedIntent: anaDecision.resolvedIntent,
      primaryAxis: anaDecision.primaryAxis,
      responseMode: anaDecision.responseMode,
      shouldSendMaterial: anaDecision.shouldSendMaterial,
      shouldUseMissingInformationReply: anaDecision.shouldUseMissingInformationReply,
      shouldCreateInfoGapFlag: anaDecision.shouldCreateInfoGapFlag,
      canMentionExactLocation: anaDecision.canMentionExactLocation,
      canMentionPaymentSimulation: anaDecision.canMentionPaymentSimulation,
      outboundAllowed: anaDecision.outboundAllowed,
      blockedReason: anaDecision.blockedReason,
      userResolvedPurchaseIntentThisTurn,
      resolvedPurchaseIntentForTurn,
      explicitMaterialRequestThisTurn,
      explicitExactLocationRequestThisTurn,
      explicitPaymentSimulationRequestThisTurn,
      detectedIntent: anaDecision.detectedIntent,
      currentAxis: anaDecision.currentAxis,
      lastAxis: anaDecision.lastAxis,
      isDirectInfoRequest: anaDecision.isDirectInfoRequest,
      isGenericOpenQuestion: anaDecision.isGenericOpenQuestion,
      isRepeatOfLastAxis: anaDecision.isRepeatOfLastAxis,
      isAskingForMoreOnSameAxis: anaDecision.isAskingForMoreOnSameAxis,
      evidenceFound: anaDecision.evidenceFound,
      shouldAnswerDirectly: anaDecision.shouldAnswerDirectly,
      shouldAskClarifyingQuestion: anaDecision.shouldAskClarifyingQuestion,
      shouldAvoidGenericFallback: anaDecision.shouldAvoidGenericFallback,
      lastAxisForRepetition,
      currentAxisForRepetition,
      asksForMoreThisTurn: asksForMoreThisTurnNormalized,
    });
    anaTurnAuditMissingInformationFlagCreated = anaDecision.shouldCreateInfoGapFlag;
    anaTurnAuditMissingInformationSubject = anaDecision.missingInformationSubject ?? null;
    anaTurnAuditGuardsApplied = {
      policy: {
        version: anaDecision.policyVersion,
        resolvedIntent: anaDecision.resolvedIntent,
        primaryAxis: anaDecision.primaryAxis,
        responseMode: anaDecision.responseMode,
        detectedIntent: anaDecision.detectedIntent,
        currentAxis: anaDecision.currentAxis,
        lastAxis: anaDecision.lastAxis,
        isDirectInfoRequest: anaDecision.isDirectInfoRequest,
        isGenericOpenQuestion: anaDecision.isGenericOpenQuestion,
        isRepeatOfLastAxis: anaDecision.isRepeatOfLastAxis,
        isAskingForMoreOnSameAxis: anaDecision.isAskingForMoreOnSameAxis,
        evidenceFound: anaDecision.evidenceFound,
        shouldAnswerDirectly: anaDecision.shouldAnswerDirectly,
        shouldAskClarifyingQuestion: anaDecision.shouldAskClarifyingQuestion,
        shouldAvoidGenericFallback: anaDecision.shouldAvoidGenericFallback,
      },
      operationalResolverFired: false,
      operationalFactGuardReplaced: false,
      financialGuardReplacedSentences: 0,
      firstAxisGuardChanged: false,
      firstEvidenceGuardChanged: false,
      finalAxisGuardChanged: false,
      finalEvidenceGuardChanged: false,
      outboundReason: null,
      outboundRecovered: false,
      repetitionAudit: anaRepetitionAudit,
    };

    const turnAudit = await createAnaTurnAudit({
      conversationId,
      messageId: lastUserRowForLog?.id ?? null,
      enterpriseId: ent?.id ?? null,
      contactId: effectiveConv.contact_id ?? null,
      userMessage: trimmed,
      resolvedIntent: anaDecision.resolvedIntent,
      resolvedProductType: triageRequestedProductType,
      primaryAxis: anaDecision.primaryAxis,
      responseMode: anaDecision.responseMode,
      evidenceJson: enterpriseEvidence,
      decisionJson: anaTurnAuditDecisionJson,
      guardsAppliedJson: anaTurnAuditGuardsApplied,
      diagnosticsJson: anaTurnDiagnostics,
      outboundStatus: 'silent',
      blockedReason: anaDecision.blockedReason,
      missingInformationFlagCreated: anaDecision.shouldCreateInfoGapFlag,
      missingInformationSubject: anaDecision.missingInformationSubject ?? null,
      enterpriseResolutionSource: enterpriseResolution.source,
      resolvedEnterpriseId: ent?.id ?? null,
      resolvedEnterpriseName: ent?.name ?? null,
      enterpriseCandidates: enterpriseResolution.candidates,
      ragWasLoaded: knowledgeText.trim().length > 0,
      reasonWhenNoEnterprise: enterpriseResolution.reasonWhenNoEnterprise,
      provider: anaTurnAuditProvider,
      model: anaTurnAuditModel,
      apiKeySource: anaTurnAuditApiKeySource,
      openaiApiKeyId: anaTurnAuditOpenaiApiKeyId,
      openaiProjectId: anaTurnAuditOpenaiProjectId,
      requestType: anaTurnAuditRequestType,
      llmStatus: anaTurnAuditLlmStatus,
      llmHttpStatus: anaTurnAuditLlmHttpStatus,
      errorCode: anaTurnAuditErrorCode,
      errorMessage: anaTurnAuditErrorMessage,
    });
    anaTurnAuditId = turnAudit.id;

    if (!resolvedAiSettings || resolvedAiSettings.blocked || !resolvedAiSettings.openaiApiKey) {
      const blockedReason = resolvedAiSettings?.reason ?? 'missing_global_api_key';
      if (blockedReason === 'ana_model_not_configured') {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = blockedReason;
        anaTurnAuditLlmStatus = 'blocked';
        anaTurnAuditErrorCode = blockedReason;
        anaTurnAuditErrorMessage = 'Configuração de modelo da Ana ausente/inválida no banco.';
        anaTurnAuditRequestType = 'enterprise_ai_block';
        markAnaTurnStage(anaTurnDiagnostics, 'llm_generation', 'failed', {
          blockedReason,
          apiKeySource: resolvedAiSettings?.apiKeySource ?? null,
        });
        anaTurnDiagnostics.finalResponse.replySource = null;
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        return;
      }
      const blockedReply =
        blockedReason === 'emergency_block'
          ? resolvedAiSettings?.blockedMessage ??
            'No momento este empreendimento esta com atendimento automatico temporariamente bloqueado.'
          : blockedReason === 'ai_disabled'
            ? 'No momento o atendimento automatico deste empreendimento esta desativado. Vou direcionar voce para um corretor.'
            : blockedReason === 'missing_enterprise_api_key'
              ? 'No momento a configuracao de IA deste empreendimento esta incompleta. Vou direcionar voce para um corretor.'
              : 'No momento a configuracao global de IA esta indisponivel. Vou direcionar voce para um corretor.';

      anaTurnAuditLlmStatus = 'blocked';
      anaTurnAuditErrorCode = blockedReason;
      anaTurnAuditErrorMessage = blockedReply;
      anaTurnAuditRequestType = 'enterprise_ai_block';
      markAnaTurnStage(anaTurnDiagnostics, 'llm_generation', 'skipped', {
        blockedReason,
        apiKeySource: resolvedAiSettings?.apiKeySource ?? null,
      });

      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = `pipeline_stale_before_${blockedReason}`;
        anaTurnDiagnostics.finalResponse.replySource = 'enterprise_ai_blocked';
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        return;
      }

      const blockedSendResult = await sendTextMessage({
        conversationId,
        to: toPhoneNumber,
        text: blockedReply,
        phase: 'enterprise_ai_blocked',
      });
      if (blockedSendResult.success && blockedSendResult.metaMessageId) {
        await insertMessage(conversationId, 'assistant', blockedReply, blockedSendResult.metaMessageId);
        anaTurnAuditOutcome = 'sent';
        anaTurnAuditBlockedReason = blockedReason;
        anaTurnDiagnostics.finalResponse.replySource = 'enterprise_ai_blocked';
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
          replySource: 'enterprise_ai_blocked',
          outboundStatus: anaTurnAuditOutcome,
          blockedReason,
        });
      } else {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = `enterprise_ai_blocked_send_failed:${blockedReason}`;
        anaTurnDiagnostics.finalResponse.replySource = 'enterprise_ai_blocked';
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
          replySource: 'enterprise_ai_blocked',
          outboundStatus: anaTurnAuditOutcome,
          blockedReason: anaTurnAuditBlockedReason,
        });
      }
      return;
    }
    const aiSettings = resolvedAiSettings;
    const aiApiKey = aiSettings.openaiApiKey;
    if (!aiApiKey) {
      anaTurnAuditOutcome = 'blocked';
      anaTurnAuditBlockedReason = 'missing_resolved_api_key_after_gate';
      anaTurnAuditLlmStatus = 'blocked';
      anaTurnAuditErrorCode = 'missing_global_api_key';
      anaTurnAuditErrorMessage =
        'No momento a configuracao de IA deste empreendimento esta indisponivel.';
      anaTurnDiagnostics.finalResponse.replySource = null;
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
        replySource: null,
        outboundStatus: anaTurnAuditOutcome,
        blockedReason: anaTurnAuditBlockedReason,
      });
      return;
    }

    const userRefusedScheduling =
      isVisitSchedulingRefusal(trimmed) || isVisitSchedulingRefusalMessage(trimmed);
    const userIrritatedNow = isUserIrritated(trimmed);
    if (userRefusedScheduling && flowStateParsed.pendingVisitScheduling === true) {
      const cancelledSchedulingState = {
        ...flowStateParsed,
        pendingVisitScheduling: false,
        pendingVisitDateLabel: null,
        pendingVisitDate: null,
        pendingVisitEnterpriseId: null,
        updatedAt: new Date().toISOString(),
      };
      await mergeConversationCommercialFlowState(conversationId, cancelledSchedulingState);
      flowStateParsed = cancelledSchedulingState;
      console.log('[APPOINTMENT_FLOW_CANCELLED_BY_USER]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        reason: 'user_refused_scheduling',
        userMessagePreview: trimmed.slice(0, 220),
      });
      anaTurnAuditGuardsApplied.appointmentFlowCancelledByUser = true;
    }

    const suppressDirectVisitSchedulingForGenericInterest =
      isEvoraEnterpriseName(ent?.name ?? null) && isGenericInterestFollowup(trimmed);
    const directVisitSchedulingIntent = !suppressDirectVisitSchedulingForGenericInterest && isVisitSchedulingIntent({
      userMessage: trimmed,
      flowState: flowStateParsed,
      resolvedIntent: anaDecision.resolvedIntent,
      primaryAxis: anaDecision.primaryAxis,
      currentAxis: anaDecision.currentAxis,
      requestedAxis: requestedAxisForPolicy,
      lastAssistantMessage: lastAssistantPlain,
      enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
      referenceNow: lastUserMessageAt,
    });
    const directVisitSchedulingDecision = directVisitSchedulingIntent && !userRefusedScheduling
      ? handleVisitSchedulingDeterministically({
          userMessage: trimmed,
          flowState: flowStateParsed,
          resolvedIntent: anaDecision.resolvedIntent,
          primaryAxis: anaDecision.primaryAxis,
          currentAxis: anaDecision.currentAxis,
          requestedAxis: requestedAxisForPolicy,
          lastAssistantMessage: lastAssistantPlain,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          referenceNow: lastUserMessageAt,
        })
      : null;
    const directVisitSchedulingAudit = {
      conversationId,
      contactId: effectiveConv.contact_id ?? null,
      enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
      enterpriseSource: enterpriseSourceForAudit,
      resolvedIntent: anaDecision.resolvedIntent,
      primaryAxis: anaDecision.primaryAxis,
      pendingVisitScheduling:
        directVisitSchedulingDecision?.pendingVisitScheduling ?? flowStateParsed.pendingVisitScheduling === true,
      extractedDateLabel: directVisitSchedulingDecision?.extractedDateLabel ?? null,
      extractedTime: directVisitSchedulingDecision?.extractedTime ?? null,
      deterministicSchedulingHandled: directVisitSchedulingDecision?.handled === true,
      schedulingHandledReason: directVisitSchedulingDecision?.reason ?? null,
    };
    anaTurnDiagnostics.scheduling = {
      enterpriseId: directVisitSchedulingAudit.enterpriseId,
      enterpriseSource: directVisitSchedulingAudit.enterpriseSource,
      resolvedIntent: directVisitSchedulingAudit.resolvedIntent,
      primaryAxis: directVisitSchedulingAudit.primaryAxis,
      pendingVisitScheduling: directVisitSchedulingAudit.pendingVisitScheduling,
      extractedDateLabel: directVisitSchedulingAudit.extractedDateLabel,
      extractedTime: directVisitSchedulingAudit.extractedTime,
      deterministicSchedulingHandled: directVisitSchedulingAudit.deterministicSchedulingHandled,
      schedulingHandledReason: directVisitSchedulingAudit.schedulingHandledReason,
    };
    anaTurnAuditDecisionJson = {
      ...anaTurnAuditDecisionJson,
      directVisitScheduling: directVisitSchedulingAudit,
    };
    anaTurnAuditGuardsApplied.directVisitScheduling = directVisitSchedulingAudit;
    console.log('[ANA_DIRECT_VISIT_SCHEDULING]', directVisitSchedulingAudit);

    if (directVisitSchedulingDecision?.handled && directVisitSchedulingDecision.reply) {
      let deterministicVisitReply = directVisitSchedulingDecision.reply;
      await mergeConversationCommercialFlowState(conversationId, directVisitSchedulingDecision.nextState);
      flowStateParsed = directVisitSchedulingDecision.nextState;

      if (directVisitSchedulingDecision.appointmentConfirmed) {
        if (ent) {
          try {
            const convForApptRegister = await getConversationById(conversationId);
            await registerAnaAppointmentIfConfirmed({
              conversationId,
              customerName: (convForApptRegister?.customer_name || trustedCustomerName || '').trim(),
              customerPhone: (convForApptRegister?.contact_phone || convForApptRegister?.external_contact_id || '').replace(/\D/g, ''),
              enterpriseId: ent.id,
              city: '',
              appointmentConfirmed: true,
              appointmentDateYmd: directVisitSchedulingDecision.appointmentDateYmd,
              appointmentTimeHm: directVisitSchedulingDecision.appointmentTimeHm,
              notes: 'Agendamento confirmado no fluxo deterministico da Ana.',
              brokerId: convForApptRegister?.assigned_broker_id ?? null,
              userUtteranceText: fullUserUtterances.trim() || trimmed,
              referenceNow: lastUserMessageAt,
            });
          } catch (e) {
            console.error('[ANA_DIRECT_VISIT_SCHEDULING] appointment_register_error', {
              conversationId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
        } else {
          deterministicVisitReply =
            'Perfeito, ja tenho dia e horario. Me confirma qual empreendimento voce quer visitar?';
          await mergeConversationCommercialFlowState(conversationId, {
            ...directVisitSchedulingDecision.nextState,
            pendingVisitScheduling: true,
            pendingVisitDateLabel: directVisitSchedulingDecision.extractedDateLabel,
            pendingVisitDate: directVisitSchedulingDecision.extractedDateYmd,
            pendingVisitEnterpriseId: null,
            updatedAt: new Date().toISOString(),
          });
        }
      }

      const recentAssistantRepliesForVisitLoop = [...rows]
        .filter((m) => m.role === 'assistant')
        .map((m) => (m.content || '').trim())
        .filter((content) => content.length > 0)
        .slice(-2);
      const repeatedVisitLoopReply = recentAssistantRepliesForVisitLoop.some(
        (prev) =>
          prev === deterministicVisitReply.trim() ||
          repliesSemanticallySimilar(prev, deterministicVisitReply) ||
          (isVisitSchedulingLoopFallbackReply(prev) && isVisitSchedulingLoopFallbackReply(deterministicVisitReply))
      );
      if (userRefusedScheduling || repeatedVisitLoopReply) {
        const schedulingAlreadyScheduled =
          directVisitSchedulingDecision.nextState.visitScheduling?.status === 'scheduled' ||
          flowStateParsed.visitScheduling?.status === 'scheduled';
        console.warn('[ANA_REPEATED_RESPONSE_BLOCKED]', {
          conversationId,
          reason: userRefusedScheduling ? 'user_refused_scheduling' : 'repeated_visit_scheduling_reply',
          reply: deterministicVisitReply,
        });
        if (userRefusedScheduling) {
          deterministicVisitReply = userIrritatedNow
            ? 'Desculpa, você tem razão. Sem agendar visita agora. Vou te passar os detalhes por aqui.'
            : 'Claro, sem problema. Te passo os detalhes por aqui.';
        } else if (schedulingAlreadyScheduled) {
          deterministicVisitReply = 'Perfeito. Visita agendada. Se quiser, também posso te ajudar com valores, pagamento ou localização.';
        }
      }

      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_direct_visit_send';
        anaTurnDiagnostics.finalResponse.replySource = 'deterministic_visit_scheduling';
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        return;
      }
      const sendVisitResult = await sendTextMessage({
        conversationId,
        to: toPhoneNumber,
        text: deterministicVisitReply,
        phase: 'deterministic_visit_scheduling',
      });
      if (!sendVisitResult.success || !sendVisitResult.metaMessageId) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'direct_visit_scheduling_send_failed';
        anaTurnDiagnostics.finalResponse.replySource = 'deterministic_visit_scheduling';
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
          replySource: 'deterministic_visit_scheduling',
          outboundStatus: anaTurnAuditOutcome,
          blockedReason: anaTurnAuditBlockedReason,
        });
        return;
      }
      await insertMessage(conversationId, 'assistant', deterministicVisitReply, sendVisitResult.metaMessageId);
      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnDiagnostics.finalResponse.replySource = 'deterministic_visit_scheduling';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
        replySource: 'deterministic_visit_scheduling',
        outboundStatus: anaTurnAuditOutcome,
        reason: directVisitSchedulingDecision.reason,
      });
      console.log('[ANA_DIRECT_VISIT_SCHEDULING_SENT]', {
        conversationId,
        contactId: effectiveConv.contact_id ?? null,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        reason: directVisitSchedulingDecision.reason,
        outboundMetaMessageId: sendVisitResult.metaMessageId,
      });
      return;
    }

    if (anaDecision.shouldCreateInfoGapFlag) {
      const infoGapTicket = {
        conversation_id: conversationId,
        enterprise_id: ent?.id ?? null,
        user_message: trimmed,
        requested_topic: anaDecision.missingInformationSubject ?? 'nao_classificado',
        reason: 'missing_confirmed_evidence',
        status: 'open',
        created_at: new Date().toISOString(),
        resolved_at: null,
        assigned_to: null,
      };
      anaTurnAuditGuardsApplied.infoGapTicket = infoGapTicket;
      console.log('[ANA_INFO_GAP_FLAG]', {
        conversationId,
        auditId: turnAudit.id,
        enterpriseId: ent?.id ?? null,
        enterpriseName: ent?.name ?? null,
        messageId: lastUserRowForLog?.id ?? null,
        missingInformationSubject: anaDecision.missingInformationSubject ?? null,
        userMessagePreview: trimmed.slice(0, 200),
        infoGapTicket,
      });
    }
    if (!anaDecision.canRespond || !anaDecision.outboundAllowed) {
      anaTurnAuditOutcome = 'blocked';
      anaTurnAuditBlockedReason = anaDecision.blockedReason ?? 'policy_outbound_blocked';
      anaTurnAuditGuardsApplied.outboundReason = anaTurnAuditBlockedReason;
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
        replySource: 'policy_blocked',
        outboundStatus: anaTurnAuditOutcome,
        blockedReason: anaTurnAuditBlockedReason,
      });
      return;
    }

    const deterministicOperationalSubtype = isEvoraEnterpriseName(ent?.name ?? null)
      ? detectAnaDeterministicOperationalSubtype(trimmed)
      : null;
    const deterministicAllowsBypassAppointment =
      deterministicOperationalSubtype === 'investimento_valorizacao';
    if (
      deterministicOperationalSubtype &&
      anaDecision.canRespond &&
      anaDecision.outboundAllowed &&
      (!appointmentPreflight.active || deterministicAllowsBypassAppointment)
    ) {
      const deterministicMessages = buildAnaDeterministicOperationalMessages(deterministicOperationalSubtype);
      console.log('[ANA_DETERMINISTIC_OPERATIONAL_START]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        enterpriseName: ent?.name ?? null,
        userMessagePreview: trimmed.slice(0, 180),
        subtype: deterministicOperationalSubtype,
        messagesCount: deterministicMessages.length,
      });

      let lastDeterministicMetaMessageId: string | null = null;
      for (const [index, deterministicMessage] of deterministicMessages.entries()) {
        if (index > 0) await sleepMs(900);
        const sendResult = await sendTextMessage({
          conversationId,
          to: toPhoneNumber,
          text: deterministicMessage,
          phase: 'deterministic_operational',
        });
        if (!sendResult.success || !sendResult.metaMessageId) {
          anaTurnAuditOutcome = 'send_failed';
          anaTurnAuditBlockedReason = 'deterministic_operational_send_failed';
          anaTurnDiagnostics.finalResponse.replySource = 'deterministic_fallback';
          anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
          console.error('[ANA_DETERMINISTIC_OPERATIONAL_SEND_FAILED]', {
            conversationId,
            subtype: deterministicOperationalSubtype,
            failedMessageIndex: index + 1,
            result: sendResult,
          });
          return;
        }
        lastDeterministicMetaMessageId = sendResult.metaMessageId;
        await insertMessage(conversationId, 'assistant', deterministicMessage, sendResult.metaMessageId);
      }

      await applyAnaConversationUpdate(conversationId, {
        classification: 'Qualificado',
        lead_temperature: maxLeadTemperature(effectiveConv.lead_temperature, 'quente'),
        handoff: false,
      });

      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'deterministic_operational';
      anaTurnDiagnostics.finalResponse.replySource = 'deterministic_fallback';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'llm_generation', 'skipped', {
        reason: `deterministic_operational_${deterministicOperationalSubtype}`,
      });
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
        replySource: 'deterministic_fallback',
        outboundStatus: anaTurnAuditOutcome,
        subtype: deterministicOperationalSubtype,
      });
      console.log('[ANA_DETERMINISTIC_OPERATIONAL_SENT]', {
        conversationId,
        subtype: deterministicOperationalSubtype,
        outboundMetaMessageId: lastDeterministicMetaMessageId,
      });
      return;
    }

    const commercialRule = resolveAnaCommercialRule({
      enterpriseName: ent?.name ?? null,
      userMessage: trimmed,
      isFirstAnaReply,
      previousAssistantMessage: lastAssistantPlain,
    });
    const allowCommercialRuleDuringAppointment =
      Boolean(appointmentPreflight.active) && commercialRule?.ruleId !== 'visita_agendamento';
    if (
      commercialRule &&
      anaDecision.canRespond &&
      anaDecision.outboundAllowed &&
      (!appointmentPreflight.active || allowCommercialRuleDuringAppointment)
    ) {
      const isFirstContactRule = commercialRule.ruleId === 'first_contact';
      console.log(
        isFirstContactRule ? '[ANA_COMMERCIAL_RULE_FIRST_CONTACT_START]' : '[ANA_COMMERCIAL_RULE_INTENT_START]',
        {
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          enterpriseName: ent?.name ?? null,
          userMessagePreview: trimmed.slice(0, 180),
          ruleId: commercialRule.ruleId,
          messagesCount: commercialRule.messages.length,
        }
      );
      if (commercialRule.ruleId === 'disponibilidade_simulacao_desconto') {
        console.log('[ANA_COMMERCIAL_RULE_LOT_DETAILS]', {
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          userMessagePreview: trimmed.slice(0, 220),
        });
      }
      if (commercialRule.ruleId === 'formas_pagamento') {
        console.log('[ANA_COMMERCIAL_RULE_PAYMENT_PLANS]', {
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          userMessagePreview: trimmed.slice(0, 220),
        });
      }
      if (commercialRule.inheritedIntent === 'payment_terms') {
        console.log('[ANA_PAYMENT_INTENT_CONTEXT_GUARD]', {
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          previousAssistantMessage: (lastAssistantPlain ?? '').slice(0, 240),
          customerMessage: trimmed.slice(0, 240),
          inheritedIntent: commercialRule.inheritedIntent,
          finalAnswer: commercialRule.messages.join('\n'),
        });
      }

      const commercialRuleVisitOfferDecision =
        commercialRule.ruleId === 'visita_agendamento' ||
        commercialRule.ruleId === 'localizacao_endereco' ||
        commercialRule.ruleId === 'preco_valor_lote' ||
        commercialRule.ruleId === 'valor_condominio' ||
        commercialRule.ruleId === 'entrega_empreendimento' ||
        commercialRule.ruleId === 'formas_pagamento' ||
        commercialRule.ruleId === 'materiais'
          ? {
              appendedVisitOfferMessages: [] as string[],
              appendedVisitOffer: false,
              commercialAnsweredQuestionsCount: 0,
            }
          : applyAnaVisitOfferGuard({
              conversationId,
              enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
              enterpriseName: ent?.name ?? null,
              userMessage: trimmed,
              answer: commercialRule.messages.join('\n'),
              rowsBeforeSend: rows,
              isSchedulingFlow: appointmentPreflight.active || flowStateParsed.pendingVisitScheduling === true,
              isHandoff: Boolean(effectiveConv.handoff || effectiveConv.classification === 'Handoff'),
              isMaterialOnlyFlow: false,
            });
      const visitOfferMessagesFromCommercialRule =
        commercialRuleVisitOfferDecision.appendedVisitOfferMessages ?? [];

      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_commercial_rule_send';
        anaTurnDiagnostics.finalResponse.replySource = commercialRule.replySource;
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
          replySource: commercialRule.replySource,
          outboundStatus: anaTurnAuditOutcome,
          blockedReason: anaTurnAuditBlockedReason,
        });
        return;
      }

      const knownNameFromConversation = toFirstName(effectiveConv.customer_name || null);
      const knownNameFromWhatsApp = toFirstName(effectiveConv.whatsapp_display_name || null);
      const knownNameFromContact =
        toFirstName(linkedContact?.first_name || null) || toFirstName(linkedContact?.full_name || null);
      const knownNameFromCurrentTurn = toFirstName(trustedCustomerName || null);
      const hasKnownCustomerName = Boolean(
        knownNameFromConversation || knownNameFromWhatsApp || knownNameFromContact || knownNameFromCurrentTurn
      );

      const recentAssistantForCtaPolicy = [...rows]
        .filter((m) => m.role === 'assistant')
        .map((m) => (m.content || '').trim())
        .filter((msg) => msg.length > 0)
        .slice(-8);
      const hasRecentVisitCta = hasRecentExplicitVisitCta(recentAssistantForCtaPolicy);

      const commercialMessagesToSend = [...commercialRule.messages];
      if (commercialRule.ruleId === 'entrada') {
        const answer = commercialRule.messages[0] ?? '';
        const defaultCta =
          'O corretor consegue simular certinho com as opções disponíveis. Quer que eu te ajude a agendar uma visita?';
        const alternateCta = 'Quer que eu te explique as opções de parcelamento?';
        const cta = hasRecentVisitCta ? alternateCta : defaultCta;
        commercialMessagesToSend.length = 0;
        commercialMessagesToSend.push(answer);
        if (!hasKnownCustomerName) commercialMessagesToSend.push('Qual é o seu nome? Assim eu consigo te atender melhor por aqui.');
        commercialMessagesToSend.push(cta);
      } else if (commercialRule.ruleId === 'formas_pagamento') {
        const answer = commercialRule.messages[0] ?? '';
        const cta = 'Para uma simulação certinha, o corretor consegue montar a melhor opção conforme o lote que você gostar.';
        const normalizedPaymentUserMessage = normText(trimmed);
        const isEntradaQuestion = /\b(tem entrada|valor de entrada|qual valor de entrada|precisa dar entrada|entrada minima|entrada facilitada|entrada e facilitada|quanto .* entrada|qual a entrada|dar entrada)\b/.test(
          normalizedPaymentUserMessage
        );
        commercialMessagesToSend.length = 0;
        if (isEntradaQuestion) {
          commercialMessagesToSend.push(
            'Tem sim, mas o valor de entrada pode variar conforme o lote e o plano escolhido.'
          );
          commercialMessagesToSend.push(
            'O Évora tem opções com planos estendidos em até 120x, parcelamento sem juros em até 48x e financiamento direto com a construtora.'
          );
          commercialMessagesToSend.push(
            'Para te passar uma condição certinha, o corretor consegue montar uma simulação conforme o lote que você gostar.'
          );
        } else {
          commercialMessagesToSend.push(answer);
          if (!hasKnownCustomerName) commercialMessagesToSend.push(ANA_COMMERCIAL_RULES.askNameMessage);
          commercialMessagesToSend.push(cta);
        }
      }
      if (commercialRule.ruleId === 'entrega_empreendimento') {
        const operational = resolveOperationalFactAnswer(trimmed, knowledgeText, vars, {
          enterpriseName: ent?.name ?? null,
          hintedTopic: 'entrega_prazo',
        });
        const fallbackEntrega =
          'Ainda não tenho a previsão exata liberada por aqui. O corretor confirma certinho pra você.';
        let resolvedEntrega = operational?.dataFound ? operational.answer : fallbackEntrega;
        if (isWeakEntregaAnswer(resolvedEntrega)) resolvedEntrega = fallbackEntrega;
        commercialMessagesToSend.length = 0;
        commercialMessagesToSend.push(resolvedEntrega.replace(/\[DATA\/PRAZO DA BASE\]/gi, '').replace(/\s{2,}/g, ' ').trim());
        commercialMessagesToSend.push('Quer saber também como está a infraestrutura prevista?');
      }
      if (commercialRule.ruleId === 'localizacao_endereco') {
        const answer = commercialRule.messages[0] ?? '';
        commercialMessagesToSend.length = 0;
        commercialMessagesToSend.push(answer);
        commercialMessagesToSend.push('Você vem de São Paulo ou de Atibaia?');
      }

      const shouldAskNameAfterCommercialReply =
        !hasKnownCustomerName &&
        commercialRule.ruleId !== 'visita_agendamento' &&
        commercialRule.ruleId !== 'entrada' &&
        commercialRule.ruleId !== 'formas_pagamento';
      if (shouldAskNameAfterCommercialReply) {
        commercialMessagesToSend.push(ANA_COMMERCIAL_RULES.askNameMessage);
      }

      let lastCommercialRuleMetaMessageId: string | null = null;
      const recentAssistantForNoRepeat = [...rows]
        .filter((m) => m.role === 'assistant')
        .map((m) => (m.content || '').trim())
        .filter((msg) => msg.length > 0)
        .slice(-8);
      for (const [index, commercialRuleMessageRaw] of commercialMessagesToSend.entries()) {
        if (index > 0) await sleepMs(900);
        if (isPipelineStale(conversationId, replyPipelineToken)) {
          anaTurnAuditOutcome = 'silent';
          anaTurnAuditBlockedReason = `pipeline_stale_before_commercial_rule_message_${index + 1}`;
          anaTurnDiagnostics.finalResponse.replySource = commercialRule.replySource;
          anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
          return;
        }
        let commercialRuleMessage = commercialRuleMessageRaw;
        const aggressiveBlockCommercial = blockLegacyAggressiveVisitCtaByIntent({
          text: commercialRuleMessage,
          intent: commercialRule.ruleId,
          hasRecentVisitCta,
        });
        if (aggressiveBlockCommercial.changed) {
          commercialRuleMessage = aggressiveBlockCommercial.text;
        }
        const noRepeatForCommercialRule = applyAnaNoRepeatMessageGuard({
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          enterpriseName: ent?.name ?? null,
          userMessage: trimmed,
          answer: commercialRuleMessage,
          recentAssistantReplies: recentAssistantForNoRepeat,
          semanticallySimilar: repliesSemanticallySimilar,
        });
        if (noRepeatForCommercialRule.changed) {
          commercialRuleMessage = noRepeatForCommercialRule.text;
        }
        const sendResult = await sendTextMessage({
          conversationId,
          to: toPhoneNumber,
          text: commercialRuleMessage,
          phase: 'commercial_rules',
        });
        if (!sendResult.success || !sendResult.metaMessageId) {
          anaTurnAuditOutcome = 'send_failed';
          anaTurnAuditBlockedReason = 'commercial_rule_send_failed';
          anaTurnDiagnostics.finalResponse.replySource = commercialRule.replySource;
          anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
          markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
            replySource: commercialRule.replySource,
            outboundStatus: anaTurnAuditOutcome,
            blockedReason: `${anaTurnAuditBlockedReason}_index_${index + 1}`,
          });
          console.error('[ANA_COMMERCIAL_RULE_SEND_FAILED]', {
            conversationId,
            failedMessageIndex: index + 1,
            ruleId: commercialRule.ruleId,
            result: sendResult,
          });
          return;
        }

        lastCommercialRuleMetaMessageId = sendResult.metaMessageId;
        await insertMessage(conversationId, 'assistant', commercialRuleMessage, sendResult.metaMessageId);
        recentAssistantForNoRepeat.push(commercialRuleMessage);
        console.log('[ANA_COMMERCIAL_RULE_MESSAGE_SENT]', {
          conversationId,
          ruleId: commercialRule.ruleId,
          messageIndex: index + 1,
          messagesCount: commercialMessagesToSend.length,
          outboundMetaMessageId: sendResult.metaMessageId,
        });
      }

      for (const [visitIndex, visitOfferMessage] of visitOfferMessagesFromCommercialRule.entries()) {
        let safeVisitOfferMessage = visitOfferMessage;
        const aggressiveBlockVisitOffer = blockLegacyAggressiveVisitCtaByIntent({
          text: safeVisitOfferMessage,
          intent: commercialRule.ruleId,
          hasRecentVisitCta: true,
        });
        if (aggressiveBlockVisitOffer.changed) safeVisitOfferMessage = aggressiveBlockVisitOffer.text;
        const noRepeatVisitOffer = applyAnaNoRepeatMessageGuard({
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          enterpriseName: ent?.name ?? null,
          userMessage: trimmed,
          answer: safeVisitOfferMessage,
          recentAssistantReplies: recentAssistantForNoRepeat,
          semanticallySimilar: repliesSemanticallySimilar,
        });
        if (noRepeatVisitOffer.changed) safeVisitOfferMessage = noRepeatVisitOffer.text;
        await sleepMs(900);
        if (isPipelineStale(conversationId, replyPipelineToken)) {
          anaTurnAuditOutcome = 'silent';
          anaTurnAuditBlockedReason = `pipeline_stale_before_visit_offer_message_${visitIndex + 1}`;
          anaTurnDiagnostics.finalResponse.replySource = commercialRule.replySource;
          anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
          return;
        }
        const visitSendResult = await sendTextMessage({
          conversationId,
          to: toPhoneNumber,
          text: safeVisitOfferMessage,
          phase: 'commercial_rules_visit_offer',
        });
        if (!visitSendResult.success || !visitSendResult.metaMessageId) {
          anaTurnAuditOutcome = 'send_failed';
          anaTurnAuditBlockedReason = 'commercial_rule_visit_offer_send_failed';
          anaTurnDiagnostics.finalResponse.replySource = commercialRule.replySource;
          anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
          markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
            replySource: commercialRule.replySource,
            outboundStatus: anaTurnAuditOutcome,
            blockedReason: `${anaTurnAuditBlockedReason}_index_${visitIndex + 1}`,
          });
          console.error('[ANA_COMMERCIAL_RULE_VISIT_OFFER_SEND_FAILED]', {
            conversationId,
            failedMessageIndex: visitIndex + 1,
            result: visitSendResult,
          });
          return;
        }
        lastCommercialRuleMetaMessageId = visitSendResult.metaMessageId;
        await insertMessage(conversationId, 'assistant', safeVisitOfferMessage, visitSendResult.metaMessageId);
        recentAssistantForNoRepeat.push(safeVisitOfferMessage);
        console.log('[ANA_COMMERCIAL_RULE_VISIT_OFFER_MESSAGE_SENT]', {
          conversationId,
          messageIndex: visitIndex + 1,
          messagesCount: visitOfferMessagesFromCommercialRule.length,
          outboundMetaMessageId: visitSendResult.metaMessageId,
        });
      }

      await applyAnaConversationUpdate(conversationId, {
        classification: 'Qualificado',
        lead_temperature: maxLeadTemperature(effectiveConv.lead_temperature, 'quente'),
        handoff: false,
      });

      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'commercial_rules';
      anaTurnAuditGuardsApplied.outboundReason = `commercial_rule_${commercialRule.ruleId}`;
      anaTurnDiagnostics.finalResponse.replySource = commercialRule.replySource;
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'llm_generation', 'skipped', {
        reason: `commercial_rule_${commercialRule.ruleId}`,
      });
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
        replySource: commercialRule.replySource,
        outboundStatus: anaTurnAuditOutcome,
        messagesCount: commercialRule.messages.length + visitOfferMessagesFromCommercialRule.length,
      });
      console.log(
        isFirstContactRule ? '[ANA_COMMERCIAL_RULE_FIRST_CONTACT_SENT]' : '[ANA_COMMERCIAL_RULE_INTENT_SENT]',
        {
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          ruleId: commercialRule.ruleId,
          messagesCount: commercialRule.messages.length,
          outboundMetaMessageId: lastCommercialRuleMetaMessageId,
        }
      );
      return;
    }

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
      userText: userMessageForReasoning.slice(0, 400),
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
      probableCustomerName:
        !(effectiveConv.customer_name || '').trim() ? effectiveConv.whatsapp_display_name ?? null : null,
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
      validatedEvidenceBlock,
    };

    const enterpriseResolvedForModel =
      effectiveConv.enterprise_id != null ||
      enterpriseResolution.enterpriseId != null ||
      linkedContact?.enterprise_id != null ||
      effectiveConv.enterprise_origin_id != null;
    const configuredModelFromDb = (resolvedAiSettings?.modelHotLead || '').trim() || null;
    const modelResolution = resolveAnaOpenAIModel({
      configuredModelFromDb,
      slot: 'hot_lead',
    });
    if (modelResolution.blocked) {
      anaTurnAuditOutcome = 'blocked';
      anaTurnAuditBlockedReason = modelResolution.reason;
      anaTurnAuditLlmStatus = 'blocked';
      anaTurnAuditErrorCode = modelResolution.reason;
      anaTurnAuditErrorMessage = 'Modelo operacional da Ana não está configurado corretamente.';
      anaTurnDiagnostics.llm.finalFailureReason = modelResolution.reason;
      anaTurnDiagnostics.finalResponse.replySource = null;
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'llm_generation', 'failed', {
        blockedReason: modelResolution.reason,
        configuredValue: modelResolution.configuredModelFromDb,
        slot: modelResolution.slot,
      });
      console.log('[ANA_MODEL_RESOLUTION_BLOCKED]', {
        conversationId,
        reason: modelResolution.reason,
        configuredValue: modelResolution.configuredModelFromDb,
        slot: modelResolution.slot,
      });
      return;
    }
    const model = modelResolution.finalModel;
    anaTurnAuditModel = model;

    console.log('[ANA_MODEL_RESOLUTION]', {
      conversationId,
      selectedModel: model,
      source: 'db',
      slot: modelResolution.slot,
      reason: modelResolution.selectionReason,
    });

    console.log('[ANA_CHAT_AUDIT]', {
      conversationId,
      messageId: inboundMetaMessageId,
      userText: userMessageForReasoning.slice(0, 500),
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
    anaTurnDiagnostics.model = model;
    anaTurnDiagnostics.llm.model = model;
    anaTurnDiagnostics.rag.includedInPrompt = knowledgeText.trim().length > 0;
    markAnaTurnStage(anaTurnDiagnostics, 'prompt_build', 'passed', {
      mode,
      model,
      modelSelectionReason: 'db_config',
      enterpriseResolvedForModel,
      knowledgeTextLength: knowledgeText.length,
      knowledgeIncludedInPrompt: anaTurnDiagnostics.rag.includedInPrompt,
      messagesPlanned: history.length + 2,
    });

    console.log('[ANA_HISTORY_LOAD]', {
      conversationId,
      userText: userMessageForReasoning.slice(0, 500),
      historyCount,
      stage: flowStateParsed.stage ?? conversationPhase,
      productTypeHint: flowStateParsed.productTypeHint ?? null,
      lastCatalogOfferedNames: flowStateParsed.lastCatalogOfferedNames ?? null,
      clearedAt: flowStateParsed.clearedAt ?? null,
    });
    // [ANA_HISTORY_WINDOW] rastreabilidade de quanto contexto chega ao modelo
    console.log('[ANA_HISTORY_WINDOW]', {
      conversationId,
      totalDbRows: rows.length,
      historyPassedToModel: historyCount,
      maxHistory: MAX_HISTORY,
      isGreeting: isBareGreetingOnly(trimmed),
    });

    const policyRuntimeDirectives = [
      `POLICY_DECISION_MODE: ${anaDecision.responseMode}`,
      anaDecision.responseMode === 'structured'
        ? requestedAxisForPolicy === 'lazer'
          ? 'No eixo de lazer, liste todos os itens encontrados na fonte confiavel, sem limitar quantidade, sem truncar, sem resumir e sem usar "entre outros". Mantenha bullets e quebras de linha.'
          : 'Responda em formato estruturado quando fizer sentido (linhas curtas/lista objetiva), entre 5 e 7 itens e sem misturar varios temas.'
        : 'Responda de forma curta e objetiva, com no maximo 3 linhas e no maximo 1 pergunta.',
      anaDecision.shouldSuggestVisit
        ? 'O cliente demonstrou interesse comercial direto ou oportunidade clara de avanço. Nao responda apenas com localizacao ou uma frase vaga como "Que mais?". Responda com acolhimento curto, no maximo UMA informacao forte do empreendimento e conduza com UMA pergunta util: perfil de busca (morar/investir/construir) ou convite leve para visita quando fizer sentido. Se falar de visita, use tom humano: "O corretor pode te passar tudo certinho. Que tal marcarmos uma visita?".'
        : null,
      !anaDecision.canMentionExactLocation
        ? 'Nao passe endereco/localizacao exata como se estivesse confirmado.'
        : null,
      !anaDecision.canMentionPaymentSimulation
        ? 'Nao simule pagamento, entrada, parcela, prazo, juros ou desconto.'
        : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');
    const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }];
    if (policyRuntimeDirectives) {
      messages.push({ role: 'system', content: policyRuntimeDirectives });
    }
    for (const h of history) {
      messages.push({ role: h.role, content: h.content });
    }
    messages.push({ role: 'user', content: userMessageForReasoning });

    anaEngineTrace('prompt_build_done', {
      conversationId,
      systemPromptLen: systemPrompt.length,
      messagesCount: messages.length,
    });

    console.log('[ANA MODEL] modelo_final_selecionado', {
      conversationId,
      model,
      model_used: model,
      sourceOfFinalModel: 'db',
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
    const baseAnaCostTracking = {
      conversationId,
      contactId: effectiveConv.contact_id ?? null,
      enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? enterpriseResolution.enterpriseId ?? null,
      inboundMessageId: lastUserRowForLog?.id ?? null,
      modelReason: 'db_config',
      apiKeySource: aiSettings.apiKeySource,
      openaiApiKeyId: aiSettings.openaiApiKeyId,
      openaiProjectId: aiSettings.openaiProjectId,
      requestType: 'ana_main_reply',
    };
    const result = await generateChatCompletion({
      apiKey: aiApiKey,
      baseUrl: aiSettings.openaiBaseUrl,
      model,
      messages,
      temperature: Math.min(aiSettings.temperature, 0.75),
      maxTokens: Math.max(aiSettings.maxTokens, 800),
      responseFormatJson: true,
      costTracking: aiSettings.costTrackingEnabled ? {
        ...baseAnaCostTracking,
        purpose: 'ana_main_reply',
        metadata: {
          responseFormatJson: true,
          attempt: 1,
          strategy: 'primary_json',
        },
      } : undefined,
    });
    captureLlmAudit(result, 'ana_main_reply');
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
    anaTurnDiagnostics.llm.httpStatus = result.httpStatus ?? null;
    anaTurnDiagnostics.llm.provider = result.provider ?? anaTurnDiagnostics.provider;
    anaTurnDiagnostics.llm.model = model;
    anaTurnDiagnostics.llm.providerErrorCode = result.errorCode ?? null;
    anaTurnDiagnostics.llm.providerErrorType = result.errorType ?? null;
    anaTurnDiagnostics.llm.sanitizedMessage = result.success ? null : result.error ?? null;
    anaTurnDiagnostics.classifiedError = result.classifiedError ?? null;
    anaTurnDiagnostics.llm.canGenerate = result.success;
    markAnaTurnStage(
      anaTurnDiagnostics,
      'llm_generation',
      result.success ? 'passed' : 'failed',
      {
        provider: anaTurnDiagnostics.llm.provider,
        model,
        httpStatus: result.httpStatus ?? null,
        classifiedError: result.classifiedError ?? null,
      }
    );

    const openAiCalled = true;
    let replySource:
      | 'openai'
      | 'technical_fallback'
      | 'policy_missing_information'
      | 'policy_material_unavailable'
      | 'rag_empty_fallback_retry' = 'openai';
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
    let retryAttempted = false;
    let retryResult: GenerateCompletionResult | null = null;
    let regenResult: GenerateCompletionResult | null = null;
    const generationResults: GenerateCompletionResult[] = [result];
    anaTurnDiagnostics.llm.maxAttempts = MAX_ANA_GENERATION_ATTEMPTS;
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
    recordAnaGenerationAttempt({
      diagnostics: anaTurnDiagnostics,
      attempt: 1,
      strategy: 'primary_json',
      result,
      parsed: structured != null,
      failureReason: structured != null ? null : computeAnaTechnicalFallbackTraceReason(result, parseAttempted),
      model,
    });
    if (!structured) {
      const retryContextBlock = [
        `Mensagem original do cliente: "${trimmed.slice(0, 260)}"`,
        `Mensagem expandida para contexto: "${userMessageForReasoning.slice(0, 260)}"`,
        `Empreendimento ativo: ${effectiveConv.enterprise_id ?? 'null'}${ent ? ` (${ent.name})` : ''}`,
        `Estado de visita ativo: ${appointmentPreflight.active ? 'sim' : 'não'}`,
        `Aguardando nome: ${
          !(effectiveConv.customer_name || '').trim() && effectiveConv.ana_asked_customer_name === true ? 'sim' : 'não'
        }`,
        `Ultima mensagem da Ana: "${(lastAssistantPlain || "").slice(0, 260)}"`,
      ].join('\n');
      const retryMessages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        {
          role: 'system',
          content:
            `RETRY ESTRUTURADO: gere obrigatoriamente um JSON válido e útil para continuidade.\n` +
            `Use o contexto abaixo para resolver follow-up curto/contextual sem fallback genérico.\n${retryContextBlock}`,
        },
      ];
      for (const h of history) retryMessages.push({ role: h.role, content: h.content });
      retryMessages.push({ role: 'user', content: userMessageForReasoning });

      retryAttempted = true;
      console.log('[ANA_RETRY]', {
        conversationId,
        attempt: 2,
        reason: 'structured_null_after_first_attempt',
        context: {
          enterpriseId: effectiveConv.enterprise_id ?? null,
          enterpriseName: ent?.name ?? null,
          appointmentActive: appointmentPreflight.active,
          awaitingName: !(effectiveConv.customer_name || '').trim() && effectiveConv.ana_asked_customer_name === true,
        },
      });
      retryResult = await generateChatCompletion({
        apiKey: aiApiKey,
        baseUrl: aiSettings.openaiBaseUrl,
        model,
        messages: retryMessages,
        temperature: Math.min(aiSettings.temperature, 0.65),
        maxTokens: Math.max(aiSettings.maxTokens, 800),
        responseFormatJson: true,
        costTracking: aiSettings.costTrackingEnabled ? {
          ...baseAnaCostTracking,
          purpose: 'ana_structured_retry',
          requestType: 'ana_structured_retry',
          metadata: {
            responseFormatJson: true,
            attempt: 2,
            strategy: 'same_context_retry',
          },
        } : undefined,
      });
      captureLlmAudit(retryResult, 'ana_structured_retry');
      generationResults.push(retryResult);
      const retryRaw = (retryResult.content || '').trim();
      if (retryResult.success && retryRaw) {
        structured = parseAnaJson(retryResult.content || '', {
          conversationId,
          messageId: inboundMetaMessageId,
        });
      }
      console.log('[ANA_RETRY]', {
        conversationId,
        attempt: 2,
        success: retryResult.success,
        parsed: structured != null,
        httpStatus: retryResult.httpStatus ?? null,
        error: retryResult.error ?? null,
        rawLen: (retryResult.content || '').length,
      });
      recordAnaGenerationAttempt({
        diagnostics: anaTurnDiagnostics,
        attempt: 2,
        strategy: 'same_context_retry',
        result: retryResult,
        parsed: structured != null,
        failureReason:
          structured != null
            ? null
            : computeAnaTechnicalFallbackTraceReason(retryResult, retryResult.success && retryRaw.length > 0),
        model,
      });
    }
    if (!structured) {
      const recoveryRaw =
        (retryResult?.success && (retryResult.content || '').trim()
          ? (retryResult.content || '')
          : rawContent) || '';
      const recoveredReply = extractRecoveredReplyFromMalformedJsonLikeRaw(recoveryRaw);
      if (recoveredReply) {
        const quality = validateRecoveredReplyQuality(recoveredReply);
        if (quality.ok) {
          structured = buildRecoveredReplyStructured(recoveredReply, effectiveConv.classification);
          console.log('[ANA_RECOVERED_REPLY_ACCEPTED]', {
            conversationId,
            source: retryResult?.success ? 'retry_raw' : 'first_raw',
            replyLen: recoveredReply.length,
          });
        } else {
          console.log('[ANA_RECOVERED_REPLY_REJECTED]', {
            conversationId,
            source: retryResult?.success ? 'retry_raw' : 'first_raw',
            reason: quality.reason,
            preview: recoveredReply.slice(0, 180),
          });
        }
      }
    }
    if (!structured) {
      const regenMessages: ChatMessage[] = [
        {
          role: 'system',
          content:
            'CORRECAO CURTA: gere uma resposta valida para WhatsApp em texto puro. ' +
            'Nao use fallback generico, nao cite erro tecnico, nao invente dados comerciais. ' +
            'Seja contextual, comercial e objetiva. No maximo 3 linhas e no maximo 1 pergunta.',
        },
        {
          role: 'user',
          content: [
            `Mensagem do cliente: "${trimmed.slice(0, 260)}"`,
            `Mensagem contextual expandida: "${userMessageForReasoning.slice(0, 260)}"`,
            `Empreendimento atual: ${ent?.name ?? 'nao definido'}`,
            `Fase: ${conversationPhase}`,
            'Responda agora em texto puro, direto ao cliente.',
          ].join('\n'),
        },
      ];
      regenResult = await generateChatCompletion({
        apiKey: aiApiKey,
        baseUrl: aiSettings.openaiBaseUrl,
        model,
        messages: regenMessages,
        temperature: Math.min(aiSettings.temperature, 0.55),
        maxTokens: 140,
        responseFormatJson: false,
        costTracking: aiSettings.costTrackingEnabled ? {
          ...baseAnaCostTracking,
          purpose: 'ana_regen',
          requestType: 'ana_regen',
          metadata: {
            responseFormatJson: false,
            attempt: 3,
            strategy: 'json_repair',
          },
        } : undefined,
      });
      captureLlmAudit(regenResult, 'ana_regen');
      generationResults.push(regenResult);
      const regenRaw = (regenResult.content || '').trim();
      const regenQuality = validateRecoveredReplyQuality(regenRaw);
      console.log('[ANA_REGEN_SHORT_REPLY]', {
        conversationId,
        success: regenResult.success,
        hasText: regenRaw.length > 0,
        qualityOk: regenQuality.ok,
        qualityReason: regenQuality.reason,
      });
      if (regenResult.success && regenQuality.ok) {
        structured = buildRecoveredReplyStructured(regenRaw, effectiveConv.classification);
      }
      recordAnaGenerationAttempt({
        diagnostics: anaTurnDiagnostics,
        attempt: 3,
        strategy: 'json_repair',
        result: regenResult,
        parsed: structured != null,
        failureReason:
          structured != null
            ? null
            : computeAnaTechnicalFallbackTraceReason(regenResult, regenResult.success && regenRaw.length > 0),
        model,
      });
    }
    if (!structured) {
        const secondaryProvider = getConfiguredAnaSecondaryProvider(
          model,
          aiApiKey,
          aiSettings.openaiBaseUrl
        );
      if (secondaryProvider) {
        anaTurnDiagnostics.llm.providerFallbackAttempted = false;
        markAnaTurnStage(
          anaTurnDiagnostics,
          'provider_fallback',
          'passed',
          {
            fallbackConfigured: true,
            provider: secondaryProvider.provider,
            model: secondaryProvider.model,
          }
        );
        const secondaryMessages: ChatMessage[] = [
          ...messages.slice(0, -1),
          {
            role: 'system',
            content:
              'TENTATIVA SECUNDARIA: responda obrigatoriamente com JSON valido no schema da Ana. ' +
              'Nao use fallback generico nem mensagem de erro tecnico. Se faltar dado real, use apenas o padrao de informacao ausente.',
          },
          messages[messages.length - 1],
        ];
        const secondaryResult = await generateChatCompletion({
          apiKey: secondaryProvider.apiKey,
          baseUrl: secondaryProvider.baseUrl,
          model: secondaryProvider.model,
          messages: secondaryMessages,
          temperature: Math.min(aiSettings.temperature, 0.55),
          maxTokens: Math.max(aiSettings.maxTokens, 800),
          responseFormatJson: true,
          costTracking: aiSettings.costTrackingEnabled ? {
            ...baseAnaCostTracking,
            purpose: 'ana_provider_fallback',
            requestType: 'ana_provider_fallback',
            metadata: {
              responseFormatJson: true,
              attempt: 4,
              strategy: 'secondary_provider',
              primaryModel: model,
              secondaryProvider: secondaryProvider.provider,
            },
          } : undefined,
        });
        captureLlmAudit(secondaryResult, 'ana_provider_fallback');
        generationResults.push(secondaryResult);
        const secondaryRaw = (secondaryResult.content || '').trim();
        if (secondaryResult.success && secondaryRaw) {
          structured = parseAnaJson(secondaryResult.content || '', {
            conversationId,
            messageId: inboundMetaMessageId,
          });
        }
        console.log('[ANA_PROVIDER_FALLBACK]', {
          conversationId,
          attempt: 4,
          provider: secondaryProvider.provider,
          model: secondaryProvider.model,
          success: secondaryResult.success,
          parsed: structured != null,
          httpStatus: secondaryResult.httpStatus ?? null,
          error: secondaryResult.error ?? null,
        });
        recordAnaGenerationAttempt({
          diagnostics: anaTurnDiagnostics,
          attempt: 4,
          strategy: 'secondary_provider',
          result: secondaryResult,
          parsed: structured != null,
          failureReason:
            structured != null
              ? null
              : computeAnaTechnicalFallbackTraceReason(secondaryResult, secondaryResult.success && secondaryRaw.length > 0),
          model: secondaryProvider.model,
        });
      } else {
        anaTurnDiagnostics.llm.providerFallbackAttempted = false;
        markAnaTurnStage(
          anaTurnDiagnostics,
          'provider_fallback',
          'skipped',
          {
            fallbackConfigured: false,
            reason: 'provider_fallback_not_configured',
          }
        );
      }
    }
    if (!structured) {
      {
        const blockingLatestFailure = latestAnaGenerationFailureResult(generationResults);
        const blockingProviderFailure =
          blockingLatestFailure != null
            ? classifyLlmProviderError({
                provider: blockingLatestFailure.provider ?? anaTurnDiagnostics.provider,
                httpStatus: blockingLatestFailure.httpStatus ?? null,
                providerErrorCode: blockingLatestFailure.errorCode ?? null,
                providerErrorType: blockingLatestFailure.errorType ?? null,
                message: blockingLatestFailure.error ?? null,
              })
            : null;
        const blockingLastAttempt =
          anaTurnDiagnostics.llm.attempts[anaTurnDiagnostics.llm.attempts.length - 1] ?? null;
        const traceReason =
          (blockingLastAttempt?.failureReason as AnaFallbackTraceReason | null) ??
          computeAnaTechnicalFallbackTraceReason(result, parseAttempted);
        logAnaFallbackTrace({
          reason: traceReason,
          conversationId,
          result: blockingLatestFailure ?? regenResult ?? retryResult ?? result,
          parseAttempted: true,
        });
        fallbackReason = traceReason;
        anaTurnDiagnostics.fallbackReason = traceReason;
        anaTurnDiagnostics.classifiedError =
          blockingProviderFailure?.classifiedError ?? anaTurnDiagnostics.classifiedError ?? null;
        anaTurnDiagnostics.llm.httpStatus =
          blockingProviderFailure?.httpStatus ?? anaTurnDiagnostics.llm.httpStatus;
        anaTurnDiagnostics.llm.providerErrorCode =
          blockingProviderFailure?.providerErrorCode ?? anaTurnDiagnostics.llm.providerErrorCode;
        anaTurnDiagnostics.llm.providerErrorType =
          blockingProviderFailure?.providerErrorType ?? anaTurnDiagnostics.llm.providerErrorType;
        anaTurnDiagnostics.llm.sanitizedMessage =
          blockingProviderFailure?.sanitizedMessage ?? anaTurnDiagnostics.llm.sanitizedMessage;
        anaTurnDiagnostics.llm.canGenerate = false;
        anaTurnDiagnostics.llm.finalFailureReason = traceReason;
        anaTurnDiagnostics.llm.humanInterventionRequired = true;
        anaTurnDiagnostics.fallbackUsed = false;
        anaTurnDiagnostics.finalResponse.replySource = null;
        const isRateLimitBlock = anaTurnDiagnostics.classifiedError === 'OPENAI_RATE_LIMIT';
        const retryableFailure =
          blockingLatestFailure != null &&
          isRetryableLlmError({
            httpStatus: blockingLatestFailure.httpStatus ?? null,
            errorCode: blockingLatestFailure.errorCode ?? null,
            errorType: blockingLatestFailure.errorType ?? null,
            message: blockingLatestFailure.error ?? null,
          });
        if (retryableFailure) {
          const retryErrorPayload = {
            httpStatus: blockingLatestFailure?.httpStatus ?? null,
            errorCode: blockingLatestFailure?.errorCode ?? null,
            errorType: blockingLatestFailure?.errorType ?? null,
            message: blockingLatestFailure?.error ?? fallbackReason ?? 'retryable_llm_error',
          };
          const retryAfterMs = extractRetryAfterMs(retryErrorPayload);
          await scheduleAnaRetry({
            conversationId,
            triggerMessageId: lastUserRowForLog?.id ?? null,
            error: retryErrorPayload,
          });
          anaTurnAuditOutcome = 'silent';
          anaTurnAuditBlockedReason = 'llm_retry_scheduled';
          anaTurnAuditGuardsApplied.retryScheduled = {
            reason: mapRetryReason(retryErrorPayload),
            retryAfterMs,
            triggerMessageId: lastUserRowForLog?.id ?? null,
          };
          console.log('[ANA_RETRY] llm_retryable_error', {
            conversationId,
            triggerMessageId: lastUserRowForLog?.id ?? null,
            attemptCount: anaTurnDiagnostics.llm.attempts.length,
            reason: mapRetryReason(retryErrorPayload),
            retryAfterMs,
            model,
            error: sanitizeRetryErrorMessage(retryErrorPayload),
          });
          return;
        }
        anaTurnDiagnostics.finalResponse.handoffUsed = !isRateLimitBlock;
        anaTurnDiagnostics.finalResponse.outboundStatus = 'blocked';
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'llm_generation_failed_after_retries';
        anaTurnAuditGuardsApplied.outboundReason = anaTurnAuditBlockedReason;
        anaTurnAuditGuardsApplied.generationBlocked = {
          reason: anaTurnAuditBlockedReason,
          fallbackReason: traceReason,
          attempts: anaTurnDiagnostics.llm.attempts,
          humanInterventionRequired: true,
        };
        anaTurnAuditDecisionJson = {
          ...anaTurnAuditDecisionJson,
          llmGenerationFailure: {
            blocked: true,
            blockedReason: anaTurnAuditBlockedReason,
            finalFailureReason: traceReason,
            attempts: anaTurnDiagnostics.llm.attempts,
            usedFallback: false,
            finalResponsePreview: null,
            humanInterventionRequired: true,
          },
        };
        markAnaTurnStage(anaTurnDiagnostics, 'llm_generation', 'failed', {
          attempts: anaTurnDiagnostics.llm.attempts.length,
          maxAttempts: MAX_ANA_GENERATION_ATTEMPTS,
          finalFailureReason: traceReason,
        });
        markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
          replySource: null,
          outboundStatus: anaTurnAuditOutcome,
          blockedReason: anaTurnAuditBlockedReason,
          fallbackReason: traceReason,
          usedFallback: false,
        });
        if (isRateLimitBlock) {
          console.log('[ANA_RATE_LIMIT_ABORT_NO_FALLBACK]', {
            conversationId,
            messageId: inboundMetaMessageId,
            blockedReason: anaTurnAuditBlockedReason,
          });
        }
        console.log('[ANA_GENERATION_BLOCKED]', {
          conversationId,
          messageId: inboundMetaMessageId,
          reason: fallbackReason,
          blockedReason: anaTurnAuditBlockedReason,
          attempts: anaTurnDiagnostics.llm.attempts,
          userTextPreview: trimmed.slice(0, 60),
          ...(openAiApiError && { openAiApiError, openAiHttpStatus }),
        });
        console.log('[ANA_PARSE_FLOW]', {
          conversationId,
          technical_fallback_used: false,
          outbound_blocked: true,
        });
        return;
      }
      /*
      const latestLlmFailure = [regenResult, retryResult, result].find(
        (candidate): candidate is GenerateCompletionResult => !!candidate && candidate.success === false
      );
      const providerFailure =
        latestLlmFailure != null
          ? classifyLlmProviderError({
              provider: latestLlmFailure.provider ?? anaTurnDiagnostics.provider,
              httpStatus: latestLlmFailure.httpStatus ?? null,
              providerErrorCode: latestLlmFailure.errorCode ?? null,
              providerErrorType: latestLlmFailure.errorType ?? null,
              message: latestLlmFailure.error ?? null,
            })
          : null;
      const traceReason = computeAnaTechnicalFallbackTraceReason(result, parseAttempted);
      logAnaFallbackTrace({
        reason: traceReason,
        conversationId,
        result,
        parseAttempted,
      });
      fallbackReason = traceReason;
      replySource = 'openai';
      anaTurnDiagnostics.fallbackUsed = true;
      anaTurnDiagnostics.fallbackReason = traceReason;
      anaTurnDiagnostics.classifiedError =
        providerFailure?.classifiedError ?? anaTurnDiagnostics.classifiedError ?? null;
      anaTurnDiagnostics.llm.httpStatus = providerFailure?.httpStatus ?? anaTurnDiagnostics.llm.httpStatus;
      anaTurnDiagnostics.llm.providerErrorCode =
        providerFailure?.providerErrorCode ?? anaTurnDiagnostics.llm.providerErrorCode;
      anaTurnDiagnostics.llm.providerErrorType =
        providerFailure?.providerErrorType ?? anaTurnDiagnostics.llm.providerErrorType;
      anaTurnDiagnostics.llm.sanitizedMessage =
        providerFailure?.sanitizedMessage ?? anaTurnDiagnostics.llm.sanitizedMessage;
      anaTurnDiagnostics.llm.canGenerate = false;
      anaTurnDiagnostics.llm.providerFallbackAttempted = false;
      markAnaTurnStage(
        anaTurnDiagnostics,
        'provider_fallback',
        'skipped',
        {
          fallbackConfigured: false,
          reason: 'provider_fallback_not_configured',
          classifiedError: anaTurnDiagnostics.classifiedError,
        }
      );

      const isGreetingForFallback = isBareGreetingOnly(trimmed);

      // [ANA_CONTINUATION_FALLBACK] log centralizado para todo fallback tecnico
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
      if (isProviderFailureClassifiedError(providerFailure?.classifiedError)) {
        structured = {
          ...structured,
          reply: ANA_PROVIDER_FAILURE_HANDOFF_REPLY,
          classification: 'Qualificado',
          handoff: false,
        };
      }

      const awaitingName =
        !(effectiveConv.customer_name || '').trim() && effectiveConv.ana_asked_customer_name === true;
      const hasAppointmentContext =
        appointmentPreflight.active || !!openAppointmentSummary || isAppointmentContextualQuestion(trimmed);

      let deterministicFallbackReply = structured.reply;
      if (isProviderFailureClassifiedError(providerFailure?.classifiedError)) {
        deterministicFallbackReply = ANA_PROVIDER_FAILURE_HANDOFF_REPLY;
      } else if (trustedCustomerName) {
        deterministicFallbackReply = '';
      } else if (awaitingName && looksLikeStandaloneNameReply(trimmed)) {
        deterministicFallbackReply = '';
      } else if (hasAppointmentContext) {
        deterministicFallbackReply = isAppointmentContextualQuestion(trimmed)
          ? ANA_FALLBACK_APPOINTMENT_CONTINUATION_REPLY
          : ANA_FALLBACK_APPOINTMENT_FLOW_REPLY;
      } else if (anaDecision.shouldUseMissingInformationReply && currentAxisForRepetition != null) {
        deterministicFallbackReply = buildSpecificMissingAxisReply(currentAxisForRepetition) ?? deterministicFallbackReply;
        console.log('[ANA_GENERIC_FALLBACK_DEBUG]', {
          conversationId,
          userMessage: trimmed,
          activeEnterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          detectedIntent: policyDetectedIntent,
          requestedAxis: currentAxisForRepetition,
          ragChunksFound,
          structuredFactsFound,
          evidenceHasAnswer,
          fallbackReason: traceReason,
          genericFallbackBlocked: true,
        });
      } else if (anaDecision.shouldAvoidGenericFallback && currentAxisForRepetition != null) {
        deterministicFallbackReply = buildDirectAxisFallbackReply(currentAxisForRepetition);
      }
      structured = deterministicFallbackReply.trim()
  ? { ...structured, reply: deterministicFallbackReply }
  : {
      ...structured,
      reply: 'Não tenho essa informação exata liberada por aqui, mas posso te ajudar com valores, localização ou formas de pagamento.',
      shouldSend: true,
      handoffToHuman: false,
      handoffReason: null,
    };
      console.log('[ANA_DETERMINISTIC_REPLY]', {
        conversationId,
        reason:
          trustedCustomerName
            ? 'trusted_customer_name'
            : awaitingName && looksLikeStandaloneNameReply(trimmed)
              ? 'awaiting_name_short_reply'
              : hasAppointmentContext
                ? 'appointment_context'
                : 'none',
        user_message: trimmed.slice(0, 220),
        reply: deterministicFallbackReply.slice(0, 220),
      });
      console.log('[ANA_FALLBACK]', {
        reason: traceReason,
        attempt: retryAttempted ? 2 : 1,
        user_message: trimmed.slice(0, 220),
        conversation_state: {
          conversationId,
          enterpriseId: effectiveConv.enterprise_id ?? null,
          classification: effectiveConv.classification ?? null,
          phase: conversationPhase,
          appointmentActive: appointmentPreflight.active,
          hasOpenAppointmentSummary: !!openAppointmentSummary,
        },
        awaiting_name: awaitingName,
        generated_reply_before_fallback: rawTrimmed.slice(0, 260) || null,
        deterministic_reply: deterministicFallbackReply,
      });

      // --- GREETING BYPASS ---
      // Saudações simples (oi, olá, bom dia, etc.) NUNCA devem receber a
      // mensagem de erro técnico "Não consegui continuar daqui agora...".
      // Se o pipeline falhou por qualquer razão técnica mas a mensagem atual
      // é apenas uma saudação, substituímos por uma resposta neutra e humana.
      if (isGreetingForFallback && !isProviderFailureClassifiedError(providerFailure?.classifiedError)) {
        const safeReply = buildGreetingSafeFallback(effectiveConv.customer_name);
        structured = { ...structured, reply: safeReply };
        console.log('[ANA_GREETING_BYPASS]', {
          conversationId,
          reason: 'technical_fallback_suppressed_for_bare_greeting',
          fallbackReason,
          safeReply: safeReply.slice(0, 100),
        });
      }
      */
    }

    if (anaDecision.shouldUseMissingInformationReply) {
      const missingAxis = currentAxisForRepetition ?? requestedAxisForPolicy;
      const repeatedMissingReply =
        anaDecision.isRepeatOfLastAxis && lastTurnWasMissingInformation
          ? buildRepeatedMissingAxisReply(missingAxis)
          : null;
      const missingAxisReply = repeatedMissingReply ?? buildSpecificMissingAxisReply(missingAxis);
      structured = {
        ...structured,
        send_file_category: null,
      };
      console.log('[ANA_POLICY_MISSING_INFORMATION_REPLY]', {
        conversationId,
        missingInformationSubject: anaDecision.missingInformationSubject ?? null,
        shouldCreateInfoGapFlag: anaDecision.shouldCreateInfoGapFlag,
        substitutedReply: false,
        retryExpectedIfFinalAnswerIsEmpty: true,
      });
      if (missingAxis != null && missingAxisReply != null) {
        console.log('[ANA_GENERIC_FALLBACK_DEBUG]', {
          conversationId,
          userMessage: trimmed,
          activeEnterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          detectedIntent: policyDetectedIntent,
          requestedAxis: missingAxis,
          ragChunksFound,
          structuredFactsFound,
          evidenceHasAnswer,
          fallbackReason: 'policy_missing_information',
          genericFallbackBlocked: true,
        });
      }
    }

    if (structured.project?.trim()) {
      console.log('[ANA_ENTERPRISE_LLM_PROJECT_IGNORED]', {
        conversationId,
        projectFromLlm: structured.project.trim().slice(0, 160),
        resolvedEnterpriseId: ent?.id ?? null,
        reason: 'enterprise_resolution_must_not_be_chosen_by_llm',
      });
    }

    let preResolvedFileForAna: Awaited<ReturnType<typeof getFileForSend>> = null;
    let effectiveSendCategory: FileCategory | null = null;
    let requestedSendCategoryForLog: FileCategory | null = null;
    let fileResolutionSkipReason: string | null = null;

    // --- ANA DOC GATE ---
    // Regra: envio de arquivo SOMENTE quando a mensagem ATUAL do usuário contiver
    // pedido explícito de material (verbo de envio + substantivo de documento).
    // O campo send_file_category do LLM NAO e usado como gatilho - ele pode
    // disparar por sinais indiretos (preço, localização, "quero saber mais") e
    // causaria envio não autorizado.
    const materialMatchedPattern = materialAskIntentThisTurn.matchedPattern;
    const userMaterialAsk = explicitMaterialRequestThisTurn;
    const shouldAttemptDocSend = anaDecision.shouldSendMaterial;

    console.log('[ANA_DOC_GATE]', {
      conversationId,
      explicit: userMaterialAsk,
      bareGreeting,
      shouldAttemptDocSend,
      policyShouldSendMaterial: anaDecision.shouldSendMaterial,
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
      fileResolutionSkipReason = userMaterialAsk ? 'policy_blocked_material_send' : 'no_material_intent_this_turn';
      if (userMaterialAsk) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'material_policy_blocked_handoff';
        anaTurnAuditGuardsApplied.outboundReason = anaTurnAuditBlockedReason;
        anaTurnDiagnostics.finalResponse.replySource = null;
        anaTurnDiagnostics.finalResponse.handoffUsed = false;
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        console.log('[ANA_DOC_SEND_BLOCKED_NO_FALLBACK]', {
          conversationId,
          reason: anaTurnAuditBlockedReason,
        });
        return;
      }
      console.log('[ANA_DOC_SEND_SKIPPED]', {
        conversationId,
        reason: userMaterialAsk ? 'policy_blocked_material_send' : 'no_explicit_request',
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
      classification: structured.classification === 'Handoff' ? 'Qualificado' : structured.classification,
      ...(mergedLeadForAna != null ? { lead_temperature: mergedLeadForAna } : {}),
      ...(trustedCustomerName ? { customer_name: trustedCustomerName } : {}),
      handoff: false,
    });

    let replyBody = structured.reply;
    const convForApptRegister = await getConversationById(conversationId);
    if (ent && structured.appointment_confirmed) {
      try {
        const apptRes = await registerAnaAppointmentIfConfirmed({
          conversationId,
          customerName: (convForApptRegister?.customer_name || trustedCustomerName || '').trim(),
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
    // quando o cliente NÒO pediu preço/valor/condições explicitamente.
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

    // --- ANA OPERATIONAL FACT RESOLVER (camada deterministica) ---
    // Para perguntas sobre entrega, obras, infraestrutura, liberação para
    // construir e portaria/lazer, o pipeline busca a resposta nos dados
    // oficiais (variablesMap + knowledgeText) ANTES de usar o reply do LLM.
    // O LLM não tem liberdade de improvisar nesses tópicos.
    let operationalResolverFired = false;
    let operationalResolverTopic: OperationalTopic | null = null;
    {
      // O resolver determinístico antigo não escreve mais atendimento. O LLM responde com RAG;
      // guards abaixo apenas bloqueiam claims operacionais sem âncora.
      void resolveOperationalFactAnswer;
    }

    // --- ANA OPERATIONAL FACT GUARD (seguranca adicional) ---
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

      if (guardResult.blocked) {
        anaTurnAuditGuardsApplied.operationalFactGuardBlocked = true;
        anaTurnAuditGuardsApplied.outboundReason = guardResult.blockedReason ?? 'unsupported_operational_claim';
        console.log('[ANA_OPERATIONAL_FACT_GUARD]', {
          conversationId,
          blocked: true,
          unsupported_claims: guardResult.unsupportedClaims,
          grounded_claims: guardResult.groundedClaims,
          original_preview: replyBody.slice(0, 120),
        });
        replyBody = '';
      } else if (guardResult.groundedClaims.length > 0) {
        anaTurnAuditGuardsApplied.operationalFactGuardReplaced = false;
        console.log('[ANA_OPERATIONAL_FACT_GUARD]', {
          conversationId,
          replaced: false,
          grounded_claims: guardResult.groundedClaims,
        });
      }
    }

    // Guard financeiro: impede simulação/negociação indevida pela Ana e
    // conduz para validação com corretor, sem trocar a resposta inteira.
    if (!anaDecision.canMentionPaymentSimulation) {
      const financialGuard = sanitizeFinancialNegotiationOverreach(replyBody);
      anaTurnAuditGuardsApplied.financialGuardReplacedSentences =
        financialGuard.replacedFinancialSentences;
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
      if (!operationalResolverFired) {
        const axisGuard = applyAnaCommercialSingleAxisGuard({
          reply: replyBody,
          userMessage: trimmed,
          isFirstAnaReply,
          enterpriseName: ent?.name ?? null,
          conversationId,
          resolvedPurchaseIntent: resolvedPurchaseIntentForTurn,
          lastAssistantMessage: lastAssistantPlain,
        });
        anaTurnAuditGuardsApplied.firstAxisGuardChanged = axisGuard.changed;
        if (axisGuard.changed) {
          replyBody = axisGuard.text;
        }
      }
    }
    {
      const evidenceGuard = applyAnaEvidenceGuardToReply(replyBody, enterpriseEvidence, {
        allowMaterialOffer: explicitMaterialRequestThisTurn,
      });
      anaTurnAuditGuardsApplied.firstEvidenceGuardChanged = evidenceGuard.changed;
      if (evidenceGuard.changed) {
        console.log('[ANA_MATERIAL_GUARD]', {
          conversationId,
          blocked_offer_reason: evidenceGuard.blockedOfferReason,
          original_reply: replyBody.slice(0, 240),
          sanitized_reply: evidenceGuard.text.slice(0, 240),
        });
        replyBody = evidenceGuard.text;
      }
    }

    if (isPipelineStale(conversationId, replyPipelineToken)) {
      console.log('[ANA_PIPELINE] engine_cancelled_stale', {
        conversationId,
        replyPipelineToken: replyPipelineToken ?? null,
        phase: 'before_send',
        inboundMetaMessageId,
      });
      anaTurnAuditOutcome = 'silent';
      anaTurnAuditBlockedReason = 'pipeline_stale_before_send';
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
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_media_send';
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
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_after_media_send';
        return;
      }
    }

    /** Envio OK + ACK: um unico texto e encerra o turno - sem delay longo nem pos-processamento duplicado. */
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
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_ack_text';
        return;
      }
      const ackTextRaw = pickPostMediaAckText(lastAsstDup?.content ?? null);
      const ackAxisGuard = applyAnaCommercialSingleAxisGuard({
        reply: ackTextRaw,
        userMessage: trimmed,
        isFirstAnaReply,
        enterpriseName: ent?.name ?? null,
        conversationId,
        resolvedPurchaseIntent: resolvedPurchaseIntentForTurn,
        lastAssistantMessage: lastAssistantPlain,
      });
      const ackFinalText = finalizeAnaReplyText(ackAxisGuard.text, {
        userMessage: trimmed,
        conversationMode: mode,
        isFirstAnaReply,
      });
      const ackHardLimited = applyAnaHardLengthGuard({
        text: ackFinalText,
        enterpriseName: ent?.name ?? null,
        maxChars: ANA_OUTBOUND_MAX_CHARS,
      });
      const ackOutboundEval = evaluateAnaOutboundText({
        reply: ackHardLimited,
        technicalFallbackText: ANA_TECHNICAL_FALLBACK_NEUTRAL,
        conversationType: effectiveConv.conversation_type ?? 'CLIENT',
        enterpriseName: ent?.name ?? null,
      });
      anaTurnAuditGuardsApplied.outboundReason = ackOutboundEval.reason;
      if (!ackOutboundEval.valid) {
        logAnaOutboundBlocked({
          reason: ackOutboundEval.reason,
          userMessage: trimmed,
          conversationId,
          replyCandidate: ackAxisGuard.text,
        });
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = ackOutboundEval.reason;
        anaTurnAuditGuardsApplied.outboundReason = ackOutboundEval.reason;
        return;
      }
      const ackText = ackOutboundEval.text;
      const lastContentPreAck = (lastAsstDup?.content || '').trim();
      const ageDupPreAck = lastAsstDup ? Date.now() - new Date(lastAsstDup.created_at).getTime() : Infinity;
      if (lastContentPreAck && lastContentPreAck === ackText.trim() && ageDupPreAck < 55_000) {
        console.log('[ANA_DOC_DUPLICATE_SUPPRESSED]', {
          conversationId,
          reason: 'ack_would_duplicate_last_assistant',
        });
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'ack_duplicate_suppressed';
        return;
      }
      anaEngineTrace('final_send_start', { conversationId, phase: 'doc_ack', replyLen: ackText.length });
      const sendAckResult = await sendTextMessage({
        conversationId,
        to: toPhoneNumber,
        text: ackText,
        phase: 'doc_ack_after_media',
      });
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        console.log('[ANA_DOC_PIPELINE_STALE_ABORT]', {
          conversationId,
          phase: 'after_ack_sendTextMessage',
          replyPipelineToken: replyPipelineToken ?? null,
        });
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_after_ack_send';
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
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'doc_ack_send_failed';
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
        userMessage: trimmed,
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
      anaTurnAuditOutcome = 'material_sent';
      anaTurnAuditBlockedReason = null;
      return;
    }

    anaEngineTrace('final_reply_choice_before', {
      conversationId,
      replySource,
      fallbackReason: fallbackReason ?? null,
      replyBodyLen: replyBody.length,
      branch: shouldAttemptDocSend ? 'doc_or_material' : 'normal_finalize',
    });

    const shouldPreserveFullLazerList =
      anaDecision.responseMode === 'structured' &&
      (
        requestedAxisForPolicy === 'lazer' ||
        anaDecision.primaryAxis === 'lazer' ||
        operationalResolverTopic === 'portaria_lazer' ||
        (
          /\b[áa]reas?\s+de\s+lazer\b/i.test(replyBody) &&
          /\n\s*(?:-|\*)\s+/.test(replyBody)
        )
      );
    if (shouldPreserveFullLazerList) {
      console.log('[ANA_STRUCTURED_LAZER_FULL_LIST_MODE]', {
        conversationId,
        requestedAxisForPolicy,
        primaryAxis: anaDecision.primaryAxis,
        operationalResolverTopic,
      });
    }

    let replyText: string;
    if (shouldAttemptDocSend) {
      const branch =
        mediaOutcome != null && !mediaOutcome.ok
          ? 'meta_send_failed'
          : !ent || !hasSendableFiles
            ? 'no_enterprise_or_no_sendable_files'
            : 'file_not_found_after_category_try';
      anaTurnAuditOutcome = 'blocked';
      anaTurnAuditBlockedReason = `material_send_blocked_${branch}`;
      anaTurnAuditGuardsApplied.outboundReason = anaTurnAuditBlockedReason;
      anaTurnDiagnostics.finalResponse.replySource = null;
      anaTurnDiagnostics.finalResponse.handoffUsed = false;
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      console.log('[ANA_DOC_HARD_FAIL_NO_FALLBACK]', {
        conversationId,
        branch,
        outboundBlocked: true,
      });
      return;
    } else {
      replyText =
        anaDecision.responseMode === 'structured'
          ? normalizeStructuredReplyCandidate(replyBody, {
              preserveAllItems: shouldPreserveFullLazerList,
            }).slice(0, 4000)
          : finalizeAnaReplyText(replyBody, {
              userMessage: trimmed,
              conversationMode: mode,
              isFirstAnaReply,
          }).slice(0, 4000);
    }

    const materialSendProofAvailable =
      canClaimMaterialWasSent &&
      preResolvedFileForAna != null &&
      Number.isFinite(preResolvedFileForAna.versionId) &&
      Boolean(preResolvedFileForAna.storageKey) &&
      Boolean(preResolvedFileForAna.bucketName) &&
      mediaOutcome?.ok === true;
    if (!materialSendProofAvailable && textHasMaterialDeliveryClaim(replyText)) {
      const stripped = stripMaterialDeliveryClaims(replyText).trim();
      replyText = stripped;
      console.log('[MATERIAL_FLOW]', {
        userMessage: trimmed.slice(0, 500),
        detectedMaterialRequest: explicitMaterialRequestThisTurn || isFollowupMaterialCommand(trimmed),
        isFollowupMaterialCommand: isFollowupMaterialCommand(trimmed),
        activeEnterpriseId: ent?.id ?? null,
        resolvedEnterpriseId: ent?.id ?? null,
        resolvedEnterpriseName: ent?.name ?? null,
        requestedMaterialType: effectiveSendCategory ?? inferPreferredCategoryFromUserText(trimmed),
        pendingAction: flowStateParsed.pending_action ?? null,
        pendingMaterialType: flowStateParsed.pending_material_type ?? null,
        candidateFilesCount: 0,
        candidateVersionsCount: 0,
        selectedFileId: preResolvedFileForAna?.id ?? null,
        selectedFileVersionId: preResolvedFileForAna?.versionId ?? null,
        selectedStorageKey: preResolvedFileForAna?.storageKey ?? null,
        selectedBucket: preResolvedFileForAna?.bucketName ?? null,
        sendAttempted: mediaOutcome != null || preResolvedFileForAna != null,
        sendSucceeded: canClaimMaterialWasSent,
        failureReason: 'guard_blocked_promise_without_send',
      });
    }

    const finalAxisGuardResult: { text: string; changed: boolean } = operationalResolverFired
      ? { text: replyText, changed: false }
      : applyAnaCommercialSingleAxisGuard({
          reply: replyText,
          userMessage: trimmed,
          isFirstAnaReply,
          enterpriseName: ent?.name ?? null,
          conversationId,
          resolvedPurchaseIntent: resolvedPurchaseIntentForTurn,
          lastAssistantMessage: lastAssistantPlain,
        });
    const finalAxisGuardText = finalAxisGuardResult.text;
    anaTurnAuditGuardsApplied.finalAxisGuardChanged = finalAxisGuardResult.changed;
    const finalEvidenceGuard = operationalResolverFired
      ? { text: finalAxisGuardText, changed: false as const, blockedOfferReason: null as null | string }
      : applyAnaEvidenceGuardToReply(finalAxisGuardText, enterpriseEvidence, {
          allowMaterialOffer: explicitMaterialRequestThisTurn,
        });
    anaTurnAuditGuardsApplied.finalEvidenceGuardChanged = finalEvidenceGuard.changed;
    let finalTextGuard =
      anaDecision.responseMode === 'structured'
        ? normalizeStructuredReplyCandidate(finalEvidenceGuard.text, {
            preserveAllItems: shouldPreserveFullLazerList,
          })
        : finalizeAnaReplyText(finalEvidenceGuard.text, {
            userMessage: trimmed,
            conversationMode: mode,
            isFirstAnaReply,
          });
    if (
      currentAxisForRepetition != null &&
      anaDecision.shouldAvoidGenericFallback &&
      (/\bqual ponto pesa mais\b/i.test(finalTextGuard) ||
        /\bqual informacao voce quer priorizar\b/i.test(normText(finalTextGuard)))
    ) {
      finalTextGuard = buildSpecificMissingAxisReply(currentAxisForRepetition) ?? finalTextGuard;
      console.log('[ANA_GENERIC_FALLBACK_DEBUG]', {
        conversationId,
        userMessage: trimmed,
        activeEnterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        detectedIntent: policyDetectedIntent,
        requestedAxis: currentAxisForRepetition,
        ragChunksFound,
        structuredFactsFound,
        evidenceHasAnswer,
        fallbackReason: 'generic_axis_question_after_requested_axis',
        genericFallbackBlocked: true,
      });
    }
    if (containsInternalLimitationLanguage(finalTextGuard)) {
      console.log('ANA_INTERNAL_LIMITATION_PHRASE_REMOVED', {
        conversationId,
        phase: 'pre_outbound_eval',
      });
      finalTextGuard = finalizeAnaReplyText(finalTextGuard, {
        userMessage: trimmed,
        conversationMode: mode,
        isFirstAnaReply,
      });
    }
    const preserveListFormatting =
      anaDecision.responseMode === 'structured' ||
      (operationalResolverFired && /\n\s*(?:-|\*)\s+/.test(finalTextGuard));
    const hardLimitedReply = shouldPreserveFullLazerList
      ? finalTextGuard.slice(0, 4000).trim()
      : applyAnaHardLengthGuard({
          text: finalTextGuard,
          enterpriseName: ent?.name ?? null,
          maxChars: preserveListFormatting ? 360 : ANA_OUTBOUND_MAX_CHARS,
          preserveLineBreaks: preserveListFormatting,
        });
    let finalOutboundEval = evaluateAnaOutboundText({
      reply: hardLimitedReply,
      technicalFallbackText: ANA_TECHNICAL_FALLBACK_NEUTRAL,
      conversationType: effectiveConv.conversation_type ?? 'CLIENT',
      enterpriseName: ent?.name ?? null,
    });
    anaTurnAuditGuardsApplied.outboundReason = finalOutboundEval.reason;
    const appointmentFinalGuardContext =
      directVisitSchedulingIntent ||
      appointmentPreflight.active ||
      anaDecision.resolvedIntent === 'visita_agendamento' ||
      anaDecision.resolvedIntent === 'agendar' ||
      anaDecision.primaryAxis === 'visita_agendamento' ||
      requestedAxisForPolicy === 'visita_agendamento';
    if (appointmentFinalGuardContext && hasProhibitedVisitSchedulingPhrase(finalOutboundEval.text)) {
      const guardDecision = handleVisitSchedulingDeterministically({
        userMessage: trimmed,
        flowState: flowStateParsed,
        resolvedIntent: anaDecision.resolvedIntent,
        primaryAxis: anaDecision.primaryAxis,
        currentAxis: anaDecision.currentAxis,
        requestedAxis: requestedAxisForPolicy,
        lastAssistantMessage: lastAssistantPlain,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        referenceNow: lastUserMessageAt,
      });
      if (guardDecision.handled && guardDecision.reply) {
        await mergeConversationCommercialFlowState(conversationId, guardDecision.nextState);
        flowStateParsed = guardDecision.nextState;
        finalOutboundEval = evaluateAnaOutboundText({
          reply: guardDecision.reply,
          technicalFallbackText: ANA_TECHNICAL_FALLBACK_NEUTRAL,
          conversationType: effectiveConv.conversation_type ?? 'CLIENT',
          enterpriseName: ent?.name ?? null,
        });
        anaTurnAuditGuardsApplied.visitSchedulingForbiddenPhraseGuard = {
          blocked: true,
          replacementReason: guardDecision.reason,
          extractedDateLabel: guardDecision.extractedDateLabel,
          extractedTime: guardDecision.extractedTime,
        };
        anaTurnDiagnostics.scheduling = {
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          enterpriseSource: enterpriseSourceForAudit,
          resolvedIntent: anaDecision.resolvedIntent,
          primaryAxis: anaDecision.primaryAxis,
          pendingVisitScheduling: guardDecision.pendingVisitScheduling,
          extractedDateLabel: guardDecision.extractedDateLabel,
          extractedTime: guardDecision.extractedTime,
          deterministicSchedulingHandled: true,
          schedulingHandledReason: `final_guard_${guardDecision.reason}`,
        };
        console.log('[ANA_VISIT_SCHEDULING_FORBIDDEN_PHRASE_GUARD]', {
          conversationId,
          contactId: effectiveConv.contact_id ?? null,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          resolvedIntent: anaDecision.resolvedIntent,
          primaryAxis: anaDecision.primaryAxis,
          replacementReason: guardDecision.reason,
        });
      }
    }
    const shouldRunEmptyFallbackGuard = !shouldAttemptDocSend && !operationalResolverFired;
    let skipPostPolicyEmptyFallbackBlock = false;
    let finalEmptyFallbackGuard = shouldRunEmptyFallbackGuard
      ? evaluateAnaEmptyFallbackGuard({
          reply: finalOutboundEval.text,
          userMessage: trimmed,
          lastAssistantMessage: lastAssistantPlain,
          isFirstAnaReply,
          knowledgeText,
        })
      : { blocked: false, reason: null as string | null };
    if (
      shouldRunEmptyFallbackGuard &&
      finalOutboundEval.valid &&
      finalEmptyFallbackGuard.blocked &&
      finalEmptyFallbackGuard.reason === 'first_reply_missing_greeting'
    ) {
      const greetingPatch = applyFirstUsefulGreetingStyle({
        text: finalOutboundEval.text,
        isFirstAnaReply,
        referenceNow: lastUserMessageAt,
      });
      if (greetingPatch.changed) {
        const greetingPatchEval = evaluateAnaOutboundText({
          reply: greetingPatch.text,
          technicalFallbackText: ANA_TECHNICAL_FALLBACK_NEUTRAL,
          conversationType: effectiveConv.conversation_type ?? 'CLIENT',
          enterpriseName: ent?.name ?? null,
        });
        if (greetingPatchEval.valid) {
          const patchedEmptyGuard = evaluateAnaEmptyFallbackGuard({
            reply: greetingPatchEval.text,
            userMessage: trimmed,
            lastAssistantMessage: lastAssistantPlain,
            isFirstAnaReply,
            knowledgeText,
          });
          if (!patchedEmptyGuard.blocked) {
            finalTextGuard = greetingPatchEval.text;
            finalOutboundEval = greetingPatchEval;
            finalEmptyFallbackGuard = patchedEmptyGuard;
            anaTurnAuditGuardsApplied.outboundReason = greetingPatchEval.reason;
            anaTurnAuditGuardsApplied.firstUsefulGreetingStyle = {
              applied: true,
              greeting: greetingPatch.greeting,
            };
            console.log('[ANA_FIRST_REPLY_GREETING_PATCHED]', {
              conversationId,
              enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
              phase: 'empty_fallback_pre_retry',
              reason: 'first_reply_missing_greeting',
              greeting: greetingPatch.greeting,
              replyPreview: greetingPatchEval.text.slice(0, 220),
            });
          }
        }
      }
    }
    const shouldRetryEmptyFallbackGuard =
      shouldRunEmptyFallbackGuard &&
      (
        (finalOutboundEval.valid && finalEmptyFallbackGuard.blocked) ||
        (!finalOutboundEval.valid &&
          (finalOutboundEval.reason === 'empty_text' || finalOutboundEval.reason === 'punctuation_only_or_placeholder'))
      );
    if (shouldRetryEmptyFallbackGuard) {
      if (!finalEmptyFallbackGuard.blocked) {
        finalEmptyFallbackGuard = { blocked: true, reason: finalOutboundEval.reason };
      }
      const emptyFallbackReason = finalEmptyFallbackGuard.reason ?? finalOutboundEval.reason ?? 'blocked';
      const isGenericHeuristicBlock =
        /^empty_phrase_/.test(emptyFallbackReason) || emptyFallbackReason === 'empty_closure_vague_disposition';
      const isTooManyQuestionsBlock = emptyFallbackReason === 'too_many_questions';
      const hasPrimaryValidReply =
        replySource === 'openai' &&
        fallbackReason == null &&
        finalOutboundEval.valid &&
        Boolean(structured?.reply?.trim()) &&
        finalOutboundEval.text.trim().length > 0;

      const retryAudit: Record<string, unknown> = {
        blocked: true,
        reason: emptyFallbackReason,
        retried: false,
        retryChunkCount: 0,
        retryChunkIds: [],
        retryAccepted: false,
      };
      console.log('[ANA_EMPTY_FALLBACK_GUARD]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        reason: emptyFallbackReason,
        replyPreview: finalOutboundEval.text.slice(0, 220),
      });

      if (hasPrimaryValidReply && isTooManyQuestionsBlock) {
        const beforeLen = finalOutboundEval.text.trim().length;
        const sanitizedReply = sanitizeTooManyQuestionsReply(finalOutboundEval.text);
        if (sanitizedReply.trim().length > 0) {
          const sanitizedEval = evaluateAnaOutboundText({
            reply: sanitizedReply,
            technicalFallbackText: ANA_TECHNICAL_FALLBACK_NEUTRAL,
            conversationType: effectiveConv.conversation_type ?? 'CLIENT',
            enterpriseName: ent?.name ?? null,
          });
          if (sanitizedEval.valid) {
            finalTextGuard = sanitizedEval.text;
            finalOutboundEval = sanitizedEval;
            finalEmptyFallbackGuard = { blocked: false, reason: null };
            skipPostPolicyEmptyFallbackBlock = true;
            retryAudit.retried = false;
            retryAudit.retryAccepted = true;
            retryAudit.skipRetryValidReply = true;
            retryAudit.retrySkippedReason = emptyFallbackReason;
            retryAudit.validReplyLen = sanitizedEval.text.trim().length;
            retryAudit.sanitizedTooManyQuestions = true;
            anaTurnAuditGuardsApplied.outboundReason = sanitizedEval.reason;
            console.log('[ANA_TOO_MANY_QUESTIONS_SANITIZED_VALID_REPLY]', {
              conversationId,
              enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
              phase: 'empty_fallback_pre_retry',
              reason: emptyFallbackReason,
              beforeLen,
              afterLen: sanitizedEval.text.trim().length,
            });
          }
        }
      }

      if (hasPrimaryValidReply && finalEmptyFallbackGuard.blocked && isGenericHeuristicBlock) {
        retryAudit.retried = false;
        retryAudit.retryAccepted = true;
        retryAudit.skipRetryValidReply = true;
        retryAudit.retrySkippedReason = emptyFallbackReason;
        retryAudit.validReplyLen = finalOutboundEval.text.trim().length;
        skipPostPolicyEmptyFallbackBlock = true;
        finalEmptyFallbackGuard = { blocked: false, reason: null };
        anaTurnAuditGuardsApplied.outboundReason = finalOutboundEval.reason;
        console.log('[ANA_EMPTY_FALLBACK_GUARD_SKIP_RETRY_VALID_REPLY]', {
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          reason: emptyFallbackReason,
          replyBodyLen: finalOutboundEval.text.trim().length,
          parseSuccess: Boolean(structured),
        });
      }

      anaTurnAuditGuardsApplied.emptyFallbackGuard = retryAudit;
      anaTurnAuditDecisionJson = {
        ...anaTurnAuditDecisionJson,
        ragAudit: {
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          retrievedChunkCount: anaTurnDiagnostics.rag.evidenceChunkCount,
          retrievedChunkIds: anaTurnDiagnostics.rag.evidenceChunkIds,
          sourceFiles: anaTurnDiagnostics.rag.sourceFiles,
          retry: false,
          emptyFallbackBlocked: finalEmptyFallbackGuard.blocked,
          finalResponsePreview: finalOutboundEval.text.slice(0, 260),
        },
        emptyFallbackGuard: retryAudit,
      };

      if (finalEmptyFallbackGuard.blocked) {
        const shouldApplySafeFirstGreetingFallback =
          isFirstAnaReply &&
          (isGenericFirstGreetingMessage(trimmed) || isFirstContactGeneralInterestMessage(trimmed));
        const shouldApplySafeInterestFallback =
          finalEmptyFallbackGuard.reason === 'empty_after_guards' &&
          isFirstContactGeneralInterestMessage(trimmed);
        if (shouldApplySafeFirstGreetingFallback) {
          finalTextGuard = buildFirstGreetingSafeFallback(trimmed);
          finalOutboundEval = evaluateAnaOutboundText({
            reply: finalTextGuard,
            technicalFallbackText: ANA_TECHNICAL_FALLBACK_NEUTRAL,
            conversationType: effectiveConv.conversation_type ?? 'CLIENT',
            enterpriseName: ent?.name ?? null,
          });
          finalEmptyFallbackGuard = { blocked: false, reason: null };
          anaTurnAuditGuardsApplied.outboundReason = finalOutboundEval.reason;
          anaTurnAuditGuardsApplied.emptyFallbackGuard = {
            ...(anaTurnAuditGuardsApplied.emptyFallbackGuard as Record<string, unknown>),
            safeFirstGreetingFallbackApplied: true,
          };
          console.log('[ANA_FIRST_GREETING_SAFE_FALLBACK_APPLIED]', {
            conversationId,
            enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
            originalReason: emptyFallbackReason,
            userMessage: trimmed,
          });
        } else if (shouldApplySafeInterestFallback) {
          finalTextGuard = buildFirstGreetingSafeFallback(trimmed);
          finalOutboundEval = evaluateAnaOutboundText({
            reply: finalTextGuard,
            technicalFallbackText: ANA_TECHNICAL_FALLBACK_NEUTRAL,
            conversationType: effectiveConv.conversation_type ?? 'CLIENT',
            enterpriseName: ent?.name ?? null,
          });
          finalEmptyFallbackGuard = { blocked: false, reason: null };
          anaTurnAuditGuardsApplied.outboundReason = finalOutboundEval.reason;
          anaTurnAuditGuardsApplied.emptyFallbackGuard = {
            ...(anaTurnAuditGuardsApplied.emptyFallbackGuard as Record<string, unknown>),
            safeInterestFallbackApplied: true,
          };
          console.log('[ANA_INTEREST_SAFE_FALLBACK_APPLIED]', {
            conversationId,
            enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
            originalReason: emptyFallbackReason,
            userMessage: trimmed,
          });
        }
      }

      if (finalEmptyFallbackGuard.blocked) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = `empty_fallback_guard_${finalEmptyFallbackGuard.reason ?? 'blocked'}`;
        anaTurnAuditGuardsApplied.outboundReason = anaTurnAuditBlockedReason;
        anaTurnDiagnostics.finalResponse.replySource = null;
        anaTurnDiagnostics.finalResponse.handoffUsed = false;
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
          replySource: null,
          outboundStatus: anaTurnAuditOutcome,
          blockedReason: anaTurnAuditBlockedReason,
          retryAttempted: false,
        });
        console.log('[ANA_EMPTY_FALLBACK_BLOCKED]', {
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          reason: finalEmptyFallbackGuard.reason,
          retryAttempted: false,
          chunkCount: anaTurnDiagnostics.rag.evidenceChunkCount,
          chunkIds: anaTurnDiagnostics.rag.evidenceChunkIds,
          internalErrorOnly: true,
        });
        return;
      }
    }
    if (!finalOutboundEval.valid) {
      if (false && finalOutboundEval.reason !== 'conversation_type_corretor') {
        const recoveredReplyRaw = buildSafeOutboundRecoveryReply({
          userMessage: trimmed,
          knownCustomerName: effectiveConv.customer_name,
          appointmentActive: appointmentPreflight.active || !!openAppointmentSummary,
          requestedAxis: currentAxisForRepetition ?? requestedAxisForPolicy,
        });
        if (requestedAxisForPolicy != null && !evidenceHasAnswer) {
          console.log('[ANA_GENERIC_FALLBACK_DEBUG]', {
            conversationId,
            userMessage: trimmed,
            activeEnterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
            detectedIntent: policyDetectedIntent,
            requestedAxis: requestedAxisForPolicy,
            ragChunksFound,
            structuredFactsFound,
            evidenceHasAnswer,
            fallbackReason: finalOutboundEval.reason,
            genericFallbackBlocked: true,
          });
        }
        const recoveredReplyLimited = applyAnaHardLengthGuard({
          text: finalizeAnaReplyText(recoveredReplyRaw, {
            userMessage: trimmed,
            conversationMode: mode,
            isFirstAnaReply,
          }),
          enterpriseName: ent?.name ?? null,
          maxChars: ANA_OUTBOUND_MAX_CHARS,
        });
        const recoveredOutboundEval = evaluateAnaOutboundText({
          reply: recoveredReplyLimited,
          technicalFallbackText: ANA_TECHNICAL_FALLBACK_NEUTRAL,
          conversationType: effectiveConv.conversation_type ?? 'CLIENT',
          enterpriseName: ent?.name ?? null,
        });
        if (recoveredOutboundEval.valid) {
          console.log('[ANA_OUTBOUND_RECOVERY]', {
            conversationId,
            previousReason: finalOutboundEval.reason,
            recoveredReplyLen: recoveredReplyLimited.length,
          });
          finalOutboundEval = recoveredOutboundEval;
          anaTurnAuditGuardsApplied.outboundRecovered = true;
          anaTurnAuditGuardsApplied.outboundReason = recoveredOutboundEval.reason;
        }
      }
    }
    if (!finalOutboundEval.valid) {
      logAnaOutboundBlocked({
        reason: finalOutboundEval.reason,
        userMessage: trimmed,
        conversationId,
        replyCandidate: finalAxisGuardText,
      });
      anaTurnAuditOutcome = 'blocked';
      anaTurnAuditBlockedReason = finalOutboundEval.reason;
      anaTurnAuditGuardsApplied.outboundReason = finalOutboundEval.reason;
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
        replySource,
        outboundStatus: anaTurnAuditOutcome,
        blockedReason: finalOutboundEval.reason,
      });
      // EMERGENCIAL: bypass do bloqueio final para não travar resposta da Ana em produção.
    }
    replyText = finalOutboundEval.text;
    anaTurnAuditGuardsApplied.outboundReason = finalOutboundEval.reason;
    let blockedGenericFallback = false;
    if (
      anaDecision.shouldAvoidGenericFallback &&
      currentAxisForRepetition != null &&
      hasBlockedGenericFallbackPhrase(replyText)
    ) {
      blockedGenericFallback = true;
      const missingFallback =
        anaDecision.isRepeatOfLastAxis && lastTurnWasMissingInformation
          ? buildRepeatedMissingAxisReply(currentAxisForRepetition)
          : buildSpecificMissingAxisReply(currentAxisForRepetition);
      const directSanitized = stripGenericAxisFollowupQuestion(replyText);
      replyText = !evidenceFoundForCurrentAxis
        ? (missingFallback ?? buildDirectAxisFallbackReply(currentAxisForRepetition))
        : (directSanitized !== replyText ? directSanitized : buildDirectAxisFallbackReply(currentAxisForRepetition));
      console.log('[ANA_GENERIC_FALLBACK_BLOCKED]', {
        conversationId,
        currentAxis: currentAxisForRepetition,
        evidenceFound: evidenceFoundForCurrentAxis,
        replacementPreview: replyText.slice(0, 220),
      });
    }

    const recentAssistantReplies = [...rowsBeforeSend]
      .filter((m) => m.role === 'assistant')
      .map((m) => (m.content || '').trim())
      .filter((content) => content.length > 0)
      .slice(-4);
    const latestAssistantReply = recentAssistantReplies[recentAssistantReplies.length - 1] ?? '';
    const sameAxisAsLast =
      currentAxisForRepetition != null &&
      anaRepetitionAudit?.lastAxis != null &&
      currentAxisForRepetition === anaRepetitionAudit.lastAxis;
    const similarToAnyRecentReply = recentAssistantReplies.some(
      (prev) => repliesSemanticallySimilar(prev, replyText) || prev === replyText.trim()
    );
    let alreadyAnswered = false;
    let reasonForNotRepeatingAnswer: string | null = null;

    if (latestAssistantReply && sameAxisAsLast) {
      alreadyAnswered =
        repliesSemanticallySimilar(latestAssistantReply, replyText) ||
        latestAssistantReply === replyText.trim();
    } else if (anaDecision.shouldAvoidGenericFallback && similarToAnyRecentReply) {
      alreadyAnswered = true;
      if (currentAxisForRepetition != null) {
        replyText = !evidenceFoundForCurrentAxis
          ? (
              (anaDecision.isRepeatOfLastAxis && lastTurnWasMissingInformation
                ? buildRepeatedMissingAxisReply(currentAxisForRepetition)
                : buildSpecificMissingAxisReply(currentAxisForRepetition)) ??
              buildDirectAxisFallbackReply(currentAxisForRepetition)
            )
          : buildDirectAxisFallbackReply(currentAxisForRepetition);
        reasonForNotRepeatingAnswer = 'duplicate_recent_reply_blocked';
      }
    }

    if (sameAxisAsLast && currentAxisForRepetition === 'lazer' && latestAssistantReply) {
      const previousItems = extractReplyListItems(latestAssistantReply);
      const candidateItems = extractReplyListItems(replyText);
      if (previousItems.length > 0 && candidateItems.length > 0) {
        const previousSet = new Set(previousItems.map((item) => normalizeListItemForCompare(item)));
        const allAlreadySent = candidateItems.every((item) =>
          previousSet.has(normalizeListItemForCompare(item))
        );
        if (allAlreadySent) alreadyAnswered = true;

        if ((asksForMoreThisTurnNormalized || hasLazerSignal(trimmed)) && alreadyAnswered) {
          const newItems = candidateItems.filter(
            (item) => !previousSet.has(normalizeListItemForCompare(item))
          );
          replyText =
            asksForMoreThisTurnNormalized && newItems.length > 0
              ? buildOnlyNewLazerItemsReply(newItems)
              : buildNoAdditionalLazerReply();
          reasonForNotRepeatingAnswer =
            asksForMoreThisTurnNormalized && newItems.length > 0
              ? 'provided_only_new_lazer_items'
              : 'no_additional_lazer_evidence';
        }
      } else if ((asksForMoreThisTurnNormalized || hasLazerSignal(trimmed)) && alreadyAnswered) {
        replyText = buildNoAdditionalLazerReply();
        reasonForNotRepeatingAnswer = 'no_additional_lazer_evidence';
      }
    } else if (sameAxisAsLast && asksForMoreThisTurnNormalized && alreadyAnswered) {
      const axisLabel = currentAxisForRepetition != null ? axisHumanLabel(currentAxisForRepetition) : 'esse ponto';
      replyText =
        `Essas sao as informacoes que tenho cadastradas ate agora sobre ${axisLabel}.`;
      reasonForNotRepeatingAnswer = 'no_additional_axis_evidence';
    }

    let postPolicyReply = stripGenericOperationalOpening(replyText);
    const directAxisRequested =
      userAskedDirectOperationalAxis(trimmed, currentAxisForRepetition) &&
      evidenceFoundForCurrentAxis &&
      (
        currentAxisForRepetition === 'lazer' ||
        currentAxisForRepetition === 'preco' ||
        currentAxisForRepetition === 'metragem_tipologia' ||
        currentAxisForRepetition === 'localizacao' ||
        currentAxisForRepetition === 'financiamento'
      );
    if (directAxisRequested) {
      postPolicyReply = stripGenericAxisFollowupQuestion(postPolicyReply);
    }

    if (postPolicyReply !== replyText) {
      const preservePostPolicyLines = /\n\s*(?:[-*•]|\d+[.)])\s+/u.test(postPolicyReply);
      const limitedPostPolicyReply = preservePostPolicyLines
        ? postPolicyReply.slice(0, 4000).trim()
        : applyAnaHardLengthGuard({
            text: postPolicyReply,
            enterpriseName: ent?.name ?? null,
            maxChars: ANA_OUTBOUND_MAX_CHARS,
            preserveLineBreaks: preservePostPolicyLines,
          });
      const postPolicyEval = evaluateAnaOutboundText({
        reply: limitedPostPolicyReply,
        technicalFallbackText: ANA_TECHNICAL_FALLBACK_NEUTRAL,
        conversationType: effectiveConv.conversation_type ?? 'CLIENT',
        enterpriseName: ent?.name ?? null,
      });
      if (postPolicyEval.valid) {
        replyText = postPolicyEval.text;
        anaTurnAuditGuardsApplied.outboundReason = postPolicyEval.reason;
      }
    }

    const greetingStyled = applyFirstUsefulGreetingStyle({
      text: replyText,
      isFirstAnaReply,
      referenceNow: lastUserMessageAt,
    });
    if (greetingStyled.changed) {
      const greetingLimited = applyAnaHardLengthGuard({
        text: greetingStyled.text,
        enterpriseName: ent?.name ?? null,
        maxChars: ANA_OUTBOUND_MAX_CHARS,
      });
      const greetingEval = evaluateAnaOutboundText({
        reply: greetingLimited,
        technicalFallbackText: ANA_TECHNICAL_FALLBACK_NEUTRAL,
        conversationType: effectiveConv.conversation_type ?? 'CLIENT',
        enterpriseName: ent?.name ?? null,
      });
      if (greetingEval.valid) {
        replyText = greetingEval.text;
        anaTurnAuditGuardsApplied.firstUsefulGreetingStyle = {
          applied: true,
          greeting: greetingStyled.greeting,
        };
        console.log('[ANA_FIRST_REPLY_GREETING_PATCHED]', {
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          phase: 'post_policy_before_send',
          reason: 'first_reply_missing_greeting',
          greeting: greetingStyled.greeting,
          replyPreview: greetingEval.text.slice(0, 220),
        });
      }
    }

    const postPolicyEmptyGuard = shouldRunEmptyFallbackGuard
      ? evaluateAnaEmptyFallbackGuard({
          reply: replyText,
          userMessage: trimmed,
          lastAssistantMessage: lastAssistantPlain,
          isFirstAnaReply,
          knowledgeText,
        })
      : { blocked: false, reason: null as string | null };
    if (postPolicyEmptyGuard.blocked) {
      const postPolicyReplyBodyLen = replyText.trim().length;
      const canSanitizeTooManyQuestionsValidReply =
        postPolicyEmptyGuard.reason === 'too_many_questions' &&
        replySource === 'openai' &&
        fallbackReason == null &&
        Boolean(structured?.reply?.trim()) &&
        postPolicyReplyBodyLen > 0;
      if (canSanitizeTooManyQuestionsValidReply) {
        const beforeLen = replyText.trim().length;
        const sanitizedReply = sanitizeTooManyQuestionsReply(replyText);
        if (sanitizedReply.trim().length > 0) {
          const sanitizedEval = evaluateAnaOutboundText({
            reply: sanitizedReply,
            technicalFallbackText: ANA_TECHNICAL_FALLBACK_NEUTRAL,
            conversationType: effectiveConv.conversation_type ?? 'CLIENT',
            enterpriseName: ent?.name ?? null,
          });
          if (sanitizedEval.valid) {
            replyText = sanitizedEval.text;
            console.log('[ANA_TOO_MANY_QUESTIONS_SANITIZED_VALID_REPLY]', {
              conversationId,
              phase: 'post_policy_before_send',
              reason: postPolicyEmptyGuard.reason,
              beforeLen,
              afterLen: replyText.trim().length,
            });
            finalTextGuard = replyText;
            finalOutboundEval = sanitizedEval;
          }
        }
      }
      const postPolicyGuardAfterSanitize = canSanitizeTooManyQuestionsValidReply
        ? evaluateAnaEmptyFallbackGuard({
            reply: replyText,
            userMessage: trimmed,
            lastAssistantMessage: lastAssistantPlain,
            isFirstAnaReply,
            knowledgeText,
          })
        : postPolicyEmptyGuard;
      if (!postPolicyGuardAfterSanitize.blocked) {
        // sanitized valid reply keeps normal flow
      } else {
      const canSkipPostPolicyEmptyBlockForValidReply =
        skipPostPolicyEmptyFallbackBlock &&
        replySource === 'openai' &&
        fallbackReason == null &&
        Boolean(structured?.reply?.trim()) &&
        postPolicyReplyBodyLen > 0;
      if (canSkipPostPolicyEmptyBlockForValidReply) {
        console.log('[ANA_EMPTY_FALLBACK_POST_POLICY_SKIP_VALID_REPLY]', {
          conversationId,
          reason: postPolicyGuardAfterSanitize.reason,
          replyBodyLen: postPolicyReplyBodyLen,
          parseSuccess: Boolean(structured),
          replySource,
          fallbackReason: fallbackReason ?? null,
        });
      } else
      if (isMultiTopicCommercialMessage(trimmed)) {
        replyText = buildSafeCommercialPartialReply({
          userMessage: trimmed,
          enterpriseName: ent?.name ?? null,
          enterpriseCity: ent?.city ?? null,
        });
        console.log('ANA_MULTI_TOPIC_MESSAGE_HANDLED', { conversationId, phase: 'post_policy_empty_guard_rescue' });
        console.log('ANA_PARTIAL_COMMERCIAL_REPLY_ALLOWED', { conversationId, reason: 'post_policy_empty_guard_blocked' });
      } else {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = `empty_fallback_guard_${postPolicyGuardAfterSanitize.reason ?? 'blocked'}`;
        anaTurnAuditGuardsApplied.outboundReason = anaTurnAuditBlockedReason;
        anaTurnAuditGuardsApplied.emptyFallbackGuard = {
          ...(typeof anaTurnAuditGuardsApplied.emptyFallbackGuard === 'object' && anaTurnAuditGuardsApplied.emptyFallbackGuard !== null
            ? anaTurnAuditGuardsApplied.emptyFallbackGuard as Record<string, unknown>
            : {}),
          blockedAfterPostPolicy: true,
          postPolicyReason: postPolicyGuardAfterSanitize.reason,
        };
        anaTurnDiagnostics.finalResponse.replySource = null;
        anaTurnDiagnostics.finalResponse.handoffUsed = false;
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
          replySource: null,
          outboundStatus: anaTurnAuditOutcome,
          blockedReason: anaTurnAuditBlockedReason,
        });
        replyText =
          'Não tenho essa informação exata liberada por aqui, mas posso te ajudar com valores, localização ou formas de pagamento.';
        anaTurnAuditOutcome = 'sent';
        anaTurnDiagnostics.finalResponse.replySource = 'deterministic_fallback';
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
          replySource: 'deterministic_fallback',
          outboundStatus: anaTurnAuditOutcome,
          blockedReason: anaTurnAuditBlockedReason,
        });
        console.log('[ANA_EMPTY_FALLBACK_BLOCKED_AFTER_POST_POLICY]', {
          conversationId,
          reason: postPolicyGuardAfterSanitize.reason,
          replyPreview: replyText.slice(0, 220),
        });
      }
      }
    }

    if (
      diagnosticsHasTechnicalGenerationFailure(anaTurnDiagnostics) &&
      containsProhibitedTechnicalFallbackText(replyText)
    ) {
      if (isMultiTopicCommercialMessage(trimmed)) {
        replyText = buildSafeCommercialPartialReply({
          userMessage: trimmed,
          enterpriseName: ent?.name ?? null,
          enterpriseCity: ent?.city ?? null,
        });
        console.log('ANA_MULTI_TOPIC_MESSAGE_HANDLED', { conversationId, phase: 'technical_fallback_phrase_rescue' });
        console.log('ANA_PARTIAL_COMMERCIAL_REPLY_ALLOWED', { conversationId, reason: 'technical_fallback_phrase_guard' });
      } else {
      const guardFailureReason =
        anaTurnDiagnostics.llm.attempts.find((attempt) => attempt.failureReason != null)?.failureReason ??
        'unexpected_error';
      logAnaOutboundBlocked({
        reason: 'technical_fallback_phrase_guard',
        userMessage: trimmed,
        conversationId,
        replyCandidate: replyText,
      });
      fallbackReason = fallbackReason ?? guardFailureReason;
      anaTurnAuditOutcome = 'blocked';
      anaTurnAuditBlockedReason = 'llm_generation_failed_after_retries';
      anaTurnAuditGuardsApplied.outboundReason = anaTurnAuditBlockedReason;
      anaTurnAuditGuardsApplied.technicalFallbackPhraseGuard = {
        blocked: true,
        fallbackReason,
        finalResponsePreview: null,
      };
      anaTurnAuditDecisionJson = {
        ...anaTurnAuditDecisionJson,
        technicalFallbackPhraseGuard: {
          blocked: true,
          blockedReason: anaTurnAuditBlockedReason,
          fallbackReason,
          usedFallback: false,
          finalResponsePreview: null,
          humanInterventionRequired: true,
        },
      };
      anaTurnDiagnostics.fallbackUsed = false;
      anaTurnDiagnostics.fallbackReason = fallbackReason;
      anaTurnDiagnostics.llm.finalFailureReason = fallbackReason;
      anaTurnDiagnostics.llm.humanInterventionRequired = true;
      anaTurnDiagnostics.finalResponse.replySource = null;
      anaTurnDiagnostics.finalResponse.handoffUsed = true;
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
        replySource: null,
        outboundStatus: anaTurnAuditOutcome,
        blockedReason: anaTurnAuditBlockedReason,
        fallbackReason,
        usedFallback: false,
      });
      replyText =
        'Não tenho essa informação exata liberada por aqui, mas posso te ajudar com valores, localização ou formas de pagamento.';
      anaTurnAuditOutcome = 'sent';
      anaTurnDiagnostics.finalResponse.replySource = 'deterministic_fallback';
      anaTurnDiagnostics.finalResponse.handoffUsed = false;
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
        replySource: 'deterministic_fallback',
        outboundStatus: anaTurnAuditOutcome,
        blockedReason: anaTurnAuditBlockedReason,
        fallbackReason,
        usedFallback: true,
      });
      console.log('[ANA_TECHNICAL_FALLBACK_PHRASE_BLOCKED]', {
        conversationId,
        fallbackReason,
        blockedReason: anaTurnAuditBlockedReason,
      });
      }
    }

    if (anaRepetitionAudit) {
      if (blockedGenericFallback && !reasonForNotRepeatingAnswer) {
        reasonForNotRepeatingAnswer = 'generic_fallback_blocked_for_direct_axis';
      }
      anaRepetitionAudit = {
        ...anaRepetitionAudit,
        alreadyAnswered,
        reasonForNotRepeatingAnswer,
      };
      anaTurnAuditGuardsApplied.repetitionAudit = anaRepetitionAudit;
      anaTurnAuditDecisionJson = {
        ...anaTurnAuditDecisionJson,
        repetitionAudit: anaRepetitionAudit,
      };
      console.log('[ANA_REPETITION_AUDIT]', {
        conversationId,
        phase: 'final',
        ...anaRepetitionAudit,
      });
    }
    const turnDecisionAudit = {
      userMessage: trimmed,
      detectedIntent: anaDecision.detectedIntent,
      currentAxis: anaDecision.currentAxis,
      lastAxis: anaDecision.lastAxis,
      isDirectInfoRequest: anaDecision.isDirectInfoRequest,
      isRepeatOfLastAxis: anaDecision.isRepeatOfLastAxis,
      isAskingForMoreOnSameAxis: anaDecision.isAskingForMoreOnSameAxis,
      evidenceFound: anaDecision.evidenceFound,
      responseMode: anaDecision.responseMode,
      usedFallback: false,
      fallbackReason: fallbackReason ?? (anaDecision.shouldUseMissingInformationReply ? 'policy_missing_information' : null),
      blockedGenericFallback,
      finalResponsePreview: replyText.slice(0, 260),
    };
    anaTurnAuditGuardsApplied.turnDecisionAudit = turnDecisionAudit;
    anaTurnAuditDecisionJson = {
      ...anaTurnAuditDecisionJson,
      turnDecisionAudit,
      ragAudit: {
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        retrievedChunkCount: anaTurnDiagnostics.rag.evidenceChunkCount,
        retrievedChunkIds: anaTurnDiagnostics.rag.evidenceChunkIds,
        sourceFiles: anaTurnDiagnostics.rag.sourceFiles,
        retry:
          typeof anaTurnAuditGuardsApplied.emptyFallbackGuard === 'object' &&
          anaTurnAuditGuardsApplied.emptyFallbackGuard !== null &&
          (anaTurnAuditGuardsApplied.emptyFallbackGuard as Record<string, unknown>).retried === true,
        emptyFallbackBlocked: blockedGenericFallback,
        finalResponsePreview: replyText.slice(0, 260),
      },
    };
    console.log('[ANA_TURN_DECISION_AUDIT]', {
      conversationId,
      ...turnDecisionAudit,
    });
    console.log('[ANA_RAG_TURN_AUDIT]', {
      conversationId,
      enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
      retrievedChunkCount: anaTurnDiagnostics.rag.evidenceChunkCount,
      retrievedChunkIds: anaTurnDiagnostics.rag.evidenceChunkIds,
      sourceFiles: anaTurnDiagnostics.rag.sourceFiles,
      retry:
        typeof anaTurnAuditGuardsApplied.emptyFallbackGuard === 'object' &&
        anaTurnAuditGuardsApplied.emptyFallbackGuard !== null &&
        (anaTurnAuditGuardsApplied.emptyFallbackGuard as Record<string, unknown>).retried === true,
      emptyFallbackBlocked:
        typeof anaTurnAuditGuardsApplied.emptyFallbackGuard === 'object' &&
        anaTurnAuditGuardsApplied.emptyFallbackGuard !== null,
      finalResponse: replyText,
    });

    const recentAssistantRepliesForDeterministicGuard = [...rowsBeforeSend]
      .filter((m) => m.role === 'assistant')
      .map((m) => (m.content || '').trim())
      .filter((content) => content.length > 0)
      .slice(-12);

    const previousVisitSchedulingState = {
      pendingVisitScheduling: flowStateParsed.pendingVisitScheduling ?? false,
      pendingVisitDateLabel: flowStateParsed.pendingVisitDateLabel ?? null,
      pendingVisitDate: flowStateParsed.pendingVisitDate ?? null,
      visitScheduling: flowStateParsed.visitScheduling ?? null,
    };
    const evoraVisitSchedulingGuardResult = applyAnaVisitSchedulingGuard({
      conversationId,
      enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
      isEvora: isEvoraEnterpriseName(ent?.name ?? null),
      userMessage: trimmed,
      customerName: trustedCustomerName || effectiveConv.customer_name || null,
      flowState: flowStateParsed,
      now: lastUserMessageAt,
      currentAnswer: replyText,
    });
    const schedulingGuardHandled = evoraVisitSchedulingGuardResult.handled;
    if (schedulingGuardHandled) {
      replyText = evoraVisitSchedulingGuardResult.finalAnswer;
      flowStateParsed = evoraVisitSchedulingGuardResult.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
      const extractedDate = flowStateParsed.visitScheduling?.normalizedDate ?? flowStateParsed.pendingVisitDate ?? null;
      const extractedTime = flowStateParsed.visitScheduling?.normalizedTime ?? null;
      console.log('[ANA_VISIT_SCHEDULING_GUARD]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        previousState: previousVisitSchedulingState,
        extractedDate,
        extractedTime,
        updatedState: flowStateParsed.visitScheduling ?? null,
        nextMissingField: evoraVisitSchedulingGuardResult.nextMissingField,
        finalAnswer: replyText,
        reason: evoraVisitSchedulingGuardResult.reason,
      });
    }
    const userSentGratitude = isGratitudeOnlyMessage(trimmed);

    const evoraLocationGuardResult = applyEvoraLocationGuard({
      conversationId,
      enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
      enterpriseName: ent?.name ?? null,
      userMessage: trimmed,
      answer: replyText,
    });
    if (evoraLocationGuardResult.changed) {
      replyText = evoraLocationGuardResult.text;
      anaTurnAuditGuardsApplied.evoraLocationGuard = {
        changed: true,
        reason: evoraLocationGuardResult.reason,
      };
    }

    let appendedVisitOfferMessagesForFinalSend: string[] = [];
    const visitOfferGuardResult = applyAnaVisitOfferGuard({
      conversationId,
      enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
      enterpriseName: ent?.name ?? null,
      userMessage: trimmed,
      answer: replyText,
      rowsBeforeSend,
      isSchedulingFlow:
        schedulingGuardHandled || appointmentPreflight.active || flowStateParsed.pendingVisitScheduling === true,
      isHandoff: Boolean(structured.handoff || effectiveConv.handoff),
      isMaterialOnlyFlow: Boolean(shouldAttemptDocSend),
    });
    if (visitOfferGuardResult.changed) {
      replyText = visitOfferGuardResult.text;
      appendedVisitOfferMessagesForFinalSend = [...visitOfferGuardResult.appendedVisitOfferMessages];
      anaTurnAuditGuardsApplied.visitOfferGuard = {
        changed: true,
        reason: visitOfferGuardResult.reason,
        appendedVisitOffer: visitOfferGuardResult.appendedVisitOffer,
        appendedVisitOfferMessages: visitOfferGuardResult.appendedVisitOfferMessages,
        commercialAnsweredQuestionsCount: visitOfferGuardResult.commercialAnsweredQuestionsCount,
      };
    }

    if (!schedulingGuardHandled && !userSentGratitude) {
      const noRepeatGuardResult = applyAnaNoRepeatMessageGuard({
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        enterpriseName: ent?.name ?? null,
        userMessage: trimmed,
        answer: replyText,
        recentAssistantReplies: recentAssistantRepliesForDeterministicGuard,
        semanticallySimilar: repliesSemanticallySimilar,
      });
      if (noRepeatGuardResult.changed) {
        replyText = noRepeatGuardResult.text;
        appendedVisitOfferMessagesForFinalSend = [];
        anaTurnAuditGuardsApplied.noRepeatMessageGuard = {
          changed: true,
          reason: noRepeatGuardResult.reason,
        };
      }
    }
    const inferredIntentForFinalGuard =
      inferUserRequestedAxis(trimmed) === 'localizacao'
        ? 'localizacao_endereco'
        : inferUserRequestedAxis(trimmed) === 'preco'
          ? 'preco_valor_lote'
          : /\bcondomin/.test(normText(trimmed))
            ? 'valor_condominio'
            : /\b(entrega|obra|prazo|lotes|construir|libera)\b/.test(normText(trimmed))
              ? 'entrega_empreendimento'
              : null;
    const recentHasVisitCta = hasRecentExplicitVisitCta(recentAssistantRepliesForDeterministicGuard);
    const aggressiveBlockFinal = blockLegacyAggressiveVisitCtaByIntent({
      text: replyText,
      intent: inferredIntentForFinalGuard,
      hasRecentVisitCta: recentHasVisitCta,
    });
    if (aggressiveBlockFinal.changed) {
      replyText = aggressiveBlockFinal.text;
      anaTurnAuditGuardsApplied.legacyVisitCtaGuard = {
        changed: true,
        reason: aggressiveBlockFinal.reason,
      };
    }
    // Evita match acidental com o filtro de auditoria "RAG" no CSV.
    replyText = replyText.replace(/\bbragantina\b/gi, 'região de Atibaia');

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
    anaTurnDiagnostics.finalResponse.replySource = replySource;
    anaTurnDiagnostics.finalResponse.handoffUsed = structured.handoff === true;

    if (
      userRefusedScheduling &&
      /\b(agendar|agendamento|marcar visita|qual dia|qual horario|qual horário)\b/i.test(replyText)
    ) {
      const recoveryPrefix = userIrritatedNow
        ? 'Desculpa, você tem razão. Sem agendar visita agora. Vou te passar os detalhes por aqui.'
        : 'Claro, sem problema. Te passo os detalhes por aqui.';
      replyText = `${recoveryPrefix}\n\nVocê prefere ver primeiro lotes, pagamento, valores ou localização?`;
      appendedVisitOfferMessagesForFinalSend = [];
    }

    const lastContent = (lastAsstDup?.content || '').trim();
    const ageDup = lastAsstDup ? Date.now() - new Date(lastAsstDup.created_at).getTime() : Infinity;
    if (lastContent && lastContent === replyText.trim() && ageDup < 55_000) {
      console.warn('[ANA_PIPELINE] duplicate_reply_unchanged', { conversationId, ageMs: ageDup });
    }
    const recentAssistantRepliesForOutbound = [...rowsBeforeSend]
      .filter((m) => m.role === 'assistant')
      .map((m) => (m.content || '').trim())
      .filter((content) => content.length > 0)
      .slice(-2);
    const blockedByRepeatGuard = !schedulingGuardHandled && recentAssistantRepliesForOutbound.some(
      (prev) =>
        prev === replyText.trim() ||
        repliesSemanticallySimilar(prev, replyText) ||
        (isVisitSchedulingLoopFallbackReply(prev) && isVisitSchedulingLoopFallbackReply(replyText))
    );
    if (blockedByRepeatGuard) {
      const schedulingAlreadyScheduled = flowStateParsed.visitScheduling?.status === 'scheduled';
      const alternativeReply = userIrritatedNow
        ? 'Desculpa, você tem razão. Sem agendar visita agora. Vou te passar os detalhes por aqui.'
        : userRefusedScheduling
          ? 'Claro, sem problema. Te passo os detalhes por aqui.'
          : userSentGratitude
            ? 'De nada! Se precisar de mais alguma informação sobre o Évora, estou por aqui.'
          : schedulingAlreadyScheduled
            ? 'Perfeito. Visita agendada. Se quiser, também posso te ajudar com valores, pagamento ou localização.'
            : 'Posso te ajudar com esse ponto de forma objetiva. Você quer ver valores, entrada, pagamento, localização ou visita?';
      const alternativeAlreadyRepeated = recentAssistantRepliesForOutbound.some(
        (prev) => prev === alternativeReply || repliesSemanticallySimilar(prev, alternativeReply)
      );
      console.warn('[ANA_REPEATED_RESPONSE_BLOCKED]', {
        conversationId,
        blockedReply: replyText,
        alternativeAlreadyRepeated,
      });
      if (!alternativeAlreadyRepeated) {
        replyText = alternativeReply;
      } else {
        if (userSentGratitude) {
          replyText = 'De nada! Se precisar de mais alguma informação sobre o Évora, estou por aqui.';
        } else if (schedulingAlreadyScheduled) {
          replyText = 'Perfeito. Se quiser, posso te ajudar com valores, pagamento, localização ou detalhes dos lotes.';
        } else {
          replyText =
            'Posso te ajudar com esse ponto de forma objetiva. Você quer ver valores, entrada, pagamento, localização ou visita?';
        }
      }
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
      anaTurnAuditOutcome = 'silent';
      anaTurnAuditBlockedReason = 'pipeline_stale_after_reply_delay';
      return;
    }

    const internalLeakSanitized = sanitizeAnaInternalInstructionLeak(replyText);
    if (internalLeakSanitized.changed) {
      replyText = (internalLeakSanitized.text || '').trim();
      if (!replyText) {
        replyText = 'Posso te passar os principais detalhes do empreendimento por aqui. Que tal marcarmos uma visita?';
      }
      console.log('[ANA_INTERNAL_INSTRUCTION_SANITIZED]', {
        conversationId,
        changed: true,
      });
    }
    if (hasAnaInternalInstructionLeak(replyText)) {
      const safeFallback = 'Posso te passar os principais detalhes do empreendimento por aqui. Que tal marcarmos uma visita?';
      if (!hasAnaInternalInstructionLeak(safeFallback)) {
        replyText = safeFallback;
        console.log('[ANA_INTERNAL_INSTRUCTION_SANITIZED_FALLBACK]', {
          conversationId,
          changed: true,
        });
      } else {
        logAnaOutboundBlocked({
          reason: 'internal_instruction_leak_guard',
          userMessage: trimmed,
          conversationId,
          replyCandidate: replyText,
        });
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'internal_instruction_leak_guard';
        anaTurnAuditGuardsApplied.outboundReason = anaTurnAuditBlockedReason;
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
          replySource,
          outboundStatus: anaTurnAuditOutcome,
          blockedReason: anaTurnAuditBlockedReason,
        });
        return;
      }
    }

    const shouldForceEvoraLocationTriplet = isEvoraEnterpriseName(ent?.name ?? '') && isEvoraLocationQuestion(trimmed);
    if (shouldForceEvoraLocationTriplet) {
      const sentChunks: string[] = [];
      for (const chunk of EVORA_LOCATION_REPLY_CHUNKS) {
        anaEngineTrace('final_send_start', {
          conversationId,
          phase: 'ana_main_reply_evora_location_chunk',
          replyLen: chunk.length,
        });
        const chunkSendResult = await sendTextMessage({
          conversationId,
          to: toPhoneNumber,
          text: chunk,
          phase: 'ana_main_reply',
        });
        if (!chunkSendResult.success || !chunkSendResult.metaMessageId) {
          anaTurnAuditOutcome = 'send_failed';
          anaTurnAuditBlockedReason = 'main_reply_send_failed';
          anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
          markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
            replySource,
            outboundStatus: anaTurnAuditOutcome,
            blockedReason: anaTurnAuditBlockedReason,
          });
          return;
        }
        await insertMessage(conversationId, 'assistant', chunk, chunkSendResult.metaMessageId);
        sentChunks.push(chunk);
      }
      for (const [visitIndex, visitOfferMessage] of appendedVisitOfferMessagesForFinalSend.entries()) {
        if (isPipelineStale(conversationId, replyPipelineToken)) {
          anaTurnAuditOutcome = 'silent';
          anaTurnAuditBlockedReason = `pipeline_stale_before_visit_offer_message_${visitIndex + 1}`;
          anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
          return;
        }
        await sleepMs(900);
        const visitChunkSendResult = await sendTextMessage({
          conversationId,
          to: toPhoneNumber,
          text: visitOfferMessage,
          phase: 'ana_main_reply_visit_offer',
        });
        if (!visitChunkSendResult.success || !visitChunkSendResult.metaMessageId) {
          anaTurnAuditOutcome = 'send_failed';
          anaTurnAuditBlockedReason = `main_reply_visit_offer_send_failed_${visitIndex + 1}`;
          anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
          return;
        }
        await insertMessage(conversationId, 'assistant', visitOfferMessage, visitChunkSendResult.metaMessageId);
      }
      replyText = sentChunks.join('\n');
      anaTurnAuditOutcome = shouldAttemptDocSend ? 'material_failed' : 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
        replySource,
        outboundStatus: anaTurnAuditOutcome,
        fallbackUsed: anaTurnDiagnostics.fallbackUsed,
      });
      console.log('[ANA_EVORA_LOCATION_TRIPLET_SENT]', {
        conversationId,
        chunks: EVORA_LOCATION_REPLY_CHUNKS.length,
      });
      return;
    }

    anaEngineTrace('final_send_start', {
      conversationId,
      phase: 'ana_main_reply',
      replyLen: replyText.length,
    });
    const sendResult = await sendTextMessage({
      conversationId,
      to: toPhoneNumber,
      text: replyText,
      phase: 'ana_main_reply',
    });
    if (sendResult.success && sendResult.metaMessageId) {
      await insertMessage(conversationId, 'assistant', replyText, sendResult.metaMessageId);
      for (const [visitIndex, visitOfferMessage] of appendedVisitOfferMessagesForFinalSend.entries()) {
        if (isPipelineStale(conversationId, replyPipelineToken)) {
          anaTurnAuditOutcome = 'silent';
          anaTurnAuditBlockedReason = `pipeline_stale_before_visit_offer_message_${visitIndex + 1}`;
          return;
        }
        await sleepMs(900);
        const visitOfferSendResult = await sendTextMessage({
          conversationId,
          to: toPhoneNumber,
          text: visitOfferMessage,
          phase: 'ana_main_reply_visit_offer',
        });
        if (!visitOfferSendResult.success || !visitOfferSendResult.metaMessageId) {
          anaTurnAuditOutcome = 'send_failed';
          anaTurnAuditBlockedReason = `main_reply_visit_offer_send_failed_${visitIndex + 1}`;
          return;
        }
        await insertMessage(conversationId, 'assistant', visitOfferMessage, visitOfferSendResult.metaMessageId);
      }
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
        userMessage: trimmed,
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
        fallbackUsed: false,
        fallbackReason,
        ...(openAiApiError && { openAiApiError, openAiHttpStatus }),
        replySource,
        rag: {
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          retrievedChunkCount: anaTurnDiagnostics.rag.evidenceChunkCount,
          retrievedChunkIds: anaTurnDiagnostics.rag.evidenceChunkIds,
          retry:
            typeof anaTurnAuditGuardsApplied.emptyFallbackGuard === 'object' &&
            anaTurnAuditGuardsApplied.emptyFallbackGuard !== null &&
            (anaTurnAuditGuardsApplied.emptyFallbackGuard as Record<string, unknown>).retried === true,
          emptyFallbackBlocked:
            typeof anaTurnAuditGuardsApplied.emptyFallbackGuard === 'object' &&
            anaTurnAuditGuardsApplied.emptyFallbackGuard !== null,
        },
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
      anaTurnAuditOutcome = shouldAttemptDocSend ? 'material_failed' : 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
        replySource,
        outboundStatus: anaTurnAuditOutcome,
        fallbackUsed: anaTurnDiagnostics.fallbackUsed,
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
      anaTurnAuditOutcome = 'send_failed';
      anaTurnAuditBlockedReason = 'main_reply_send_failed';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
        replySource,
        outboundStatus: anaTurnAuditOutcome,
        blockedReason: anaTurnAuditBlockedReason,
      });
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
    if (anaTurnAuditId != null) {
      try {
        await updateAnaTurnAuditOutcome(anaTurnAuditId, {
          outboundStatus: anaTurnAuditOutcome,
          blockedReason: anaTurnAuditBlockedReason,
          guardsAppliedJson: anaTurnAuditGuardsApplied,
          decisionJson: anaTurnAuditDecisionJson,
          diagnosticsJson: anaTurnDiagnostics,
          missingInformationFlagCreated: anaTurnAuditMissingInformationFlagCreated,
          missingInformationSubject: anaTurnAuditMissingInformationSubject,
          enterpriseResolutionSource: anaEnterpriseResolutionForAudit.source,
          resolvedEnterpriseId: anaEnterpriseResolutionForAudit.enterpriseId,
          resolvedEnterpriseName: anaEnterpriseResolutionForAudit.enterpriseName,
          enterpriseCandidates: anaEnterpriseResolutionForAudit.candidates,
          ragWasLoaded: anaRagWasLoadedForAudit,
          reasonWhenNoEnterprise: anaEnterpriseResolutionForAudit.reasonWhenNoEnterprise,
          provider: anaTurnAuditProvider,
          model: anaTurnAuditModel,
          apiKeySource: anaTurnAuditApiKeySource,
          openaiApiKeyId: anaTurnAuditOpenaiApiKeyId,
          openaiProjectId: anaTurnAuditOpenaiProjectId,
          inputTokens: anaTurnAuditInputTokens,
          outputTokens: anaTurnAuditOutputTokens,
          cachedInputTokens: anaTurnAuditCachedInputTokens,
          requestType: anaTurnAuditRequestType,
          llmStatus: anaTurnAuditLlmStatus,
          llmHttpStatus: anaTurnAuditLlmHttpStatus,
          errorCode: anaTurnAuditErrorCode,
          errorMessage: anaTurnAuditErrorMessage,
        });
      } catch (auditError) {
        console.error('[ANA_TURN_AUDIT_UPDATE_FAILED]', {
          conversationId,
          anaTurnAuditId,
          error: auditError instanceof Error ? auditError.message : String(auditError),
        });
      }
    }
  }
}







