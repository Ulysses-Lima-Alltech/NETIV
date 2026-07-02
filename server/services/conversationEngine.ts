import { statSync } from 'fs';
import { query } from '../db/pg.js';
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
  setConversationPendingResolutionState,
  clearConversationPendingResolutionState,
  updateClassification,
} from '../repositories/conversationRepository.js';
import { publishConversationUpdated } from '../realtime/realtimePublisher.js';
import { assignConversationToNextBroker } from './brokerAssignmentService.js';
import {
  sendBrokerAppointmentConfirmedTemplate,
  sendBrokerPendingAttendanceTemplate,
} from './brokerWhatsappNotificationService.js';
import { sendBrokerPendingAttendancePush } from './brokerPushNotificationService.js';
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
  listEnterpriseFiles,
  getFileForSend,
  getVariablesMap,
  logSentFile,
  listEnterprises,
  normalizeFileCategory,
  logAnaDocInventoryForEnterprise,
  resolveSendableEnterpriseFileCurrentVersion,
  resolveSendableEnterpriseImageFilesCurrentVersion,
  resolveSendableEnterpriseVideoFilesCurrentVersion,
  type MaterialFileResolveFailureReason,
  type FileCategory,
  type EnterpriseRow,
} from '../repositories/enterpriseRepository.js';
import { getCorretorById } from '../repositories/corretorRepository.js';
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
  sanitizeAnaClientVisibleReplyText,
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
  isUncertainCustomerNameCue,
  replyExplicitlyAsksCustomerName,
} from '../utils/extractCustomerNameFromMessage.js';
import {
  buildAnaEnterpriseEvidence,
  hasAnaEvidenceForNeed,
  applyAnaEvidenceGuardToReply,
  type AnaEnterpriseEvidence,
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
  extractAnaImageFilenameTopic,
  filterAnaImageFilesByFilenameTopic,
  userAskedForSpecificImageFilenameTopic,
} from '../utils/anaDocSendIntent.js';
import {
  ANA_IMAGE_MATERIAL_POST_SEND_FALLBACK_TEXT,
  buildAnaImageMaterialCommercialContext,
  buildAnaImageMaterialPostSendMessages,
  type AnaImageMaterialPostSendContext,
} from '../utils/anaImageMaterialPostSend.js';
import {
  handleVisitSchedulingDeterministically,
  isCommercialQuestionThatShouldBypassVisitScheduling,
  isExplicitVisitSchedulingAcceptance,
  isVisitSchedulingSlotAnswer,
  hasProhibitedVisitSchedulingPhrase,
  isExplicitVisitSchedulingNegativeMessage,
  isAssistantVisitOfferContextMessage,
  isVisitSchedulingAckOnlyMessage,
  isVisitSchedulingConfirmationMessage,
  isVisitSchedulingIntent,
  isVisitSchedulingLoopFallbackReply,
  isVisitSchedulingRefusalMessage,
  isVisitSchedulingTopicSwitchMessage,
  isSuggestedSlotAlternativeInterestMessage,
  reconstructVisitStateFromRecentMessages,
} from '../utils/anaDirectVisitScheduling.js';
import {
  resolveShortConfirmationContext,
  shouldSuppressVisitFlowForConfirmationKind,
  type AnaShortConfirmationContext,
} from '../utils/anaShortConfirmationContext.js';
import { applyAnaConversationPolicy } from '../utils/anaConversationPolicy.js';
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
  cancelAnaVisitFollowupForConversation,
  startAnaVisitFollowupIfEligible,
} from './anaVisitFollowupService.js';
import {
  extractAnaVisitSlotPreferenceFromText,
  findNextAvailableVisitSlot,
  formatAnaVisitSlotLabel,
  validateVisitSlotStillAvailable,
  type AnaVisitAvailabilitySlot,
  type AnaVisitSlotAvailabilityResult,
} from './anaVisitAvailabilityService.js';
import {
  APPOINTMENT_BUSINESS_TZ,
  parseAppointmentStartEndInSaoPaulo,
} from '../utils/appointmentDateNormalize.js';
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
  isEvoraEnterpriseName,
  isUserIrritated,
  isVisitSchedulingRefusal,
  resolveAnaCommercialRule,
  splitCommercialRuleMessages,
} from './anaCommercialRulesService.js';
import { ANA_COMMERCIAL_RULES } from '../config/anaCommercialRules.js';
import {
  buildLeadQualificationBridgeReply,
  classifyPendingResolutionChoice,
  detectAnaKnowledgeGap,
  isExplicitResolutionChoice,
  isSubstantiveQuestionThatBypassesResolutionChoice,
  type AnaKnowledgeGapResult,
  validateKnowledgeGapResolutionOffer,
} from '../utils/anaKnowledgeGapGuard.js';
import {
  buildAnaCommercialSpecificNoLlmReply,
  detectAnaCommercialSpecificNoLlmIntent,
  evaluateAnaTokenBudget,
  getAnaTokenBudgetConfig,
  isCommercialNoLlmIntentAlwaysSensitive,
} from '../utils/anaTokenBudget.js';
import {
  evaluateFinalQuestionCheck,
  extractLastQuestionSentenceFromReply,
  inferCommittedQuestionType,
  mergeRecentQuestions,
  questionsAreEquivalent,
  type AnaCommittedQuestionType,
} from '../utils/anaFinalQuestionPolicy.js';
import {
  buildEvoraShortPresentationAfterName,
  buildEvoraLeadQualificationProgressReply,
  buildLeadQualificationNameQuestion,
  extractLeadQualificationSignals,
  getLeadQualificationState,
  isObjectiveCustomerQuestion,
  markLeadQualificationQuestionAsked,
  mergeLeadQualificationState,
  selectNextLeadQualificationQuestion,
  shouldAskNameFirst,
  stripTrailingQuestion,
  type LeadQualificationQuestionSelection,
} from '../utils/anaLeadQualificationPolicy.js';

/** Desligado para rastrear o fluxo real com [ANA_ENGINE_TRACE]. */
const ANA_ENGINE_DIAGNOSTIC_FIXED_REPLY = false;
const ANA_ENGINE_DIAGNOSTIC_TEXT = 'Diagnóstico: cheguei no conversation engine.';
const ANA_PROVIDER_FAILURE_HANDOFF_REPLY =
  buildAnaNoInfoBrokerVisitOffer();
const ANA_LLM_FIRST_TECHNICAL_FALLBACK_REPLY =
  buildAnaNoInfoBrokerVisitOffer();
const ANA_LLM_FIRST_MISSING_INFO_REPLY =
  buildAnaNoInfoBrokerVisitOffer();
const ANA_NAME_QUESTION_REPAIR_REPLY =
  'Perfeito. Só para eu seguir certinho, como posso te chamar?';
function buildAnaNoInfoBrokerVisitOffer(): string {
  return 'Esse ponto precisa de confirma\u00E7\u00E3o atualizada. Posso te encaminhar para um corretor ou te ajudar a agendar uma visita?';
}

const MAX_ANA_GENERATION_ATTEMPTS = 5;
const ANA_DEBUG_QWEN_RAW = String(process.env.ANA_DEBUG_QWEN_RAW || '').trim().toLowerCase() === 'true';
const ANA_LLM_FIRST_COMMERCIAL_REPLIES =
  String(process.env.ANA_LLM_FIRST_COMMERCIAL_REPLIES ?? 'true').trim().toLowerCase() !== 'false';
const ANA_GLOBAL_NO_ENTERPRISE_SAFE_DISCOVERY_REPLY =
  'Claro, posso te ajudar. Você busca apartamento ou loteamento? Tem algum empreendimento ou região em mente?';

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
  | 'conversational_text'
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

function maskBaseUrl(baseUrl: string | null | undefined): string | null {
  const raw = String(baseUrl || '').trim();
  if (!raw) return null;
  return raw.replace(/(https?:\/\/)([^/]+)(.*)?/i, (_m, scheme: string, host: string, path: string) => {
    const safeHost = host.length <= 8 ? host : `${host.slice(0, 4)}***${host.slice(-3)}`;
    return `${scheme}${safeHost}${path ?? ''}`;
  });
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

type AnaTurnTopic =
  | 'localizacao'
  | 'region_deep_dive'
  | 'lazer'
  | 'seguranca'
  | 'valores'
  | 'pagamento'
  | 'lotes'
  | 'visita'
  | 'corretor'
  | 'rota'
  | 'geral';

type AnaTurnContextResolved = {
  conversationId: number;
  currentUserText: string;
  recentHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  lastInboundText: string | null;
  lastOutboundText: string | null;
  lastAssistantQuestionText: string | null;
  lastAssistantQuestionType: string | null;
  lastOfferedTopics: string[];
  topicsAlreadyAnswered: string[];
  currentTopic: AnaTurnTopic | null;
  requestedTopic: AnaTurnTopic | null;
  acceptedOfferTopic: AnaTurnTopic | null;
  commercialAxis: CommercialAxis | null;
  visitState: {
    active: boolean;
    pendingVisitScheduling: boolean;
    status: string | null;
  };
  brokerState: {
    pendingBrokerHandoff: boolean;
  };
  mediaState: {
    pendingMaterialType: string | null;
    lastRequestedMaterialType: string | null;
  };
  shouldCallQwen: boolean;
  deterministicCandidate: string | null;
  finalDecisionReason: string | null;
  decisionPath: string[];
};

function isAffirmativeForTurn(text: string): boolean {
  const n = normText(text || '').replace(/[.!?]+$/g, '').trim();
  if (!n) return false;
  return /^(sim|quero|pode|claro|com certeza|ok|beleza|blz|isso|por favor|manda)$/.test(n);
}

function normalizeOfferedTopicForTurn(topic: string | null | undefined): AnaTurnTopic | null {
  const n = normText(topic || '');
  if (!n) return null;
  if (n === 'localizacao' || n === 'endereco') return 'localizacao';
  if (n === 'lazer') return 'lazer';
  if (n === 'seguranca') return 'seguranca';
  if (n === 'valores') return 'valores';
  if (n === 'pagamento' || n === 'formas_pagamento' || n === 'formas de pagamento') return 'pagamento';
  if (n === 'visita') return 'visita';
  if (n === 'corretor') return 'corretor';
  return null;
}

function detectRequestedTopicForTurn(text: string): AnaTurnTopic | null {
  const n = normText(text || '');
  if (!n) return null;
  if (isExplicitRegionDeepDiveRequest(text)) return 'region_deep_dive';
  if (/\b(quantos?\s+lotes?|numero\s+de\s+lotes?|vai\s+ter\s+quantos?\s+lotes?)\b/.test(n)) return 'lotes';
  if (
    /\b(link|google maps|maps|mapa|rota|como chegar|manda localizacao|manda a localizacao|me envia a localizacao|me envia localizacao|me manda a localizacao|me manda localizacao)\b/.test(
      n
    )
  ) {
    return 'rota';
  }
  if (/\b(onde fica|localizacao|endereco|regiao|bairro|pedreira|rio abaixo)\b/.test(n)) return 'localizacao';
  if (/\b(seguranca|portaria|controle de acesso|monitoramento)\b/.test(n)) return 'seguranca';
  if (/\b(lazer|areas? de lazer|piscina|academia|playground|quadra|coworking|fireplace)\b/.test(n)) return 'lazer';
  if (/\b(formas? de pagamento|pagamento|entrada|parcela|parcelamento|financiamento)\b/.test(n)) return 'pagamento';
  if (/\b(preco|valor|quanto custa|investimento|metro quadrado|m2)\b/.test(n)) return 'valores';
  if (/\b(visita|agendar|agendamento|marcar visita)\b/.test(n)) return 'visita';
  if (/\b(corretor|consultor|encaminha)\b/.test(n)) return 'corretor';
  return null;
}

function isGenericPendingTopicFollowup(text: string | null | undefined): boolean {
  const n = normText(text || '').replace(/[.!?]+$/g, '').trim();
  if (!n) return false;
  return (
    /^(fala mais|me explica mais|me fala mais|me fala mais de la|e dai|e dai\?|nao conheco nada)$/.test(n) ||
    /^(me fale mais|explica mais|explica melhor|me conta mais|continua|como e la|como e atibaia)$/.test(n)
  );
}

function isObjectiveLocationCanonicalRequest(text: string | null | undefined): boolean {
  const n = normText(text || '').replace(/[.!?]+$/g, '').trim();
  if (!n) return false;
  return (
    /^(onde fica|fica onde|qual a localizacao|qual o endereco|endereco|localizacao|localizacao exata|endereco exato)$/.test(n) ||
    /\b(qual a localizacao|qual o endereco|endereco exato|localizacao exata|link do maps|google maps|manda o mapa|me manda o mapa|manda localizacao|manda a localizacao|me manda a localizacao|como chegar|rota)\b/.test(n)
  );
}

function isExplicitRegionDeepDiveRequest(text: string | null | undefined): boolean {
  const n = normText(text || '').replace(/[.!?]+$/g, '').trim();
  if (!n) return false;
  if (isObjectiveLocationCanonicalRequest(text)) return false;
  return (
    /^(da regiao|regiao|sobre a regiao|fala da regiao|me fala da regiao|e a regiao)$/.test(n) ||
    /^mas (vc|voce) ia falar da regiao$/.test(n) ||
    /\bia falar da regiao\b/.test(n) ||
    /\b(quero saber mais|queria saber mais|me fala mais|me fale mais|fala mais|me explica|me explica mais|me explica a|explica)\b[\s\S]{0,80}\b(localizacao|regiao|atibaia)\b/.test(n) ||
    /\b(localizacao|regiao|atibaia)\b[\s\S]{0,80}\b(quero saber mais|queria saber mais|me fala mais|me fale mais|fala mais|me explica|explica melhor)\b/.test(n) ||
    /\b(eu moro em sp|moro em sp|sou de sp|sao paulo)\b[\s\S]{0,120}\b(nao conheco|nao conheco nada|como e|atibaia|regiao)\b/.test(n) ||
    /\b(nao conheco nada|nao conheco a regiao|nao conheco atibaia|como e la|como e atibaia|me explica a regiao)\b/.test(n)
  );
}

function detectDominantTopicFromLatestAssistant(text: string | null | undefined): AnaTurnTopic | null {
  const n = normText(text || '');
  if (!n) return null;
  const hasRegion = /\b(atibaia|regiao|localizacao|pedreira|rio abaixo|dom pedro i)\b/.test(n);
  const hasLazer = /\b(lazer|piscina|academia|playground|quadra|coworking|fireplace)\b/.test(n);
  const hasPayment = /\b(pagamento|financiamento|parcela|entrada|120x|48x)\b/.test(n);
  const hasLots = /\b(lotes?|metragem|360|725|disponibilidade)\b/.test(n);
  if (hasLazer && !hasRegion && !hasPayment) return 'lazer';
  if (hasPayment && !hasRegion && !hasLazer) return 'pagamento';
  if (hasLots && !hasRegion && !hasLazer && !hasPayment) return 'lotes';
  if (hasRegion) return 'localizacao';
  return null;
}

function getRecentAssistantContextForPendingTopic(rows: Array<{ role: string; content: string }>): {
  latestAssistant: string | null;
  recentAssistantBlock: string;
  recentAssistantWindow: string;
} {
  const recent = rows
    .map((row) => ({
      role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(row.content ?? '').trim(),
    }))
    .filter((row) => row.content.length > 0)
    .slice(-16);
  const assistants = recent.filter((row) => row.role === 'assistant').map((row) => row.content);
  const latestAssistant = assistants[assistants.length - 1] ?? null;
  const block: string[] = [];
  for (let i = recent.length - 1; i >= 0; i--) {
    const row = recent[i];
    if (!row) continue;
    if (row.role === 'user') {
      if (block.length > 0) break;
      continue;
    }
    block.unshift(row.content);
  }
  return {
    latestAssistant,
    recentAssistantBlock: block.join('\n'),
    recentAssistantWindow: assistants.slice(-8).join('\n'),
  };
}

function resolvePendingRegionDeepDiveTopic(input: {
  currentUserText: string;
  expandedUserText?: string | null;
  rows: Array<{ role: string; content: string }>;
  lastAssistantQuestionText?: string | null;
  lastOfferedTopics?: string[] | null;
}): { resolved: boolean; reason: string | null; assistantContextPreview: string } {
  const textForDetection = [input.currentUserText, input.expandedUserText ?? '']
    .filter(Boolean)
    .join('\n');
  const explicitRegion = isExplicitRegionDeepDiveRequest(textForDetection);
  const genericFollowup = isGenericPendingTopicFollowup(input.currentUserText);
  if (!explicitRegion && !genericFollowup) {
    return { resolved: false, reason: null, assistantContextPreview: '' };
  }

  const assistantContext = getRecentAssistantContextForPendingTopic(input.rows);
  const contextText = [
    assistantContext.recentAssistantBlock,
    assistantContext.recentAssistantWindow,
    input.lastAssistantQuestionText ?? '',
    ...(input.lastOfferedTopics ?? []),
  ].join('\n');
  const nContext = normText(contextText);
  const hasRegionContext =
    /\b(atibaia|regiao|localizacao|pedreira|rio abaixo|dom pedro i|50 minutos|sao paulo)\b/.test(nContext);
  if (explicitRegion) {
    return {
      resolved: true,
      reason: hasRegionContext ? 'explicit_region_with_recent_context' : 'explicit_region_request',
      assistantContextPreview: contextText.slice(0, 260),
    };
  }

  if (!hasRegionContext) {
    return { resolved: false, reason: null, assistantContextPreview: contextText.slice(0, 260) };
  }

  const latestDominantTopic = detectDominantTopicFromLatestAssistant(assistantContext.latestAssistant);
  const offeredTopics = (input.lastOfferedTopics ?? [])
    .map((topic) => normalizeOfferedTopicForTurn(topic))
    .filter((topic): topic is AnaTurnTopic => topic != null);
  const uniqueOfferedTopics = [...new Set(offeredTopics)];
  const latestSingleNonRegionOffer =
    uniqueOfferedTopics.length === 1 &&
    uniqueOfferedTopics[0] !== 'localizacao' &&
    latestDominantTopic === uniqueOfferedTopics[0];
  if (latestSingleNonRegionOffer) {
    return { resolved: false, reason: null, assistantContextPreview: contextText.slice(0, 260) };
  }

  return {
    resolved: true,
    reason: 'generic_followup_after_region_context',
    assistantContextPreview: contextText.slice(0, 260),
  };
}

function detectTopicFromAssistantAnswer(text: string): AnaTurnTopic | null {
  const n = normText(text || '');
  if (!n) return null;
  if (/\b(portaria 24 horas|seguranca|controle de acesso)\b/.test(n)) return 'seguranca';
  if (/\b(areas? de lazer|piscina adulto|academia|campo society|quadra de beach tennis)\b/.test(n)) return 'lazer';
  if (/\b(rodovia dom pedro i|regiao da pedreira|rio abaixo|atibaia)\b/.test(n)) return 'localizacao';
  if (/\b(120x|48x|financiamento direto)\b/.test(n)) return 'pagamento';
  if (/\b(r\$\s*279|r\$\s*775|valor inicial)\b/.test(n)) return 'valores';
  if (/\b(quantos?\s+lotes?|informacao exata liberada)\b/.test(n)) return 'lotes';
  return null;
}

function mapCommercialAxisToTurnTopic(axis: CommercialAxis | null): AnaTurnTopic | null {
  if (!axis) return null;
  if (axis === 'localizacao') return 'localizacao';
  if (axis === 'lazer') return 'lazer';
  if (axis === 'preco') return 'valores';
  if (axis === 'financiamento') return 'pagamento';
  if (axis === 'visita_agendamento') return 'visita';
  if (axis === 'disponibilidade') return 'lotes';
  return null;
}

function resolveAnaConversationTurn(input: {
  conversationId: number;
  currentUserText: string;
  expandedUserText?: string | null;
  rows: Array<{ role: string; content: string }>;
  flowState: CommercialFlowState;
  lastAssistantQuestionText: string | null;
  lastAssistantQuestionType: string | null;
  lastOfferedTopics: string[];
  requestedAxis: CommercialAxis | null;
}): AnaTurnContextResolved {
  const recentHistory = input.rows
    .map((row) => ({
      role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: String(row.content ?? ''),
    }))
    .slice(-12);
  const lastInboundText = [...recentHistory].reverse().find((row) => row.role === 'user')?.content?.trim() || null;
  const lastOutboundText = [...recentHistory].reverse().find((row) => row.role === 'assistant')?.content?.trim() || null;
  const pendingRegionTopic = resolvePendingRegionDeepDiveTopic({
    currentUserText: input.currentUserText,
    expandedUserText: input.expandedUserText,
    rows: input.rows,
    lastAssistantQuestionText: input.lastAssistantQuestionText,
    lastOfferedTopics: input.lastOfferedTopics,
  });
  const requestedTopic = pendingRegionTopic.resolved
    ? 'region_deep_dive'
    : detectRequestedTopicForTurn(input.currentUserText);
  const offeredTopics = (input.lastOfferedTopics ?? [])
    .map((topic) => normalizeOfferedTopicForTurn(topic))
    .filter((topic): topic is AnaTurnTopic => topic != null);
  const uniqueOfferedTopics = [...new Set(offeredTopics)];
  const isAffirmative = isAffirmativeForTurn(input.currentUserText);
  let acceptedOfferTopic: AnaTurnTopic | null = null;
  if (isAffirmative && uniqueOfferedTopics.length === 1) {
    acceptedOfferTopic = uniqueOfferedTopics[0] ?? null;
  } else if (
    isAffirmative &&
    uniqueOfferedTopics.length === 0 &&
    /(corretor|consultor)/.test(normText(input.lastAssistantQuestionText || ''))
  ) {
    acceptedOfferTopic = 'corretor';
  } else if (
    isAffirmative &&
    uniqueOfferedTopics.length === 0 &&
    /(visita|agendar|marcar)/.test(normText(input.lastAssistantQuestionText || ''))
  ) {
    acceptedOfferTopic = 'visita';
  }

  const topicsAlreadyAnswered: string[] = [];
  for (const row of recentHistory) {
    if (row.role !== 'assistant') continue;
    const detected = detectTopicFromAssistantAnswer(row.content);
    if (detected && !topicsAlreadyAnswered.includes(detected)) topicsAlreadyAnswered.push(detected);
  }
  const currentTopic = requestedTopic ?? (topicsAlreadyAnswered[topicsAlreadyAnswered.length - 1] as AnaTurnTopic | undefined) ?? null;

  const decisionPath: string[] = [];
  if (pendingRegionTopic.resolved) decisionPath.push(`pending_region:${pendingRegionTopic.reason ?? 'resolved'}`);
  if (requestedTopic) decisionPath.push(`requested:${requestedTopic}`);
  if (acceptedOfferTopic) decisionPath.push(`accepted_offer:${acceptedOfferTopic}`);
  if (input.requestedAxis) decisionPath.push(`axis:${input.requestedAxis}`);
  if (!requestedTopic && !acceptedOfferTopic) decisionPath.push('fallback:qwen_candidate');

  const deterministicCandidate =
    requestedTopic != null
      ? requestedTopic === 'region_deep_dive'
        ? null
        : requestedTopic === 'rota'
        ? 'location_link_handler'
        : 'topic_handler'
      : acceptedOfferTopic != null
        ? 'accepted_offer_handler'
        : null;
  const shouldCallQwen = deterministicCandidate == null;

  return {
    conversationId: input.conversationId,
    currentUserText: input.currentUserText,
    recentHistory,
    lastInboundText,
    lastOutboundText,
    lastAssistantQuestionText: input.lastAssistantQuestionText,
    lastAssistantQuestionType: input.lastAssistantQuestionType,
    lastOfferedTopics: [...input.lastOfferedTopics],
    topicsAlreadyAnswered,
    currentTopic,
    requestedTopic,
    acceptedOfferTopic,
    commercialAxis: requestedTopic === 'region_deep_dive' ? 'localizacao' : input.requestedAxis,
    visitState: {
      active: input.flowState.pendingVisitScheduling === true || input.flowState.visitScheduling?.active === true,
      pendingVisitScheduling: input.flowState.pendingVisitScheduling === true,
      status: input.flowState.visitScheduling?.status ?? null,
    },
    brokerState: {
      pendingBrokerHandoff: /(corretor|consultor)/.test(normText(input.lastAssistantQuestionText || '')),
    },
    mediaState: {
      pendingMaterialType: input.flowState.pending_material_type ?? null,
      lastRequestedMaterialType: input.flowState.last_requested_material_type ?? null,
    },
    shouldCallQwen,
    deterministicCandidate,
    finalDecisionReason: null,
    decisionPath,
  };
}

type CommittedReplyQuestionType = AnaCommittedQuestionType;

type CommittedReplyStateExtraction = {
  lastAssistantQuestionText: string | null;
  lastAssistantQuestionType: CommittedReplyQuestionType;
  recentQuestions: string[];
  lastOfferedTopics: string[];
  lastAnsweredTopic: string | null;
  topicsAlreadyAnswered: string[];
  lastCommittedHandler: string;
  lastCommittedAt: string;
};

function extractLastQuestionSentenceFromCommittedReply(text: string): string | null {
  return extractLastQuestionSentenceFromReply(text);
}

function extractOfferedTopicsFromQuestion(questionText: string | null): string[] {
  const n = normText(questionText || '');
  if (!n) return [];
  const out: string[] = [];
  if (/\b(lazer|areas? de lazer|piscina|academia|playground|quadra|coworking|fireplace)\b/.test(n)) {
    out.push('lazer');
  }
  if (/\b(seguranca|portaria|monitoramento|controle de acesso)\b/.test(n)) {
    out.push('seguranca');
  }
  if (/\b(localizacao|onde fica|bairro|regiao|acesso|endereco|rodovia|atibaia|pedreira|rio abaixo)\b/.test(n)) {
    out.push('localizacao');
  }
  if (/\b(valor|valores|preco|quanto custa|r\$)\b/.test(n)) {
    out.push('valores');
  }
  if (/\b(formas? de pagamento|pagamento|entrada|parcela|parcelamento|financiamento)\b/.test(n)) {
    out.push('formas_pagamento');
  }
  return [...new Set(out)];
}

function classifyCommittedReplyQuestion(questionText: string | null): {
  questionType: CommittedReplyQuestionType;
  offeredTopics: string[];
} {
  const n = normText(questionText || '');
  if (!n) return { questionType: null, offeredTopics: [] };
  const offeredTopics = extractOfferedTopicsFromQuestion(questionText);
  return { questionType: inferCommittedQuestionType(questionText), offeredTopics };
}

function mergeAnsweredTopics(existing: string[], topic: string | null): string[] {
  const out = [...existing];
  const normalizedTopic = normText(topic || '');
  if (!normalizedTopic) return out;
  if (!out.includes(normalizedTopic)) out.push(normalizedTopic);
  return out.slice(-8);
}

function collectRecentAssistantQuestionsForFinalCheck(args: {
  flowState: CommercialFlowState;
  recentMessages: Array<{ role: string; content?: string | null }>;
}): string[] {
  const out: string[] = [];
  const pushUnique = (question: string | null | undefined): void => {
    const text = String(question ?? '').trim();
    if (!text) return;
    const key = normText(text);
    if (!key) return;
    if (out.some((existing) => normText(existing) === key)) return;
    out.push(text);
  };

  const statePolicy = (args.flowState.dialoguePolicy ?? {}) as Record<string, unknown>;
  const stateRecentQuestions = Array.isArray(statePolicy.recentQuestions)
    ? (statePolicy.recentQuestions as string[]).map((question) => String(question || '').trim()).filter(Boolean)
    : [];
  for (const question of stateRecentQuestions) pushUnique(question);
  pushUnique(String(statePolicy.lastAssistantQuestionText ?? '').trim() || null);

  const historyAssistantMessages = args.recentMessages
    .filter((msg) => msg.role === 'assistant')
    .map((msg) => String(msg.content ?? '').trim())
    .filter((text) => text.length > 0)
    .slice(-10);
  for (const assistantText of historyAssistantMessages) {
    pushUnique(extractLastQuestionSentenceFromReply(assistantText));
  }

  return out.slice(-10);
}

function pickContextualCommercialFollowupQuestion(args: {
  userMessage: string;
  recentQuestions: string[];
  topicHint?: 'first_contact' | 'location' | 'price' | 'leisure' | 'size' | null;
}): string | null {
  const userNorm = normText(args.userMessage || '');
  const byHint: string[] = [];
  if (args.topicHint === 'location') {
    byHint.push('Quer que eu te fale agora sobre valores ou lazer?');
  } else if (args.topicHint === 'price') {
    byHint.push('Quer que eu te explique também as formas de pagamento?');
  } else if (args.topicHint === 'leisure') {
    byHint.push('Quer que eu detalhe primeiro segurança ou localização?');
  } else if (args.topicHint === 'size') {
    byHint.push('Quer que eu te explique como funciona a confirmação de metragem disponível?');
  } else if (args.topicHint === 'first_contact') {
    byHint.push('Quer que eu te detalhe primeiro localização ou valores?');
  }

  const contextualByUser: string[] = [];
  const userAskedLocationLink = /\b(mapa|maps|google maps|link|localizacao exata|como chegar|manda|me envia|envia|endereco)\b/.test(userNorm);
  if (/\b(localizacao|onde fica|regiao|bairro|pedreira|rio abaixo|dom pedro)\b/.test(userNorm)) {
    contextualByUser.push(
      userAskedLocationLink
        ? 'Quer que eu te fale agora sobre valores ou lazer?'
        : 'Quer que eu te envie o link da localização?'
    );
  }
  if (/\b(valor|preco|investimento|quanto custa|m2|metro quadrado)\b/.test(userNorm)) {
    contextualByUser.push('Quer que eu te explique também as formas de pagamento?');
  }
  if (/\b(lazer|piscina|academia|playground|beach tennis|society)\b/.test(userNorm)) {
    contextualByUser.push('Quer que eu detalhe melhor a parte de segurança ou localização?');
  }
  if (/\b(metragem|tamanho|lote de \d+|m2|m²)\b/.test(userNorm)) {
    contextualByUser.push('Quer que eu te explique como funciona a confirmação de metragem disponível?');
  }

  const genericCandidates = [
    'Quer que eu te detalhe primeiro localização ou valores?',
    'Quer que eu te mostre agora localização ou lazer?',
  ];
  const candidates = [...new Set([...byHint, ...contextualByUser, ...genericCandidates])];
  for (const candidate of candidates) {
    const check = evaluateFinalQuestionCheck({
      replyText: candidate,
      recentQuestions: args.recentQuestions,
    });
    if (check.hasFinalQuestion && !check.repeatedQuestion && !check.forbiddenQuestion) {
      return candidate;
    }
  }
  return null;
}

function hasUnsupportedLocationPromise(text: string | null | undefined): boolean {
  const n = normText(String(text ?? '')).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!n) return false;
  return (
    /ponto\s+de\s+refer(?:e|ê)ncia/.test(n) ||
    /refer(?:e|ê)ncia\s+(?:no\s+)?trajeto/.test(n) ||
    /refer(?:e|ê)ncia\s+(?:pela\s+)?dom\s+pedro\s+i/.test(n) ||
    /refer(?:e|ê)ncia\s+de\s+acesso/.test(n) ||
    /posso\s+te\s+explicar\s+o\s+trajeto/.test(n)
  );
}

function pickSafeLocationPromiseReplacement(originalText: string): string {
  const n = normText(originalText || '');
  if (/\b(localizacao|onde fica|regiao|bairro|pedreira|rio abaixo|dom pedro)\b/.test(n) && !/\b(link|maps|mapa)\b/.test(n)) {
    return 'Quer que eu te envie o link da localização?';
  }
  return 'Quer que eu te fale agora sobre valores ou lazer?';
}

function sanitizeUnsupportedLocationPromiseText(text: string): { text: string; changed: boolean } {
  const raw = String(text || '').trim();
  if (!hasUnsupportedLocationPromise(raw)) return { text: raw, changed: false };

  const chunks = raw.match(/[^.!?\n]+[.!?]?|\n+/g) ?? [raw];
  const kept = chunks
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0 && !hasUnsupportedLocationPromise(chunk));
  let next = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (!next || !/\?\s*$/.test(next)) {
    next = [next, pickSafeLocationPromiseReplacement(raw)].filter(Boolean).join(' ').trim();
  }
  return { text: next, changed: true };
}

function pickEvoraFirstContactQuestion(args: {
  recentQuestions: string[];
  recentAssistantReplies: string[];
}): string {
  const canonical = 'Me conta, quais são suas dúvidas? Vou responder todas.';
  const variation = 'Você quer começar por valores, localização ou lazer?';
  const variationUsedBefore =
    args.recentQuestions.some((q) => questionsAreEquivalent(q, variation)) ||
    args.recentAssistantReplies.some((reply) => questionsAreEquivalent(extractLastQuestionSentenceFromReply(reply), variation));
  const canonicalUsedBefore =
    args.recentQuestions.some((q) => questionsAreEquivalent(q, canonical)) ||
    args.recentAssistantReplies.some((reply) => questionsAreEquivalent(extractLastQuestionSentenceFromReply(reply), canonical));
  const candidate = variationUsedBefore ? canonical : variation;
  if (variationUsedBefore && canonicalUsedBefore) return variation;
  return candidate;
}

function normalizeFirstGreetingCommittedReply(params: {
  conversationId: number;
  isFirstAnaReply: boolean;
  userMessage: string;
  parts: string[];
}): { changed: boolean; parts: string[]; text: string } {
  const userText = String(params.userMessage || '').trim();
  const firstContactEnterpriseInterest =
    params.isFirstAnaReply && isFirstContactGeneralInterestMessage(userText);
  if (firstContactEnterpriseInterest) {
    console.log('[ANA_FIRST_CONTACT_ENTERPRISE_INTEREST_DETECTED]', {
      conversationId: params.conversationId,
      source: 'committed_reply',
      userPreview: userText.slice(0, 220),
    });
  }
  const originalText = params.parts.map((part) => String(part || '').trim()).filter(Boolean).join('\n\n').trim();
  if (!params.isFirstAnaReply) {
    return { changed: false, parts: params.parts, text: originalText };
  }
  if (!originalText) {
    if (firstContactEnterpriseInterest) {
      const fallback = buildFirstGreetingSafeFallback(userText);
      console.log('[ANA_FIRST_CONTACT_EMPTY_GREETING_BLOCKED]', {
        conversationId: params.conversationId,
        source: 'committed_reply',
        reason: 'empty_reply',
        replacementPreview: fallback.slice(0, 220),
      });
      return { changed: true, parts: [fallback], text: fallback };
    }
    return { changed: false, parts: params.parts, text: originalText };
  }

  let next = originalText;
  let changed = false;
  let staleSuppressed = false;
  const forbiddenPhrasesRemoved: string[] = [];
  const stalePattern = /quer saber tamb[eé]m sobre localiza[cç][aã]o\?/i;
  if (stalePattern.test(next)) {
    next = next.replace(stalePattern, '').replace(/\s{2,}/g, ' ').trim();
    changed = true;
    staleSuppressed = true;
    forbiddenPhrasesRemoved.push('quer_saber_tambem_sobre_localizacao');
  }
  if (/\bvou responder todas\.?/i.test(next)) {
    next = next.replace(/\bvou responder todas\.?/gi, '').replace(/\s{2,}/g, ' ').trim();
    changed = true;
    forbiddenPhrasesRemoved.push('vou_responder_todas');
  }
  if (!/\?/.test(next)) {
    if (next.length > 0 && !/[.!?]$/.test(next)) {
      next = `${next}.`;
      changed = true;
    }
  }
  const firstReplyGreetingOnly = isFirstReplyGreetingOnlyMessage(next);
  const asksCustomerName = replyExplicitlyAsksCustomerName(next);
  if (firstContactEnterpriseInterest && !asksCustomerName && (firstReplyGreetingOnly || !hasEnterprisePresentationContent(next))) {
    const reason = firstReplyGreetingOnly ? 'greeting_only' : 'missing_enterprise_intro';
    const blockedPreview = next.slice(0, 220);
    next = buildFirstGreetingSafeFallback(userText);
    changed = true;
    console.log('[ANA_FIRST_CONTACT_EMPTY_GREETING_BLOCKED]', {
      conversationId: params.conversationId,
      source: 'committed_reply',
      reason,
      originalPreview: blockedPreview,
      replacementPreview: next.slice(0, 220),
    });
  }
  if (staleSuppressed) {
    console.log('[ANA_FIRST_GREETING_STALE_CTA_SUPPRESSED]', {
      conversationId: params.conversationId,
      source: 'committed_reply',
    });
  }
  if (forbiddenPhrasesRemoved.length > 0) {
    console.log('[ANA_FIRST_GREETING_FORBIDDEN_PHRASE_REMOVED]', {
      conversationId: params.conversationId,
      source: 'committed_reply',
      removed: forbiddenPhrasesRemoved,
    });
  }
  if (changed) {
    console.log('[ANA_FIRST_GREETING_FINAL_NORMALIZED]', {
      conversationId: params.conversationId,
      preview: next.slice(0, 220),
    });
  }
  return {
    changed,
    parts: next ? [next] : [],
    text: next,
  };
}

function updateConversationStateFromCommittedReply(params: {
  conversationId: number;
  flowState: CommercialFlowState;
  finalReplyParts: string[];
  finalReplyText: string;
  handler: string;
  currentTopic: AnaTurnTopic | null;
  requestedTopic: AnaTurnTopic | null;
  commercialAxis: CommercialAxis | null;
}): {
  nextState: CommercialFlowState;
  extracted: CommittedReplyStateExtraction;
} {
  const nowIso = new Date().toISOString();
  const committedReplyText =
    String(params.finalReplyText || '').trim() ||
    params.finalReplyParts.map((part) => String(part || '').trim()).filter(Boolean).join('\n\n').trim();
  const questionText = extractLastQuestionSentenceFromCommittedReply(committedReplyText);
  const question = classifyCommittedReplyQuestion(questionText);
  const questionType = question.questionType;

  let answerBody = committedReplyText;
  if (questionText) {
    const idx = answerBody.lastIndexOf(questionText);
    if (idx >= 0) {
      answerBody = `${answerBody.slice(0, idx)} ${answerBody.slice(idx + questionText.length)}`
        .replace(/\s{2,}/g, ' ')
        .trim();
    }
  }

  let detectedAnsweredTopic = detectTopicFromAssistantAnswer(answerBody);
  if (!detectedAnsweredTopic) {
    detectedAnsweredTopic = detectTopicFromAssistantAnswer(committedReplyText);
  }
  if (!detectedAnsweredTopic) {
    const requested = params.requestedTopic === 'rota' ? 'localizacao' : params.requestedTopic;
    if (requested && requested !== 'geral') detectedAnsweredTopic = requested;
  }
  if (!detectedAnsweredTopic) {
    const mappedAxisTopic = mapCommercialAxisToTurnTopic(params.commercialAxis);
    if (mappedAxisTopic && mappedAxisTopic !== 'geral') detectedAnsweredTopic = mappedAxisTopic;
  }
  if (!detectedAnsweredTopic && params.currentTopic && params.currentTopic !== 'geral') {
    detectedAnsweredTopic = params.currentTopic;
  }

  const dialoguePolicy = (params.flowState.dialoguePolicy ?? {}) as Record<string, unknown>;
  const existingAnsweredTopics = Array.isArray(dialoguePolicy.topicsAlreadyAnswered)
    ? (dialoguePolicy.topicsAlreadyAnswered as string[]).map((topic) => normText(topic || '')).filter(Boolean)
    : [];
  const existingRecentQuestions = Array.isArray(dialoguePolicy.recentQuestions)
    ? (dialoguePolicy.recentQuestions as string[]).map((question) => String(question || '').trim()).filter(Boolean)
    : [];
  const mergedAnsweredTopics = mergeAnsweredTopics(existingAnsweredTopics, detectedAnsweredTopic);
  const mergedRecentQuestions = mergeRecentQuestions(existingRecentQuestions, questionText, 8);

  const extracted: CommittedReplyStateExtraction = {
    lastAssistantQuestionText: questionText,
    lastAssistantQuestionType: questionType,
    recentQuestions: mergedRecentQuestions,
    lastOfferedTopics: question.offeredTopics,
    lastAnsweredTopic: detectedAnsweredTopic,
    topicsAlreadyAnswered: mergedAnsweredTopics,
    lastCommittedHandler: params.handler,
    lastCommittedAt: nowIso,
  };

  console.log('[ANA_COMMITTED_REPLY_STATE_EXTRACTED]', {
    conversationId: params.conversationId,
    lastAssistantQuestionText: extracted.lastAssistantQuestionText,
    lastAssistantQuestionType: extracted.lastAssistantQuestionType,
    recentQuestions: extracted.recentQuestions,
    lastOfferedTopics: extracted.lastOfferedTopics,
    lastAnsweredTopic: extracted.lastAnsweredTopic,
    handler: params.handler,
  });

  const nextState: CommercialFlowState = {
    ...params.flowState,
    dialoguePolicy: {
      ...(params.flowState.dialoguePolicy ?? {}),
      lastFollowupQuestion: extracted.lastAssistantQuestionText,
      lastAssistantQuestionText: extracted.lastAssistantQuestionText,
      lastAssistantQuestionType: extracted.lastAssistantQuestionType,
      recentQuestions: extracted.recentQuestions,
      lastOfferedTopics: extracted.lastOfferedTopics,
      lastAnsweredTopic: extracted.lastAnsweredTopic,
      topicsAlreadyAnswered: extracted.topicsAlreadyAnswered,
      lastCommittedHandler: extracted.lastCommittedHandler,
      lastCommittedAt: extracted.lastCommittedAt,
    },
    updatedAt: nowIso,
  };

  return { nextState, extracted };
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

function isKnowledgeDependentRequest(message: string, axis: CommercialAxis | null): boolean {
  if (axis != null) return true;
  const n = normText(message || '');
  if (!n) return false;
  return (
    /\b(empreendimento|loteamento|localizacao|lazer|seguranca|portaria|valor|preco|metragem|estrutura|condic(?:ao|oes)|rodovia|atibaia|pedreira)\b/.test(
      n
    )
  );
}

function buildCanonicalSafeReplyForMissingRag(params: {
  axis: CommercialAxis | null;
  isEvora: boolean;
}): string {
  void params;
  return ANA_LLM_FIRST_MISSING_INFO_REPLY;
}

function isLlmFirstCommercialTurn(params: {
  isEvora: boolean;
  userMessage: string;
  requestedAxis: CommercialAxis | null;
  requestedTopic: AnaTurnTopic | null;
}): boolean {
  if (!ANA_LLM_FIRST_COMMERCIAL_REPLIES || !params.isEvora) return false;
  if (params.requestedAxis != null) return true;
  if (params.requestedTopic != null && !['visita', 'corretor', 'rota'].includes(params.requestedTopic)) return true;
  const n = normText(params.userMessage || '');
  return /\b(queria saber mais|quero saber mais|tenho interesse|me fala mais|evora|empreendimento|loteamento|morar|moradia|investir|investimento|lazer|regiao|localizacao|valor|preco|pagamento|seguranca|obras|condominio)\b/.test(n);
}



function buildInitialDiscoveryGuidanceContext(params: {
  isEvora: boolean;
  state: ReturnType<typeof getLeadQualificationState>;
  customerName?: string | null;
  nameCapturedThisTurn: boolean;
  userMessage: string;
  recentAssistantCount: number;
}): string | null {
  if (!params.isEvora) return null;

  const state = params.state;
  const knownName = String(params.customerName ?? state.customerName ?? state.name ?? '').trim();
  const hasName = Boolean(knownName) || state.nameCollected === true;
  if (!hasName) return null;

  const earlyConversation = params.nameCapturedThisTurn || params.recentAssistantCount <= 4;
  if (!earlyConversation) return null;

  const hasPurpose = state.purpose != null;
  const hasProductFit = state.productFit != null;
  const currentUserHasObjectiveQuestion = isObjectiveCustomerQuestion(params.userMessage);
  const nameJustCapturedWithoutPurpose = params.nameCapturedThisTurn && !hasPurpose;
  const lifestyleSignal =
    /\b(calmaria|calma|tranquilidade|tranquilo|paz|sossego|natureza|verde|lazer|família|familia|qualidade de vida|descanso|segurança|seguranca)\b/i.test(
      params.userMessage
    );

  const nextDiscovery =
    !hasPurpose
      ? 'Próxima descoberta preferencial: entender se o cliente pensa em morar, investir ou ainda está conhecendo as possibilidades.'
      : !hasProductFit
        ? 'Próxima descoberta preferencial: entender se ele já decidiu por loteamento fechado ou ainda está comparando com outros tipos de imóvel.'
        : 'Próxima descoberta preferencial: entender tamanho, perfil de lote desejado ou critério de decisão, somente se isso couber naturalmente.';

  return [
    '[ORIENTAÇÃO DE DESCOBERTA INICIAL - NÃO MOSTRAR AO CLIENTE]',
    'Isto não é fallback, não é resposta pronta e não deve interceptar o LLM.',
    'Use apenas como ponto de partida conversacional depois da captura do nome.',
    knownName ? `Nome conhecido do cliente: ${knownName}.` : 'Nome do cliente já foi capturado.',
    nextDiscovery,
    nameJustCapturedWithoutPurpose
      ? 'Quando o nome acabou de ser capturado e a intenção ainda não está clara, comece com uma saudação completa e natural, por exemplo: "Prazer, [Nome]!" ou "Prazer, [Nome], tudo bem?". Não responda apenas o nome isolado.'
      : null,
    nameJustCapturedWithoutPurpose
      ? 'Depois da saudação, explique em uma frase curta que vai fazer algumas perguntas rápidas para entender melhor o momento do cliente.'
      : null,
    nameJustCapturedWithoutPurpose
      ? 'A primeira pergunta de descoberta deve ser sobre intenção: morar, investir ou ainda conhecer as possibilidades. Não substitua essa primeira pergunta por "você já visitou algum loteamento?" ou pergunta parecida.'
      : null,
    'Tópicos sugeridos para descoberta: intenção de compra/moradia/investimento; decisão por loteamento fechado; tamanho ou perfil de lote desejado.',
    lifestyleSignal
      ? 'O cliente trouxe sinal de estilo de vida/desejo emocional. Antes de listar itens, acolha com uma frase consultiva e humana, conectando o desejo dele ao Évora. Exemplo de tom: "Faz sentido, [Nome]. Para quem busca calmaria sem abrir mão de lazer, o Évora conversa bem com esse perfil." Depois traga os fatos autorizados.'
      : null,
    lifestyleSignal
      ? 'Evite resposta seca em formato apenas informativo. Não comece direto com "Tem uma estrutura..." quando o cliente falar desejos como calmaria, lazer, tranquilidade, natureza ou família.'
      : null,
    currentUserHasObjectiveQuestion
      ? 'A mensagem atual do cliente contém pergunta objetiva. Responda primeiro a pergunta dele com base nas evidências e, se natural, avance com apenas UMA pergunta de descoberta.'
      : 'Se a mensagem atual não traz pergunta objetiva, conduza com UMA pergunta inicial de descoberta, em tom natural.',
    'Se o cliente responder apenas "sim" a uma pergunta com duas opções, não troque as opções. Retome as opções exatas ou escolha a continuidade mais natural pelo histórico.',
    'Não pergunte todos os tópicos de uma vez.',
    'Não copie literalmente um roteiro fixo. Varie a formulação conforme o histórico.',
    'Não invente informação comercial. Se faltar dado confirmado, ofereça corretor ou visita de forma natural.',
    '[/ORIENTAÇÃO DE DESCOBERTA INICIAL]',
  ]
    .filter((line): line is string => Boolean(line && line.trim()))
    .join('\n');
}

function isInitialQualificationClarificationMessage(text: string | null | undefined): boolean {
  const n = normText(text || '').replace(/[.!?]+$/g, '').trim();
  if (!n) return false;
  return (
    /^(nao entendi|nao entendi nada|como assim|como assim|pode explicar|pode explicar melhor|explica melhor|me explica melhor)$/.test(n) ||
    /\b(nao entendi|não entendi|como assim|pode explicar|explica melhor)\b/.test(String(text || '').toLowerCase())
  );
}

function buildInitialQualificationClarificationReply(params: {
  lastAssistantMessage?: string | null;
  state: ReturnType<typeof getLeadQualificationState>;
}): string {
  const last = normText(params.lastAssistantMessage || '');
  if (!params.state.nameCollected && /\b(nome|como posso te chamar|me conta seu nome)\b/.test(last)) {
    return [
      'Sem problema, eu explico melhor.',
      'Eu pergunto seu nome só para te atender de forma mais organizada por aqui.',
      'Como posso te chamar?',
    ].join('\n\n');
  }
  return [
    'Sem problema, eu explico melhor.',
    'Vou te fazer perguntas simples para entender o que você procura e te passar as informações certas do Évora.',
    'Você está olhando mais para morar, investir ou só conhecendo por enquanto?',
  ].join('\n\n');
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
  return 'Esses são os itens de lazer disponíveis na base do Évora. Também posso te explicar sobre valores, localização, segurança ou formas de pagamento.';
}

function buildOnlyNewLazerItemsReply(newItems: string[]): string {
  void newItems;
  return '';
}

function isLocationLinkRequest(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return /\b(tem o link da localizacao|tem link da localizacao|link da localizacao|link de localizacao|link com a localizacao|google maps|maps|mapa|rota|como chegar|manda localizacao|manda a localizacao|manda a localizacao pfv|me envia a localizacao|me envia localizacao|me manda localizacao|me manda a localizacao|nao entendi onde fica|localizacao exata|endereco com numero|tem numero|numero do endereco|tem o endereco|me passa o endereco|qual o endereco)\b/.test(
    n
  );
}

function isImageMaterialRequest(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return (
    /\b(foto|fotos|imagem|imagens|manda foto|tem foto|quero ver|galeria)\b/.test(n) ||
    userAskedForSpecificImageFilenameTopic(text)
  );
}

function isVideoMaterialRequest(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return /\b(video|videos|vídeo|vídeos|manda video|manda vídeo|tem video|tem vídeo|tour|video do empreendimento|vídeo do empreendimento|quero ver o empreendimento)\b/.test(n);
}

function isProactiveVideoOfferIntent(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return /\b(visao geral|visão geral|lazer|fotos|imagens|localizacao|localização|quero ver|me mostra|como e|como é|tem video|tem vídeo)\b/.test(n);
}

function pickAuthorizedLocationLink(vars: Record<string, unknown>): string | null {
  const entries = Object.entries(vars || {});
  const normalizedKey = (key: string): string =>
    normText(key)
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  const exactPriorityKeys = new Set([
    'google_maps_url',
    'location_url',
    'maps_url',
    'localizacao_link',
    'localizacao_url',
    'link_localizacao',
    'link_google_maps',
    'endereco_google_maps',
    'exact_location_url',
    'exact_location',
    'exactlocation',
    'localizacao_exata',
    'mapa_url',
  ]);
  const exactPriorityCandidates = entries.filter(([k, v]) => {
    const key = normalizedKey(k);
    const val = String(v ?? '').trim();
    if (!val || !/^https?:\/\//i.test(val)) return false;
    return exactPriorityKeys.has(key);
  });
  if (exactPriorityCandidates[0]?.[1]) return String(exactPriorityCandidates[0][1]).trim();

  const candidates = entries.filter(([k, v]) => {
    const key = normalizedKey(k);
    const val = String(v ?? '').trim();
    if (!val) return false;
    if (!/^https?:\/\//i.test(val)) return false;
    return /(mapa|maps|localizacao|google|endereco|rota|exact_location|exactlocation)/.test(key);
  });
  return candidates[0]?.[1] ? String(candidates[0][1]).trim() : null;
}

function pickAuthorizedLocationAddress(vars: Record<string, unknown>): {
  addressComplete: string | null;
  addressNumber: string | null;
} {
  const entries = Object.entries(vars || {}).map(([key, value]) => [normText(key), String(value ?? '').trim()] as const);
  const findValue = (keys: string[]): string | null => {
    for (const key of keys) {
      const found = entries.find(([k, v]) => k === key && v.length > 0);
      if (found?.[1]) return found[1];
    }
    return null;
  };

  return {
    addressComplete: findValue(['endereco_completo', 'endereco', 'address_full']),
    addressNumber: findValue(['endereco_numero', 'numero_endereco', 'address_number']),
  };
}

function buildEvoraLocationOverview(args: {
  addressComplete?: string | null;
  addressNumber?: string | null;
}): string {
  const canonicalBase =
    'O Evora fica em Atibaia, na regiao da Pedreira/Rio Abaixo, com acesso pela Rodovia Dom Pedro I, a cerca de 50 minutos de Sao Paulo, em uma regiao com qualidade de vida e contato com a natureza.';
  const addressComplete = String(args.addressComplete ?? '').trim();
  const addressNumber = String(args.addressNumber ?? '').trim();
  if (addressComplete) {
    const addressLabel =
      addressNumber && !addressComplete.includes(addressNumber)
        ? `${addressComplete}, numero ${addressNumber}`
        : addressComplete;
    return `${canonicalBase} Endereco de referencia: ${addressLabel}.`;
  }
  return canonicalBase;
}

function buildEvoraRegionCanonicalReply(): string {
  return 'O Évora fica em Atibaia, na região da Pedreira/Rio Abaixo, com fácil acesso pela Rodovia Dom Pedro I e a aproximadamente 50 minutos de São Paulo. É uma região com perfil mais tranquilo, contato com natureza e boa qualidade de vida.';
}

function buildEvoraAddressCanonicalReply(): string {
  return 'Fica na Estrada dos Pires, s/n, na região da Pedreira, bairro Rio Abaixo, em Atibaia.';
}

function getEvoraCanonicalMapsLink(): string {
  return 'https://maps.app.goo.gl/jBoxPM6XRut2iXHSA?g_st=ic';
}

function pickLocationLinkFromKnowledge(knowledgeText: string): string | null {
  const raw = String(knowledgeText || '');
  if (!raw.trim()) return null;
  const match = raw.match(/https?:\/\/(?:maps\.app\.goo\.gl|(?:www\.)?google\.[^/\s]+\/maps|maps\.google\.[^/\s]+)[^\s)]+/i);
  return match?.[0]?.trim() || null;
}

function sanitizeEvoraRestrictedKnowledgeForAna(text: string): string {
  return String(text || '')
    .replace(/^Quantidade total de lotes:\s*\d+\s*$/gim, 'Quantidade total de lotes: informação tratada pelo corretor')
    .replace(/\b145\s+lotes\b/gi, 'quantidade de lotes tratada pelo corretor');
}

export const __testOnlySanitizeEvoraRestrictedKnowledgeForAna = sanitizeEvoraRestrictedKnowledgeForAna;

function hasConversationalUnsupportedPromise(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  return (
    /(vamos detalhar|detalhar um pouco mais|posso detalhar|te passo|posso te passar|te envio|posso enviar)/.test(n) ||
    /refer(?:e|ê)ncia\s+de\s+acesso/.test(n) ||
    hasUnsupportedLocationPromise(n)
  );
}

function isBrokenEnumeratedReply(text: string): boolean {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return false;
  const last = lines[lines.length - 1] ?? '';
  if (/^(?:-|\*|•)$/.test(last)) return true;
  if (/^\d+\s*[.:)]\s*$/.test(last)) return true;
  return false;
}

function countEvoraRegionCoreSignals(text: string): number {
  const n = normalizeAnaLocalTextForRules(text || '');
  if (!n) return 0;
  const checks = [
    /\batibaia\b/.test(n),
    /\bpedreira\b/.test(n) && /\brio abaixo\b/.test(n),
    /\bdom pedro i\b/.test(n),
    /\b50\b/.test(n) && /\bminutos\b/.test(n) && /\bsao paulo\b/.test(n),
    /\b(qualidade de vida|natureza|perfil mais tranquilo|contato com natureza)\b/.test(n),
  ];
  return checks.filter(Boolean).length;
}

function dedupeMessageParts(parts: string[], logContext: { conversationId: number; stage: string }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const accepted: string[] = [];

  const tokenize = (value: string): string[] =>
    normalizeAnaLocalTextForRules(value)
      .replace(/[.!?,;:()/\\[\]{}"'`´~^*+-]+/g, ' ')
      .split(/\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 3);

  const jaccard = (a: string[], b: string[]): number => {
    if (a.length === 0 || b.length === 0) return 0;
    const sa = new Set(a);
    const sb = new Set(b);
    let inter = 0;
    for (const token of sa) {
      if (sb.has(token)) inter += 1;
    }
    const union = new Set([...sa, ...sb]).size;
    return union === 0 ? 0 : inter / union;
  };

  const isNearDuplicate = (candidate: string, existing: string): boolean => {
    const cNorm = normalizeAnaLocalTextForRules(candidate).replace(/[.!?]+$/g, '').trim();
    const eNorm = normalizeAnaLocalTextForRules(existing).replace(/[.!?]+$/g, '').trim();
    if (!cNorm || !eNorm) return false;
    if (cNorm === eNorm) return true;
    if ((cNorm.includes(eNorm) || eNorm.includes(cNorm)) && Math.min(cNorm.length, eNorm.length) >= 24) {
      return true;
    }
    return jaccard(tokenize(cNorm), tokenize(eNorm)) >= 0.9;
  };

  for (const raw of parts) {
    const clean = (raw || '').trim();
    if (!clean) continue;
    const key = normalizeAnaLocalTextForRules(clean).replace(/[.!?]+$/g, '').trim();
    const regionCoreDuplicate = accepted.some((prev) => {
      const prevCore = countEvoraRegionCoreSignals(prev);
      const nextCore = countEvoraRegionCoreSignals(clean);
      return prevCore >= 4 && nextCore >= 4;
    });
    if (regionCoreDuplicate) {
      console.log('[ANA_REGION_DUPLICATE_MESSAGE_BLOCKED]', {
        conversationId: logContext.conversationId,
        blockedMessagePreview: clean.slice(0, 160),
      });
      continue;
    }
    if (seen.has(key) || accepted.some((prev) => isNearDuplicate(clean, prev))) {
      console.log('[ANA_DUPLICATE_RESPONSE_PART_SUPPRESSED]', {
        conversationId: logContext.conversationId,
        stage: logContext.stage,
        suppressedPreview: clean.slice(0, 120),
      });
      continue;
    }
    seen.add(key);
    accepted.push(clean);
    out.push(clean);
  }
  return out;
}

function scrubClientVisibleBrandLeak(text: string): string {
  return String(text || '')
    .replace(/\bANA\s*[-–—]\s*NETIV\s*[-–—]\s*QMAPE\b/gi, 'Ana')
    .replace(/\bNETIV\s*[-–—]\s*QMAPE\b/gi, '')
    .replace(/\bQMAPE\s*[-–—]\s*NETIV\b/gi, '')
    .replace(/\bNETIV\b/gi, '')
    .replace(/\bQMAPE\b/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function splitRhetoricalSeparatorsForWhatsApp(part: string): string[] {
  const source = scrubClientVisibleBrandLeak(part)
    .replace(/^[ \t]*[-–—]\s+/gm, '')
    .trim();
  if (!source) return [];
  const pieces: string[] = [];
  let current = '';
  const separator = /\s+(?:—|–|-)\s+/g;
  let lastIndex = 0;
  for (const match of source.matchAll(separator)) {
    const before = source.slice(lastIndex, match.index).trim();
    const afterStart = (match.index ?? 0) + match[0].length;
    if (current) current = `${current} ${before}`.trim();
    else current = before;
    const nextSeparatorIndex = source.slice(afterStart).search(separator);
    const after =
      nextSeparatorIndex >= 0
        ? source.slice(afterStart, afterStart + nextSeparatorIndex).trim()
        : source.slice(afterStart).trim();
    const leftIsShortOpener = current.length <= 16 && /^[A-Za-zÀ-ÿ]+\.?$/i.test(current);
    if (leftIsShortOpener && after) {
      current = `${current.replace(/[.]$/g, '')},`;
    } else if (current) {
      pieces.push(current);
      current = '';
    }
    lastIndex = afterStart;
  }
  const tail = source.slice(lastIndex).trim();
  const finalPiece = [current, tail].filter(Boolean).join(' ').replace(/\s+,/g, ',').trim();
  if (finalPiece) pieces.push(finalPiece);
  return pieces.length > 0 ? pieces : [source];
}

function startsWithLowercaseLetter(text: string): boolean {
  if (/^https?:\/\//i.test(String(text || '').trim())) return false;
  const first = String(text || '').trim().match(/\p{L}/u)?.[0] ?? '';
  return Boolean(first && first === first.toLocaleLowerCase('pt-BR') && first !== first.toLocaleUpperCase('pt-BR'));
}

function uppercaseFirstLetter(text: string): string {
  const raw = String(text || '').trim();
  const match = raw.match(/\p{L}/u);
  if (!match || match.index == null) return raw;
  const idx = match.index;
  return `${raw.slice(0, idx)}${match[0].toLocaleUpperCase('pt-BR')}${raw.slice(idx + match[0].length)}`;
}

function isShortOpeningPart(text: string): boolean {
  const clean = String(text || '').trim();
  const withoutPunctuation = clean.replace(/[.!?]+$/g, '').trim();
  if (!withoutPunctuation) return false;
  if (withoutPunctuation.length > 32 || withoutPunctuation.split(/\s+/).length > 4) return false;
  return /^(entendo|perfeito|certo|claro|legal|ótimo|otimo|faz sentido|combinado|sim|ok)\b/i.test(withoutPunctuation);
}

function repairAnaOutboundSplitParts(parts: string[]): string[] {
  const out: string[] = [];
  for (const raw of parts) {
    const part = sanitizeAnaClientVisibleReplyText(raw);
    if (!part) continue;
    if (out.length === 0 && startsWithLowercaseLetter(part)) {
      out.push(uppercaseFirstLetter(part));
      continue;
    }
    if (out.length > 0 && startsWithLowercaseLetter(part)) {
      const previous = out[out.length - 1] ?? '';
      if (isShortOpeningPart(previous)) {
        out[out.length - 1] = `${previous.replace(/[.!?]+$/g, '')}, ${part}`.replace(/\s{2,}/g, ' ').trim();
        continue;
      }
      out.push(uppercaseFirstLetter(part));
      continue;
    }
    out.push(part);
  }
  return out;
}

function splitAnaOutboundMessages(text: string): string[] {
  const rawParts = String(text || '')
    .split(/\r?\n+/)
    .flatMap((part) => splitRhetoricalSeparatorsForWhatsApp(part))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return repairAnaOutboundSplitParts(rawParts);
}

export const __testOnlySplitAnaOutboundMessages = splitAnaOutboundMessages;

async function sendAnaOutboundMessages(params: {
  conversationId: number;
  toPhoneNumber: string;
  phase: string;
  text: string;
  replyPipelineToken?: number;
}): Promise<{
  success: boolean;
  metaMessageIds: string[];
  messageIds: number[];
  sentParts: string[];
  error?: string;
  code?: string | number | null;
}> {
  const messageParts = splitAnaOutboundMessages(params.text);
  console.log('[ANA_REPLY_GENERATED]', {
    conversationId: params.conversationId,
    phase: params.phase,
    replyLen: String(params.text ?? '').trim().length,
    partsCount: messageParts.length,
  });
  if (messageParts.length === 0) {
    console.log('[ANA_REPLY_SEND_RESULT]', {
      conversationId: params.conversationId,
      phase: params.phase,
      success: false,
      reason: 'empty_outbound_parts',
      partsSent: 0,
    });
    return { success: false, metaMessageIds: [], messageIds: [], sentParts: [], error: 'empty_outbound_parts' };
  }
  console.log('[ANA_REPLY_SEND_ATTEMPT]', {
    conversationId: params.conversationId,
    phase: params.phase,
    toPhoneTail: anaPhoneTail(params.toPhoneNumber),
    partsCount: messageParts.length,
  });
  const metaMessageIds: string[] = [];
  const messageIds: number[] = [];
  const sentParts: string[] = [];
  for (const part of messageParts) {
    if (isPipelineStale(params.conversationId, params.replyPipelineToken)) {
      console.log('[ANA_REPLY_SEND_RESULT]', {
        conversationId: params.conversationId,
        phase: params.phase,
        success: false,
        reason: 'pipeline_stale_before_split_outbound_part',
        partsSent: sentParts.length,
      });
      return {
        success: false,
        metaMessageIds,
        messageIds,
        sentParts,
        error: 'pipeline_stale_before_split_outbound_part',
        code: 'PIPELINE_STALE',
      };
    }
    const sendResult = await sendTextMessage({
      conversationId: params.conversationId,
      to: params.toPhoneNumber,
      text: part,
      phase: params.phase,
    });
    if (!sendResult.success || !sendResult.metaMessageId) {
      console.log('[ANA_REPLY_SEND_RESULT]', {
        conversationId: params.conversationId,
        phase: params.phase,
        success: false,
        reason: sendResult.error ?? 'send_failed',
        code: sendResult.code ?? null,
        partsSent: sentParts.length,
      });
      return {
        success: false,
        metaMessageIds,
        messageIds,
        sentParts,
        error: sendResult.error ?? 'send_failed',
        code: sendResult.code ?? null,
      };
    }
    metaMessageIds.push(sendResult.metaMessageId);
    sentParts.push(part);
    const inserted = await insertMessage(params.conversationId, 'assistant', part, sendResult.metaMessageId);
    messageIds.push(inserted.id);
  }
  console.log('[ANA_REPLY_SEND_RESULT]', {
    conversationId: params.conversationId,
    phase: params.phase,
    success: true,
    partsSent: sentParts.length,
    outboundMetaMessageIds: metaMessageIds,
  });
  return { success: true, metaMessageIds, messageIds, sentParts };
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
  const prohibitedPatternFragments: RegExp[] = [
    new RegExp(['desculpe', 'parece que sua resposta', 'nao esta clara'].join('.*')),
    new RegExp(
      ['voce poderia escolher', 'encaminhamento', 'corretor', 'agendamento', 'visita'].join('.*')
    ),
    new RegExp(['tem', 'algum', 'ponto', 'especific', 'gostaria de saber primeiro'].join('.*')),
  ];
  if (prohibitedPatternFragments.some((pattern) => pattern.test(n))) return true;
  return [
    'posso te responder de forma mais objetiva nesse ponto',
    'posso te explicar os principais pontos por aqui de forma objetiva',
    'posso te ajudar com informacoes comerciais',
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
    blocks.push(ANA_LLM_FIRST_MISSING_INFO_REPLY);
    console.log('ANA_UNSUPPORTED_DETAIL_ROUTED_TO_BROKER', {
      detailType: 'pricing_or_availability_or_custom_condition',
    });
  }

  if (blocks.length === 0) {
    blocks.push(ANA_LLM_FIRST_MISSING_INFO_REPLY);
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

function isLocalOrCustomProviderContext(baseUrl: string | null | undefined): boolean {
  const provider = detectLlmProvider(baseUrl ?? null);
  return provider !== 'openai' && provider !== 'openrouter';
}

function isQwenLikeModel(model: string | null | undefined): boolean {
  const normalized = String(model ?? '').trim().toLowerCase();
  return (
    normalized.startsWith('qwen') ||
    normalized.startsWith('ana-qwen') ||
    normalized.startsWith('ana-evora-qwen')
  );
}

function sanitizeQwenRecoveryText(raw: string): string {
  const forbidden =
    /\b(netiv|log|logs|erro|error|openai|qwen|json|sistema|prompt|ferramenta|instru[cç][aã]o(?:\s+interna)?)\b/i;
  const lines = String(raw ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`/g, ' ')
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !forbidden.test(line));
  return lines.join('\n').replace(/\s{2,}/g, ' ').trim().slice(0, 4000);
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

function stripInappropriateVisitOffer(text: string): { text: string; removed: boolean } {
  const patterns = [
    /que tal marcarmos uma visita\??/gi,
    /quer que eu te ajude a agendar uma visita\??/gi,
    /prefere agendar uma visita\??/gi,
    /vamos marcar uma visita\??/gi,
  ];
  let out = text;
  for (const pattern of patterns) out = out.replace(pattern, '');
  out = out.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, removed: out !== text.trim() };
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

const MAX_HISTORY = 6;
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

const HANDOFF_INTENT_REGEX_PATTERNS: RegExp[] = [
  /\bcorretor(?:a)?\b/,
  /\bconsultor(?:a)?\b/,
  /\bquero\s+corretor(?:a)?\b/,
  /\bquero\s+falar\s+com\s+(?:um|uma)?\s*(?:corretor(?:a)?|consultor(?:a)?)\b/,
  /\bfalar\s+com\s+(?:um|uma)?\s*(?:corretor(?:a)?|consultor(?:a)?)\b/,
  /\bme\s+(?:passa|encaminha|transfere)\s+(?:pra|para)?\s*(?:um|uma)?\s*(?:corretor(?:a)?|consultor(?:a)?)\b/,
  /\batendimento\s+humano\b/,
  /\bquero\s+falar\s+com\s+(?:uma)?\s*pessoa\b/,
];

function normText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
}

function formatYmdForAnaVisitAvailability(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APPOINTMENT_BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function addDaysYmdForAnaVisitAvailability(ymd: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const base = new Date(`${ymd}T12:00:00-03:00`);
  if (Number.isNaN(base.getTime())) return null;
  base.setTime(base.getTime() + days * 86_400_000);
  return formatYmdForAnaVisitAvailability(base);
}

function containsForbiddenMissingDetailFallbackText(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  const patterns = [
    new RegExp(['nao tenho esse', 'detalhe confirmado', 'por aqui'].join('\\s+')),
    new RegExp([
      ['o', 'corretor', 'consegue'].join('\\s+'),
      ['te', 'passar'].join('\\s+'),
      'certinho',
    ].join('\\s+')),
    new RegExp(['quer que eu te', 'encaminhe ou prefere', 'agendar uma visita'].join('\\s+')),
  ];
  return patterns.some((pattern) => pattern.test(n));
}

function normalizeIntentText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  /resposta fixa deterministica/i,
  /pergunta aberta e natural/i,
  /\bfinalizar com\b/i,
  /\binstrucao interna\b/i,
  /\bprompt\b/i,
  /\bsistema\b/i,
  /\bjson\b/i,
  /\bferramenta\b/i,
];

const ANA_INTERNAL_SANITIZE_PATTERNS: RegExp[] = [
  /finalizar\s+com\s+pergunta\s+aberta(?:\s+e\s+natural)?[,]?\s*/gi,
  /sem\s+resposta\s+fixa\s+determin[ií]stic[ao]\.?[,]?\s*/gi,
  /sem\s+resposta\s+fixa\s+determin[\wÃÂáàâãéêíóôõúç]*[,]?\s*/gi,
  /resposta\s+fixa\s+determin[ií]stic[ao]\.?[,]?\s*/gi,
  /resposta\s+fixa\s+determin[\wÃÂáàâãéêíóôõúç]*[,]?\s*/gi,
  /instrucao interna[,]?\s*/gi,
  /\bprompt\b[,]?\s*/gi,
  /\bsistema\b[,]?\s*/gi,
  /\bjson\b[,]?\s*/gi,
  /\bferramenta\b[,]?\s*/gi,
];

function sanitizeInternalInstructionLeakText(text: string): { text: string; changed: boolean } {
  let out = text || '';
  for (const pattern of ANA_INTERNAL_SANITIZE_PATTERNS) out = out.replace(pattern, ' ');
  out = out.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, changed: out !== (text || '').trim() };
}

function buildCanonicalLazerFullReply(): string {
  return [
    'As áreas de lazer do Évora incluem:',
    'Piscina adulto',
    'Academia',
    'Salão de festas',
    'Playground',
    'Coworking',
    'Espaço zen',
    'Fireplace',
    'Quadra de beach tennis',
    'Campo society',
    'Estação para carros elétricos',
    'Portaria 24h com controle de acesso.',
  ].join('\n');
}

function hasAnaInternalInstructionLeak(text: string): boolean {
  const normalized = normText(text || '');
  if (!normalized) return false;
  return ANA_INTERNAL_LEAK_PATTERNS.some((re) => re.test(normalized));
}

function hasExplicitHandoffIntent(message: string): boolean {
  const normalized = normalizeIntentText(message);
  if (!normalized) return false;
  return HANDOFF_INTENT_REGEX_PATTERNS.some((re) => re.test(normalized));
}

function buildEvoraFirstReplySafeFallback(): string {
  return buildLeadQualificationNameQuestion();
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

function shouldUseAnaNoEnterpriseGlobalMode(params: {
  enterpriseIdForAi: number | null;
  conversationEnterpriseId: number | null;
  resolvedEnterpriseId: number | null;
  aiSettings: ResolvedEnterpriseAiSettings;
}): boolean {
  return (
    params.enterpriseIdForAi == null &&
    params.conversationEnterpriseId == null &&
    params.resolvedEnterpriseId == null &&
    !params.aiSettings.blocked &&
    params.aiSettings.aiEnabled === true &&
    Boolean(params.aiSettings.openaiApiKey) &&
    params.aiSettings.useGlobalDefaults === true
  );
}

export const __testOnlyShouldUseAnaNoEnterpriseGlobalMode = shouldUseAnaNoEnterpriseGlobalMode;

type AnaGlobalNoEnterpriseMentionGuardResult =
  | {
      changed: false;
      text: string;
      enterpriseName: null;
    }
  | {
      changed: true;
      text: string;
      enterpriseName: string;
    };

const ANA_ENTERPRISE_NAME_GENERIC_TOKENS = new Set([
  'residencial',
  'empreendimento',
  'loteamento',
  'loteamentos',
  'condominio',
  'condominios',
  'edificio',
  'parque',
  'jardim',
  'village',
  'park',
  'club',
  'fase',
  'torre',
  'bloco',
]);

function normalizeEnterpriseMentionGuardText(value: string): string {
  return normText(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function enterpriseMentionNeedles(enterpriseName: string): string[] {
  const normalizedName = normalizeEnterpriseMentionGuardText(enterpriseName);
  const needles = new Set<string>();
  if (normalizedName.length >= 4) needles.add(normalizedName);
  for (const token of normalizedName.split(/\s+/).filter(Boolean)) {
    if (token.length < 4) continue;
    if (ANA_ENTERPRISE_NAME_GENERIC_TOKENS.has(token)) continue;
    needles.add(token);
  }
  return Array.from(needles);
}

function normalizedTextContainsNeedle(text: string, needle: string): boolean {
  if (!text || !needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(text);
}

function findUnsupportedEnterpriseMentionInGlobalNoEnterpriseReply(params: {
  replyText: string;
  userMessage: string;
  activeEnterprises: EnterpriseRow[];
}): EnterpriseRow | null {
  const replyNorm = normalizeEnterpriseMentionGuardText(params.replyText);
  const userNorm = normalizeEnterpriseMentionGuardText(params.userMessage);
  if (!replyNorm) return null;
  for (const enterprise of params.activeEnterprises) {
    const needles = enterpriseMentionNeedles(enterprise.name);
    if (needles.length === 0) continue;
    const mentionedInReply = needles.some((needle) => normalizedTextContainsNeedle(replyNorm, needle));
    if (!mentionedInReply) continue;
    const mentionedByUser = needles.some((needle) => normalizedTextContainsNeedle(userNorm, needle));
    if (mentionedByUser) continue;
    return enterprise;
  }
  return null;
}

function applyGlobalNoEnterpriseUnsupportedEnterpriseMentionGuard(params: {
  globalNoEnterpriseMode: boolean;
  replyText: string;
  userMessage: string;
  activeEnterprises: EnterpriseRow[];
}): AnaGlobalNoEnterpriseMentionGuardResult {
  if (!params.globalNoEnterpriseMode) {
    return { changed: false, text: params.replyText, enterpriseName: null };
  }
  const unsupportedEnterprise = findUnsupportedEnterpriseMentionInGlobalNoEnterpriseReply({
    replyText: params.replyText,
    userMessage: params.userMessage,
    activeEnterprises: params.activeEnterprises,
  });
  if (!unsupportedEnterprise) {
    return { changed: false, text: params.replyText, enterpriseName: null };
  }
  return {
    changed: true,
    text: ANA_GLOBAL_NO_ENTERPRISE_SAFE_DISCOVERY_REPLY,
    enterpriseName: unsupportedEnterprise.name,
  };
}

export const __testOnlyApplyGlobalNoEnterpriseUnsupportedEnterpriseMentionGuard =
  applyGlobalNoEnterpriseUnsupportedEnterpriseMentionGuard;

function buildGlobalNoEnterpriseOperationalContext(params: {
  enterpriseResolution: AnaEnterpriseResolution;
  activeEnterpriseNames: string[];
  requestedProductType: string | null | undefined;
}): string {
  const candidateLine =
    params.enterpriseResolution.source === 'ambiguous' && params.enterpriseResolution.candidates.length > 0
      ? 'Ha candidatos possiveis, mas sem confianca suficiente para citar nomes. Peca ao cliente confirmar o empreendimento ou regiao.'
      : 'Nenhum empreendimento foi identificado com seguranca nesta mensagem.';
  const portfolioLine =
    params.activeEnterpriseNames.length > 0
      ? 'Existe portfolio ativo, mas seus nomes nao devem ser citados neste turno sem mencao explicita do cliente.'
      : 'Portfolio ativo nao carregado para este turno.';
  return [
    '[CONTEXTO OPERACIONAL - NAO MOSTRAR AO CLIENTE]',
    'A conversa ainda nao tem empreendimento resolvido. Use atendimento global da Ana, sem RAG especifico de empreendimento.',
    'Nao assuma Evora, nao assuma nenhum primeiro empreendimento da lista e nao use nomes do portfolio como contexto principal.',
    'Nao invente dados de empreendimento, valores, endereco, planta, disponibilidade, prazos ou condicoes.',
    'Nao mencione nome de empreendimento especifico, a menos que o cliente tenha citado explicitamente esse nome no turno atual.',
    'Nao acione handoff automatico so porque o empreendimento nao foi resolvido.',
    'Objetivo deste turno: entender naturalmente qual empreendimento, regiao, tipo de planta/imovel, orcamento ou intencao o cliente busca.',
    `Resposta segura quando o cliente pedir informacoes gerais sem empreendimento: "${ANA_GLOBAL_NO_ENTERPRISE_SAFE_DISCOVERY_REPLY}"`,
    'Se o texto do cliente permitir uma inferencia clara, responda conduzindo essa confirmacao. Se ainda nao permitir, faca uma pergunta curta de qualificacao.',
    'Responda em texto livre, comercial e humano, com no maximo uma pergunta.',
    `Tipo de interesse inferido pelo backend: ${params.requestedProductType || 'INDEFINIDO'}.`,
    candidateLine,
    portfolioLine,
    `Motivo de nao resolucao: ${params.enterpriseResolution.reasonWhenNoEnterprise ?? 'nao informado'}.`,
    '[/CONTEXTO OPERACIONAL]',
  ].join('\n');
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

function isAffirmativeShortReply(message: string): boolean {
  const n = normText(message).replace(/[.!?]+$/g, '').trim();
  return /^(sim|quero|quero sim|ok|pode ser|pode sim|claro|perfeito|fechado|ta bom|t[aá] bom)$/.test(n);
}

function isPendingFollowupContinuationRequest(message: string): boolean {
  const n = normText(message);
  if (!n) return false;
  return (
    /\b(vc disse que ia falar mais|voce disse que ia falar mais|você disse que ia falar mais)\b/.test(n) ||
    /\b(fala mais|me explica melhor|voce falou que ia explicar|você falou que ia explicar|quero saber mais)\b/.test(n)
  );
}

function extractFollowupTopicsFromAssistantQuestion(message: string | null | undefined): string[] {
  const raw = (message || '').trim();
  const n = normText(raw);
  if (!n || !/\?/.test(raw)) return [];
  const topics: string[] = [];
  if (/\b(lazer|area de lazer|areas de lazer|piscina|academia|playground|quadra)\b/.test(n)) topics.push('lazer');
  if (/\b(seguranca|portaria|controle de acesso|monitoramento)\b/.test(n)) topics.push('seguranca');
  if (/\b(localizacao|onde fica|bairro|regiao|acesso|endereco)\b/.test(n)) topics.push('localizacao');
  if (/\b(valores?|preco|quanto custa|r\$)\b/.test(n)) topics.push('valores');
  if (/\b(formas? de pagamento|pagamento|entrada|parcela|parcelamento|financiamento)\b/.test(n)) {
    topics.push('pagamento');
  }
  return [...new Set(topics)];
}

function followupTopicLabel(topic: string): string {
  if (topic === 'lazer') return 'lazer';
  if (topic === 'seguranca') return 'seguranca';
  if (topic === 'localizacao') return 'localizacao';
  if (topic === 'valores') return 'valores';
  if (topic === 'formas_pagamento') return 'formas de pagamento';
  if (topic === 'pagamento') return 'formas de pagamento';
  return topic;
}

function expandShortFollowUpWithContext(params: {
  userMessage: string;
  enterpriseName: string | null;
  awaitingName: boolean;
  appointmentActive: boolean;
  lastAssistantMessage?: string | null;
  shortConfirmationContext?: AnaShortConfirmationContext | null;
}): { expanded: string; expandedApplied: boolean; reason: string | null } {
  const raw = (params.userMessage || '').trim();
  if (!raw) return { expanded: raw, expandedApplied: false, reason: null };

  if (params.awaitingName && looksLikeStandaloneNameReply(raw)) {
    return { expanded: raw, expandedApplied: false, reason: 'awaiting_name_raw_preserved' };
  }
  const shortConfirmationContext = params.shortConfirmationContext ?? null;
  if (
    shortConfirmationContext?.kind === 'followup_topic_confirmation' &&
    shortConfirmationContext.lastOfferedTopics.length > 0
  ) {
    if (shortConfirmationContext.lastOfferedTopics.length === 1) {
      const topic = followupTopicLabel(shortConfirmationContext.lastOfferedTopics[0] ?? '');
      return {
        expanded: `me explica ${topic}`.trim(),
        expandedApplied: true,
        reason: 'generic_followup_with_pending_topics_single',
      };
    }
    const firstTopic = followupTopicLabel(shortConfirmationContext.lastOfferedTopics[0] ?? '');
    const secondTopic = followupTopicLabel(shortConfirmationContext.lastOfferedTopics[1] ?? '');
    return {
      expanded: `${raw} sobre ${firstTopic} ou ${secondTopic}`.replace(/\s{2,}/g, ' ').trim(),
      expandedApplied: true,
      reason: 'generic_followup_with_pending_topics',
    };
  }
  if (shortConfirmationContext?.kind === 'broker_confirmation') {
    return {
      expanded: `${raw} para falar com corretor`.replace(/\s{2,}/g, ' ').trim(),
      expandedApplied: true,
      reason: 'generic_followup_with_broker_context',
    };
  }
  if (shortConfirmationContext?.kind === 'media_confirmation') {
    return {
      expanded: `${raw} para receber video ou book`.replace(/\s{2,}/g, ' ').trim(),
      expandedApplied: true,
      reason: 'generic_followup_with_media_context',
    };
  }
  const shortFollowup = isShortGenericFollowUpMessage(raw);
  const followupContinuation = isPendingFollowupContinuationRequest(raw);
  if (!shortFollowup && !followupContinuation) {
    return { expanded: raw, expandedApplied: false, reason: null };
  }
  const offeredTopics = extractFollowupTopicsFromAssistantQuestion(params.lastAssistantMessage);
  if (offeredTopics.length > 0 && (isAffirmativeShortReply(raw) || followupContinuation)) {
    const firstTopic = followupTopicLabel(offeredTopics[0] ?? '');
    const secondTopic = offeredTopics[1] ? followupTopicLabel(offeredTopics[1]) : null;
    const topicContext = secondTopic ? `${firstTopic} ou ${secondTopic}` : firstTopic;
    return {
      expanded: `${raw} sobre ${topicContext}`.replace(/\s{2,}/g, ' ').trim(),
      expandedApplied: true,
      reason: 'generic_followup_with_pending_topics',
    };
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

type AnaDeliveredMediaKind = 'image' | 'video' | 'document';

type AnaMediaFirstResult =
  | { ok: true; messageKind: AnaDeliveredMediaKind; sentCategory: FileCategory; fileName: string }
  | { ok: false; error: string; code?: number; fileName: string };

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
    };

type AnaConversationSafeTopicAvailability = {
  lazer: boolean;
  seguranca: boolean;
  localizacao: boolean;
  valores: boolean;
  pagamento: boolean;
  fotos: boolean;
  video: boolean;
  book: boolean;
};

type AnaPostMediaFollowupKind = 'fotos' | 'video' | 'book' | 'material';

function hasSendableCategory(sendableCategories: readonly FileCategory[], category: FileCategory): boolean {
  return sendableCategories.includes(category);
}

function buildSafeTopicAvailabilityForPolicy(params: {
  evidence: AnaEnterpriseEvidence;
  sendableCategories: readonly FileCategory[];
}): AnaConversationSafeTopicAvailability {
  const hasKnowledge = params.evidence.hasUsableKnowledgeChunks;
  const hasOtherSendable = hasSendableCategory(params.sendableCategories, 'outro');
  return {
    lazer: hasKnowledge,
    seguranca: hasKnowledge,
    localizacao: params.evidence.hasExactLocation || hasKnowledge,
    valores: params.evidence.hasPricingInfo,
    pagamento: params.evidence.hasFinancingInfo,
    fotos: hasOtherSendable,
    video: hasOtherSendable,
    book: params.evidence.hasSendableBook,
  };
}

function normalizeMediaPostSendText(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferPostMediaFollowupKindFromText(text: string | null | undefined): AnaPostMediaFollowupKind | null {
  const n = normalizeMediaPostSendText(text);
  if (!n) return null;
  if (/\bbook\b/.test(n)) return 'book';
  if (/\bvideo\b/.test(n)) return 'video';
  if (/\b(foto|fotos|imagem|imagens)\b/.test(n)) return 'fotos';
  if (/\bte enviei\b/.test(n) && /\bo que achou\b/.test(n)) return 'material';
  return null;
}

function pickPostMediaFollowupText(params: {
  kind: AnaDeliveredMediaKind;
  category: FileCategory;
  fileName?: string | null;
}): { kind: AnaPostMediaFollowupKind; text: string } {
  const fileNameNorm = normalizeMediaPostSendText(params.fileName ?? '');
  if (params.kind === 'image') {
    return {
      kind: 'fotos',
      text: 'Te enviei algumas fotos do empreendimento. O que achou?',
    };
  }
  if (params.kind === 'video') {
    return {
      kind: 'video',
      text: 'Te enviei o video do empreendimento. O que achou?',
    };
  }
  if (params.category === 'book' || /\bbook\b/.test(fileNameNorm)) {
    return {
      kind: 'book',
      text: 'Te enviei o Book para voce analisar com calma. Quer que eu te ajude com algum ponto dele?',
    };
  }
  return {
    kind: 'material',
    text: 'Te enviei o material para voce analisar com calma. O que achou?',
  };
}

export function __testOnlyResolveMediaPostSendFollowup(params: {
  flowState: CommercialFlowState;
  mediaKind: AnaDeliveredMediaKind;
  mediaCategory: FileCategory;
  mediaFileName?: string | null;
  recentAssistantReplies: string[];
}): { shouldSend: boolean; reason: 'ok' | 'visit_flow' | 'broker_handoff' | 'repeat'; text: string; kind: AnaPostMediaFollowupKind } {
  const visitFlowActive =
    params.flowState.pendingVisitScheduling === true || params.flowState.visitScheduling?.active === true;
  const brokerHandoffActive = Boolean(params.flowState.dialoguePolicy?.brokerHandoffAcceptedAt);
  const followup = pickPostMediaFollowupText({
    kind: params.mediaKind,
    category: params.mediaCategory,
    fileName: params.mediaFileName ?? null,
  });
  if (visitFlowActive) {
    return { shouldSend: false, reason: 'visit_flow', text: followup.text, kind: followup.kind };
  }
  if (brokerHandoffActive) {
    return { shouldSend: false, reason: 'broker_handoff', text: followup.text, kind: followup.kind };
  }
  const repeated = params.recentAssistantReplies
    .slice(-4)
    .some((reply) => inferPostMediaFollowupKindFromText(reply) === followup.kind);
  if (repeated) {
    return { shouldSend: false, reason: 'repeat', text: followup.text, kind: followup.kind };
  }
  return { shouldSend: true, reason: 'ok', text: followup.text, kind: followup.kind };
}

async function maybeSendAnaMediaPostSendFollowup(params: {
  conversationId: number;
  toPhoneNumber: string;
  flowState: CommercialFlowState;
  mediaKind: AnaDeliveredMediaKind;
  mediaCategory: FileCategory;
  mediaFileName?: string | null;
  recentAssistantReplies: string[];
  replyPipelineToken?: number;
}): Promise<{ sent: boolean; text: string | null }> {
  const followupDecision = __testOnlyResolveMediaPostSendFollowup({
    flowState: params.flowState,
    mediaKind: params.mediaKind,
    mediaCategory: params.mediaCategory,
    mediaFileName: params.mediaFileName ?? null,
    recentAssistantReplies: params.recentAssistantReplies,
  });
  if (!followupDecision.shouldSend) {
    if (followupDecision.reason === 'repeat') {
      console.log('[ANA_MEDIA_POST_SEND_FOLLOWUP_SUPPRESSED_REPEAT]', {
        conversationId: params.conversationId,
        kind: followupDecision.kind,
      });
    }
    return { sent: false, text: null };
  }

  if (isPipelineStale(params.conversationId, params.replyPipelineToken)) return { sent: false, text: null };
  const send = await sendTextMessage({
    conversationId: params.conversationId,
    to: params.toPhoneNumber,
    text: followupDecision.text,
    phase: 'ana_media_post_send_followup',
  });
  if (!send.success || !send.metaMessageId) return { sent: false, text: null };
  await insertMessage(params.conversationId, 'assistant', followupDecision.text, send.metaMessageId);
  console.log('[ANA_MEDIA_POST_SEND_FOLLOWUP_SENT]', {
    conversationId: params.conversationId,
    kind: followupDecision.kind,
  });
  return { sent: true, text: followupDecision.text };
}
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
      console.log('[ANA_MEDIA_OFFER_SENT]', {
        conversationId,
        enterpriseId: enterpriseIdForFile,
        mediaType: mk,
        fileId: file.id,
        phase: 'media_delivery',
      });
      if (mk === 'video') {
        console.log('[ANA_VIDEO_DIRECT_SENT]', { conversationId, enterpriseId: enterpriseIdForFile, fileId: file.id });
      }
      return { ok: true, messageKind: mk, sentCategory: cat, fileName: file.originalName };
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
  if (mediaRes.code === 413) {
    if (file.publicUrl) {
      const linkText = `Tenho esse material cadastrado. Como ele está grande para envio direto no WhatsApp, segue o link seguro: ${file.publicUrl}`;
      const linkSend = await sendTextMessage({
        conversationId,
        to: toPhoneNumber,
        text: linkText,
        phase: 'ana_large_media_link_fallback',
      });
      if (linkSend.success && linkSend.metaMessageId) {
        console.log('[ANA_VIDEO_LINK_SENT]', { conversationId, enterpriseId: enterpriseIdForFile, fileId: file.id });
        await insertMessage(conversationId, 'assistant', linkText, linkSend.metaMessageId);
        return { ok: true, messageKind: 'document', sentCategory: cat, fileName: file.originalName };
      }
    }
    const safeText =
      'Tenho esse material cadastrado, mas ele está grande para envio direto por WhatsApp. Posso te passar as principais informações por aqui.';
    const safeSend = await sendTextMessage({
      conversationId,
      to: toPhoneNumber,
      text: safeText,
      phase: 'ana_large_media_safe_fallback',
    });
    if (safeSend.success && safeSend.metaMessageId) {
      console.log('[ANA_VIDEO_TOO_LARGE_FOR_WHATSAPP]', { conversationId, enterpriseId: enterpriseIdForFile, fileId: file.id });
      await insertMessage(conversationId, 'assistant', safeText, safeSend.metaMessageId);
      return { ok: true, messageKind: 'document', sentCategory: cat, fileName: file.originalName };
    }
  }
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
    // Sem fallback deterministico: em modo global sem empreendimento, o engine segue para o LLM
    // perguntar qual empreendimento/material o cliente busca.
    console.log('[MATERIAL_FLOW]', logPayload);
    return { handled: true, status: 'ENTERPRISE_NOT_RESOLVED', log: logPayload };
  }

  if (requestedMaterialType == null) {
    logPayload.failureReason = 'material_type_not_resolved';
    const state = buildMaterialFlowState(params.flowState, {
      pendingAction: 'send_material',
      pendingMaterialType: null,
      pendingEnterpriseId: resolvedEnterprise.id,
      lastRequestedMaterialType: null,
      status: 'MATERIAL_TYPE_NOT_RESOLVED',
      lastMaterialSentId: null,
    });
    await mergeConversationCommercialFlowState(params.conversationId, state);
    // Sem fallback deterministico: o engine pode seguir para resposta conversacional segura.
    console.log('[MATERIAL_FLOW]', logPayload);
    return { handled: true, status: 'MATERIAL_TYPE_NOT_RESOLVED', log: logPayload };
  }

  const fileResolution = await resolveSendableEnterpriseFileCurrentVersion(
    resolvedEnterprise.id,
    requestedMaterialType
  );
  logPayload.candidateFilesCount = fileResolution.candidateFilesCount;
  logPayload.candidateVersionsCount = fileResolution.candidateVersionsCount;

  if (!fileResolution.file) {
    logPayload.failureReason = fileResolution.failureReason ?? 'no_files_for_enterprise';
    const state = buildMaterialFlowState(params.flowState, {
      pendingAction: 'send_material',
      pendingMaterialType: requestedMaterialType,
      pendingEnterpriseId: resolvedEnterprise.id,
      lastRequestedMaterialType: requestedMaterialType,
      status: 'MATERIAL_NOT_FOUND',
      lastMaterialSentId: null,
    });
    await mergeConversationCommercialFlowState(params.conversationId, state);
    // Sem fallback determinístico: material indisponível vira bloqueio/handoff.
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

  const rowsAfterMaterial = await getMessagesByConversationId(params.conversationId);
  const recentAssistantReplies = rowsAfterMaterial
    .filter((msg) => msg.role === 'assistant')
    .map((msg) => String(msg.content ?? '').trim())
    .filter((msg) => msg.length > 0)
    .slice(-6);
  await maybeSendAnaMediaPostSendFollowup({
    conversationId: params.conversationId,
    toPhoneNumber: params.toPhoneNumber,
    flowState: params.flowState,
    mediaKind: mediaOutcome.messageKind,
    mediaCategory: mediaOutcome.sentCategory,
    mediaFileName: mediaOutcome.fileName,
    recentAssistantReplies,
    replyPipelineToken: params.replyPipelineToken,
  });

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
  let anaTurnContextResolved: AnaTurnContextResolved | null = null;
  let turnResponseCommitted = false;
  let turnCommittedHandler: string | null = null;
  let isFirstAnaReplyForTurn = false;
  let pendingResolutionNeedsDisambiguation = false;
  let pendingResolutionChoiceIntent: 'broker' | 'visit' | 'ambiguous' | null = null;
  let anaGlobalNoEnterpriseModeForTurn = false;
  const isHardBlockedSilentExitReason = (reason: string | null): boolean => {
    const normalized = String(reason ?? '').trim();
    if (!normalized) return false;
    return (
      normalized === 'handoff' ||
      normalized === 'carteira' ||
      normalized === 'manual_closed' ||
      normalized === 'ai_disabled' ||
      normalized === 'missing_global_api_key' ||
      normalized === 'missing_enterprise_api_key' ||
      normalized === 'missing_resolved_api_key_after_gate' ||
      normalized === 'ana_model_not_configured' ||
      normalized === 'llm_generation_failed_after_retries' ||
      normalized.endsWith('_send_failed') ||
      normalized.includes('send_failed') ||
      normalized.startsWith('pipeline_stale_')
    );
  };
  const sendGlobalNoEnterpriseFinalSafeReply = async (reason: string | null): Promise<boolean> => {
    if (!anaGlobalNoEnterpriseModeForTurn) return false;
    if (anaTurnAuditOutcome !== 'silent' && anaTurnAuditOutcome !== 'blocked') return false;
    if (isHardBlockedSilentExitReason(reason)) return false;
    const safeReply = ANA_GLOBAL_NO_ENTERPRISE_SAFE_DISCOVERY_REPLY;
    const safeSend = await sendAnaOutboundMessages({
      conversationId,
      toPhoneNumber,
      text: safeReply,
      phase: 'ana_global_no_enterprise_final_safe_reply',
      replyPipelineToken,
    });
    if (!safeSend.success || safeSend.metaMessageIds.length === 0) {
      anaTurnAuditOutcome = 'send_failed';
      anaTurnAuditBlockedReason = 'global_no_enterprise_final_safe_reply_send_failed';
      anaTurnDiagnostics.finalResponse.replySource = 'global_no_enterprise_safe_reply';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      return false;
    }
    anaTurnAuditOutcome = 'sent';
    anaTurnAuditBlockedReason = null;
    anaTurnDiagnostics.finalResponse.replySource = 'global_no_enterprise_safe_reply';
    anaTurnDiagnostics.finalResponse.handoffUsed = false;
    anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
    anaTurnAuditGuardsApplied.globalNoEnterpriseFinalSafeReply = {
      sent: true,
      originalReason: reason ?? 'unknown_silent_exit',
      reply: safeReply,
    };
    console.log('[ANA_GLOBAL_NO_ENTERPRISE_FINAL_SAFE_REPLY]', {
      conversationId,
      reason: reason ?? 'unknown_silent_exit',
      outboundMetaMessageId: safeSend.metaMessageIds[safeSend.metaMessageIds.length - 1] ?? null,
      replyLen: safeReply.length,
    });
    return true;
  };
  const selectTurnDecision = (params: {
    handler: string;
    reason: string;
    requestedTopic: string | null;
    commercialAxis: CommercialAxis | null;
    shouldCallQwen: boolean;
  }): void => {
    console.log('[ANA_TURN_DECISION_SELECTED]', {
      conversationId,
      handler: params.handler,
      reason: params.reason,
      requestedTopic: params.requestedTopic,
      commercialAxis: params.commercialAxis,
      shouldCallQwen: params.shouldCallQwen,
    });
  };
  const commitTurnResponse = (params: {
    handler: string;
    reason: string;
    parts: string[];
    stage: string;
    requestedTopic: string | null;
    commercialAxis: CommercialAxis | null;
    shouldCallQwen: boolean;
  }): { committed: boolean; text: string; parts: string[] } => {
    if (turnResponseCommitted) {
      console.log('[ANA_TURN_EXTRA_HANDLER_SUPPRESSED]', {
        conversationId,
        committedHandler: turnCommittedHandler,
        suppressedHandler: params.handler,
        reason: params.reason,
      });
      return { committed: false, text: '', parts: [] };
    }
    const dedupedParts = dedupeMessageParts(params.parts, {
      conversationId,
      stage: params.stage,
    });
    const firstGreetingNormalized = normalizeFirstGreetingCommittedReply({
      conversationId,
      isFirstAnaReply: isFirstAnaReplyForTurn,
      userMessage: trimmed,
      parts: dedupedParts,
    });
    const locationPromiseGuardedParts = firstGreetingNormalized.parts
      .map((part) => {
        const guarded = sanitizeUnsupportedLocationPromiseText(part);
        if (guarded.changed) {
          console.log('[ANA_UNSUPPORTED_LOCATION_PROMISE_BLOCKED]', {
            conversationId,
            blockedTextPreview: part.slice(0, 220),
          });
        }
        return guarded.text;
      })
      .filter((part) => part.trim().length > 0);
    const clientVisibleParts = locationPromiseGuardedParts
      .map((part) => sanitizeAnaClientVisibleReplyText(part))
      .filter((part) => part.trim().length > 0);
    const committedParts = dedupeMessageParts(clientVisibleParts, {
      conversationId,
      stage: `${params.stage}_location_promise_guard`,
    });
    if (committedParts.length === 0) {
      return { committed: false, text: '', parts: [] };
    }
    const text = committedParts.join('\n\n').trim();
    turnResponseCommitted = true;
    turnCommittedHandler = params.handler;
    console.log('[ANA_TURN_RESPONSE_COMMITTED]', {
      conversationId,
      handler: params.handler,
      partsCount: committedParts.length,
      preview: text.slice(0, 260),
    });
    selectTurnDecision({
      handler: params.handler,
      reason: params.reason,
      requestedTopic: params.requestedTopic,
      commercialAxis: params.commercialAxis,
      shouldCallQwen: params.shouldCallQwen,
    });
    return { committed: true, text, parts: committedParts };
  };
  const verifyAndRepairHandoffAfterBrokerAssignment = async (
    assignment: Awaited<ReturnType<typeof assignConversationToNextBroker>>
  ): Promise<void> => {
    if (!assignment) return;
    let convAfterAssignment = await getConversationById(conversationId);
    if (!convAfterAssignment) {
      console.error('[ANA_HANDOFF_MODE_VERIFY_FAILED]', {
        conversationId,
        reason: 'conversation_not_found_after_assignment',
      });
      return;
    }
    const initialAttendanceMode =
      convAfterAssignment.handoff === true || convAfterAssignment.classification === 'Handoff'
        ? 'handoff'
        : 'ana';
    console.log('[ANA_HANDOFF_MODE_VERIFY_AFTER_ASSIGNMENT]', {
      conversationId,
      assignedBrokerId: convAfterAssignment.assigned_broker_id ?? null,
      handoff: convAfterAssignment.handoff === true,
      classification: convAfterAssignment.classification ?? null,
      pendingResolutionChoice: convAfterAssignment.pending_resolution_choice === true,
      attendanceMode: initialAttendanceMode,
    });
    const shouldRepairHandoffMode =
      convAfterAssignment.assigned_broker_id != null &&
      (convAfterAssignment.handoff !== true || convAfterAssignment.classification !== 'Handoff');
    if (shouldRepairHandoffMode) {
      await query(
        `UPDATE conversations
         SET handoff = true,
             classification = 'Handoff',
             handoff_reason = COALESCE(handoff_reason, 'explicit_broker_request'),
             handoff_requested_at = COALESCE(handoff_requested_at, NOW()),
             updated_at = NOW()
         WHERE id = $1`,
        [conversationId]
      );
      convAfterAssignment = await getConversationById(conversationId);
      const repairedAttendanceMode =
        convAfterAssignment?.handoff === true || convAfterAssignment?.classification === 'Handoff'
          ? 'handoff'
          : 'ana';
      console.log('[ANA_HANDOFF_MODE_REPAIRED_AFTER_ASSIGNMENT]', {
        conversationId,
        assignedBrokerId: convAfterAssignment?.assigned_broker_id ?? null,
        handoff: convAfterAssignment?.handoff === true,
        classification: convAfterAssignment?.classification ?? null,
        pendingResolutionChoice: convAfterAssignment?.pending_resolution_choice === true,
        attendanceMode: repairedAttendanceMode,
      });
    }
    const finalAttendanceMode =
      convAfterAssignment?.handoff === true || convAfterAssignment?.classification === 'Handoff'
        ? 'handoff'
        : 'ana';
    const verificationFailed =
      !convAfterAssignment ||
      (assignment.assignedBrokerId != null && convAfterAssignment.assigned_broker_id == null) ||
      convAfterAssignment.handoff !== true ||
      convAfterAssignment.classification !== 'Handoff' ||
      convAfterAssignment.pending_resolution_choice === true;
    if (verificationFailed) {
      console.error('[ANA_HANDOFF_MODE_VERIFY_FAILED]', {
        conversationId,
        assignedBrokerId: convAfterAssignment?.assigned_broker_id ?? null,
        expectedAssignedBrokerId: assignment.assignedBrokerId ?? null,
        handoff: convAfterAssignment?.handoff === true,
        classification: convAfterAssignment?.classification ?? null,
        pendingResolutionChoice: convAfterAssignment?.pending_resolution_choice === true,
        attendanceMode: finalAttendanceMode,
      });
    }
    await publishConversationUpdated(conversationId);
  };
  const resolveCustomerNameOrPhoneForBrokerTemplate = (
    conversation: Awaited<ReturnType<typeof getConversationById>> | null
  ): string => {
    const customerName = String(conversation?.customer_name ?? '').trim();
    if (customerName) return customerName;
    const phone = String(conversation?.contact_phone ?? conversation?.external_contact_id ?? '').trim();
    return phone || 'Cliente';
  };
  const notifyBrokerAppointmentConfirmedAfterAnaSend = async (
    appointmentRegistration: Awaited<ReturnType<typeof registerAnaAppointmentIfConfirmed>> | null,
    enterpriseNameFallback: string | null
  ): Promise<void> => {
    if (
      !appointmentRegistration?.persisted ||
      appointmentRegistration.appointmentId == null
    ) {
      return;
    }

    try {
      const appointmentId = appointmentRegistration.appointmentId;
      let convForNotification = await getConversationById(conversationId);
      let assignedBrokerId =
        convForNotification?.assigned_broker_id ?? appointmentRegistration.brokerId ?? null;
      let brokerName: string | null = null;
      let brokerPhone: string | null = null;
      let customerNameOrPhone = resolveCustomerNameOrPhoneForBrokerTemplate(convForNotification);
      let enterpriseNameForNotification =
        String(enterpriseNameFallback ?? '').trim() || 'empreendimento';

      if (assignedBrokerId == null) {
        const appointmentAssignment = await assignConversationToNextBroker({
          conversationId,
          reason: 'appointment_confirmed',
        });
        if (appointmentAssignment) {
          assignedBrokerId = appointmentAssignment.assignedBrokerId;
          brokerName = appointmentAssignment.assignedBrokerName;
          brokerPhone = appointmentAssignment.assignedBrokerPhone;
          customerNameOrPhone = appointmentAssignment.customerNameOrPhone;
          enterpriseNameForNotification =
            appointmentAssignment.enterpriseName ?? enterpriseNameForNotification;
          if (assignedBrokerId != null) {
            await query(
              `UPDATE appointments
               SET broker_id = COALESCE(broker_id, $2),
                   status = CASE
                     WHEN broker_id IS NULL AND status = 'PENDENTE_DISTRIBUICAO' THEN 'CONFIRMADO'
                     ELSE status
                   END,
                   updated_at = NOW()
               WHERE id = $1`,
              [appointmentId, assignedBrokerId]
            );
          }
          convForNotification = await getConversationById(conversationId);
        }
      }

      if (assignedBrokerId != null && brokerPhone == null) {
        const broker = await getCorretorById(assignedBrokerId);
        brokerName = broker?.full_name ?? brokerName;
        brokerPhone = broker?.phone ?? brokerPhone;
      }

      await sendBrokerAppointmentConfirmedTemplate({
        brokerPhone,
        brokerName,
        customerNameOrPhone,
        enterpriseName: enterpriseNameForNotification,
        appointmentDateTimeText:
          appointmentRegistration.appointmentDateTimeText ?? 'data/hora da visita',
        conversationId,
        appointmentId,
      });

      if (convForNotification?.assigned_broker_id !== assignedBrokerId) {
        await publishConversationUpdated(conversationId);
      }
    } catch (error) {
      console.error('[BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_FAILED]', {
        conversationId,
        appointmentId: appointmentRegistration.appointmentId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };
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

    if (effectiveConv.classification === 'Carteira' || effectiveConv.manual_closed_at != null) {
      const blockedReason = effectiveConv.classification === 'Carteira' ? 'carteira' : 'manual_closed';
      console.log('[ANA_PIPELINE] engine_blocked_inactive_wallet_or_closed', {
        conversationId,
        reason: blockedReason,
        classification: effectiveConv.classification,
        manualClosedAt: effectiveConv.manual_closed_at != null,
        toPhoneTail: anaPhoneTail(toPhoneNumber),
        inboundMetaMessageId: inboundMetaFromCtx ?? null,
      });
      await cancelAnaVisitFollowupForConversation({
        conversationId,
        reason: blockedReason,
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
      console.log('[ANA_SKIPPED_HANDOFF_ACTIVE]', {
        conversationId,
        handoff: effectiveConv.handoff,
        classification: effectiveConv.classification,
      });
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
      await cancelAnaVisitFollowupForConversation({
        conversationId,
        reason: 'handoff',
      });
      return;
    }
    console.log('[ANA DEBUG] handoff check passed');

    if (effectiveConv.pending_resolution_choice === true) {
      const substantiveBypass = isSubstantiveQuestionThatBypassesResolutionChoice(trimmed);
      if (substantiveBypass) {
        await clearConversationPendingResolutionState(conversationId);
        effectiveConv = { ...effectiveConv, pending_resolution_choice: false };
        pendingResolutionChoiceIntent = null;
        pendingResolutionNeedsDisambiguation = false;
        console.log('[ANA_PENDING_RESOLUTION_BYPASSED_BY_SUBSTANTIVE_QUESTION]', {
          conversationId,
          userMessage: trimmed.slice(0, 220),
        });
      } else {
        const pendingAllowedActions = (() => {
          const payload = effectiveConv.pending_resolution_payload;
          if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return [];
          const raw = (payload as Record<string, unknown>).allowedNextActions;
          return Array.isArray(raw) ? raw.map((item) => String(item)) : [];
        })();
        const pendingAllowsBroker = pendingAllowedActions.includes('offer_broker_handoff');
        const pendingAllowsVisit = pendingAllowedActions.includes('offer_visit_scheduling');
        let pendingChoice = isExplicitResolutionChoice(trimmed) ?? classifyPendingResolutionChoice(trimmed);
        if (pendingChoice === 'ambiguous') {
          if (pendingAllowsBroker && !pendingAllowsVisit) pendingChoice = 'broker';
          else if (pendingAllowsVisit && !pendingAllowsBroker) pendingChoice = 'visit';
        }
        pendingResolutionChoiceIntent = pendingChoice;
        if (pendingChoice === 'visit') {
          await clearConversationPendingResolutionState(conversationId);
          effectiveConv = { ...effectiveConv, pending_resolution_choice: false };
          console.log('[ANA_VISIT_SELECTED_FROM_RESOLUTION_OFFER]', { conversationId });
        } else if (pendingChoice === 'ambiguous') {
          pendingResolutionNeedsDisambiguation = true;
        }
        console.log('[ANA_PENDING_RESOLUTION_CHOICE_CLASSIFIED]', {
          conversationId,
          choice: pendingChoice,
          pendingResolutionChoice: effectiveConv.pending_resolution_choice === true,
        });
      }
    }

    const explicitBrokerRequest = hasExplicitHandoffIntent(trimmed);
    const isFirstContactEnterpriseInterest = isFirstContactEnterpriseInterestMessage(trimmed);
    const shouldAssignBroker =
      (effectiveConv.pending_resolution_choice === true && pendingResolutionChoiceIntent === 'broker') ||
      explicitBrokerRequest;
    const brokerAssignReason =
      effectiveConv.pending_resolution_choice === true && pendingResolutionChoiceIntent === 'broker'
        ? 'pending_resolution_broker_choice'
        : explicitBrokerRequest
          ? 'explicit_broker_request'
          : null;
    console.log('[ANA_BROKER_ASSIGNMENT_DECISION]', {
      conversationId,
      shouldAssignBroker,
      reason: brokerAssignReason,
      explicitBrokerRequest,
      pendingResolutionChoice: effectiveConv.pending_resolution_choice === true,
      classifiedChoice: pendingResolutionChoiceIntent,
      isFirstContactEnterpriseInterest,
    });
    console.log('[ANA_BROKER_EXPLICIT_REQUEST_DETECTED]', {
      conversationId,
      userMessagePreview: trimmed.slice(0, 220),
      explicitBrokerRequest,
      pendingResolutionChoiceIntent,
      shouldAssignBroker,
      brokerAssignReason,
    });

    if (shouldAssignBroker && brokerAssignReason) {
      console.log('[ANA_BROKER_ASSIGNMENT_BRANCH_ENTERED]', {
        conversationId,
        reason: brokerAssignReason,
      });
      const explicitReply =
        'Perfeito. Vou te encaminhar agora para um corretor te atender de forma personalizada.';
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_explicit_broker_send';
        return;
      }
      const explicitSend = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: explicitReply,
        phase:
          brokerAssignReason === 'pending_resolution_broker_choice'
            ? 'ana_pending_resolution_broker_choice'
            : 'ana_explicit_broker_request',
        replyPipelineToken,
      });
      if (!explicitSend.success || explicitSend.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = `${brokerAssignReason}_send_failed`;
        return;
      }
      let assignment: Awaited<ReturnType<typeof assignConversationToNextBroker>> = null;
      try {
        assignment = await assignConversationToNextBroker({
          conversationId,
          reason: brokerAssignReason,
        });
      } catch (error) {
        console.error('[ANA_BROKER_ASSIGNMENT_FAILED]', {
          conversationId,
          reason: brokerAssignReason,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (assignment) {
        await verifyAndRepairHandoffAfterBrokerAssignment(assignment);
        await cancelAnaVisitFollowupForConversation({
          conversationId,
          reason: 'handoff',
        });
        if (assignment.assignedBrokerId != null) {
          const enterpriseNameForNotification = assignment.enterpriseName ?? 'empreendimento';
          await sendBrokerPendingAttendanceTemplate({
            brokerPhone: assignment.assignedBrokerPhone,
            brokerName: assignment.assignedBrokerName,
            customerNameOrPhone: assignment.customerNameOrPhone,
            enterpriseName: enterpriseNameForNotification,
            conversationId,
          });
          await sendBrokerPendingAttendancePush({
            brokerId: assignment.assignedBrokerId,
            conversationId,
            enterpriseId: assignment.enterpriseId,
            customerNameOrPhone: assignment.customerNameOrPhone,
            enterpriseName: enterpriseNameForNotification,
          });
          await publishConversationUpdated(conversationId);
        }
      }
      console.log('[ANA_BROKER_ASSIGNMENT_STARTED]', {
        conversationId,
        reason: brokerAssignReason,
      });
      console.log('[ANA_HANDOFF_ACCEPTED_BY_CUSTOMER]', {
        conversationId,
        reason: brokerAssignReason,
      });
      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
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
    isFirstAnaReplyForTurn = isFirstAnaReply;
    const lastAssistantBeforeUser = [...rows].reverse().find((m) => m.role === 'assistant');
    const lastAssistantPlain = lastAssistantBeforeUser?.content?.trim() || null;
    const recentAssistantPlainTexts = rows
      .filter((m) => m.role === 'assistant')
      .slice(-8)
      .map((m) => String(m.content ?? '').trim())
      .filter(Boolean);
    const assistantNameQuestionRegex =
      /(?:me\s+conta|me\s+fala|me\s+diz|me\s+informa)\s+(?:o\s+)?seu\s+nome|qual(?:\s+é)?\s+seu\s+nome|como\s+(?:posso\s+)?(?:te\s+)?chamar|seu\s+nome\s*\??\s*$/i;    const nameQuestionContextPlain =
      [...recentAssistantPlainTexts]
        .reverse()
        .find((text) => replyExplicitlyAsksCustomerName(text) || assistantNameQuestionRegex.test(text)) ?? null;
    const recentAssistantAskedCustomerName = nameQuestionContextPlain != null;
    let visitStateReconstructedThisTurn = false;
    const visitStateLogPayload = {
      conversationId,
      pendingVisitScheduling: flowStateParsed.pendingVisitScheduling === true,
      pendingVisitDay: flowStateParsed.pendingVisitDay ?? flowStateParsed.pendingVisitDateLabel ?? null,
      pendingVisitTime: flowStateParsed.pendingVisitTime ?? null,
      pendingVisitInvalidTime: flowStateParsed.pendingVisitInvalidTime ?? null,
      pendingVisitMissingSlot: flowStateParsed.pendingVisitMissingSlot ?? null,
      pendingVisitCustomerName: flowStateParsed.pendingVisitCustomerName ?? null,
    };
    console.log('[ANA_VISIT_STATE_LOADED]', visitStateLogPayload);
    if (flowStateParsed.pendingVisitScheduling !== true && flowStateParsed.visitScheduling?.active !== true) {
      const reconstructedVisitState = reconstructVisitStateFromRecentMessages({
        recentMessages: rows.map((m) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        flowState: flowStateParsed,
        referenceNow: new Date(),
        enterpriseId: conv.enterprise_id ?? null,
        knownCustomerName: effectiveConv.customer_name ?? null,
      });
      if (reconstructedVisitState.reconstructed) {
        visitStateReconstructedThisTurn = true;
        flowStateParsed = reconstructedVisitState.nextState;
        await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
        const reconstructedPayload = {
          conversationId,
          pendingVisitScheduling: flowStateParsed.pendingVisitScheduling === true,
          pendingVisitDay: flowStateParsed.pendingVisitDay ?? flowStateParsed.pendingVisitDateLabel ?? null,
          pendingVisitTime: flowStateParsed.pendingVisitTime ?? null,
          pendingVisitInvalidTime: flowStateParsed.pendingVisitInvalidTime ?? null,
          pendingVisitMissingSlot: flowStateParsed.pendingVisitMissingSlot ?? null,
          pendingVisitCustomerName: flowStateParsed.pendingVisitCustomerName ?? null,
          reason: reconstructedVisitState.reason,
        };
        console.log('[ANA_VISIT_STATE_RECONSTRUCTED_FROM_HISTORY]', reconstructedPayload);
        if (reconstructedVisitState.lowConfidence) {
          console.log('[ANA_VISIT_STATE_RECONSTRUCTED_LOW_CONFIDENCE]', reconstructedPayload);
        }
        console.log('[ANA_VISIT_STATE_SAVED]', {
          ...reconstructedPayload,
          source: 'history_reconstruction',
        });
      }
    }
    const shortConfirmationContext = resolveShortConfirmationContext({
      userText: trimmed,
      recentMessages: rows.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      lastAssistantMessage: lastAssistantPlain,
      flowState: flowStateParsed,
    });
    const suppressVisitByConfirmationContext = shouldSuppressVisitFlowForConfirmationKind(shortConfirmationContext.kind);
    console.log('[ANA_SHORT_CONFIRMATION_CONTEXT_RESOLVED]', {
      conversationId,
      kind: shortConfirmationContext.kind,
      isShortConfirmation: shortConfirmationContext.isShortConfirmation,
      lastAssistantQuestionType: shortConfirmationContext.lastAssistantQuestionType,
      lastOfferedTopics: shortConfirmationContext.lastOfferedTopics,
      source: shortConfirmationContext.source,
    });
    if (shortConfirmationContext.kind === 'followup_topic_confirmation') {
      console.log('[ANA_SHORT_CONFIRMATION_RESOLVED_TO_FOLLOWUP]', {
        conversationId,
        lastOfferedTopics: shortConfirmationContext.lastOfferedTopics,
      });
    } else if (shortConfirmationContext.kind === 'visit_confirmation') {
      console.log('[ANA_SHORT_CONFIRMATION_RESOLVED_TO_VISIT]', {
        conversationId,
      });
    } else if (shortConfirmationContext.kind === 'broker_confirmation') {
      console.log('[ANA_SHORT_CONFIRMATION_RESOLVED_TO_BROKER]', {
        conversationId,
      });
    } else if (shortConfirmationContext.kind === 'ambiguous_confirmation') {
      console.log('[ANA_SHORT_CONFIRMATION_AMBIGUOUS]', {
        conversationId,
      });
    }
    const leadQualificationStateAtNameBoundary = getLeadQualificationState(flowStateParsed);
    const knownCustomerNameBeforeCapture =
      (effectiveConv.customer_name || leadQualificationStateAtNameBoundary.customerName || leadQualificationStateAtNameBoundary.name || '')
        .trim();
    const lastAssistantAskedCustomerNameThisTurn =
      !knownCustomerNameBeforeCapture &&
      (
        recentAssistantAskedCustomerName ||
        effectiveConv.ana_asked_customer_name === true
      );
    if (lastAssistantAskedCustomerNameThisTurn) {
      console.log('[ANA_NAME_VARIABLE_CAPTURE_ATTEMPT]', {
        conversationId,
        userMessagePreview: trimmed.slice(0, 120),
        lastAssistantMessage: (lastAssistantPlain || '').slice(0, 220),
        anaAskedCustomerNameFlag: effectiveConv.ana_asked_customer_name === true,
      });
    }
    let trustedCustomerName =
      extractCustomerNameFromUserUtterance(trimmed, {
        lastAssistantPlain: nameQuestionContextPlain ?? lastAssistantPlain,
      }) || null;
    if (!trustedCustomerName && effectiveConv.ana_asked_customer_name === true) {
      trustedCustomerName =
        extractCustomerNameFromUserUtterance(trimmed, { lastAssistantPlain: 'Como posso te chamar?' }) || null;
    }
    if (!trustedCustomerName && isUncertainCustomerNameCue(trimmed)) {
      console.log('[ANA_CONTACT_NAME_UNCERTAIN]', {
        conversationId,
        userMessagePreview: trimmed.slice(0, 160),
      });
      console.log('[ANA_CONTACT_NICKNAME_IGNORED]', {
        conversationId,
        userMessagePreview: trimmed.slice(0, 160),
      });
    }
    if (trustedCustomerName) {
      if (lastAssistantAskedCustomerNameThisTurn) {
        console.log('[ANA_NAME_VARIABLE_NORMALIZED]', {
          conversationId,
          rawName: trimmed.slice(0, 80),
          normalizedName: trustedCustomerName,
        });
        console.log('[ANA_NAME_VARIABLE_CAPTURED]', {
          conversationId,
          customerName: trustedCustomerName,
        });
        console.log('[ANA_NAME_CAPTURE_BYPASSED_LLM_FIRST]', {
          conversationId,
          customerName: trustedCustomerName,
        });
      }
      console.log('[ANA_CONTACT_NAME_ACCEPTED]', {
        conversationId,
        customerName: trustedCustomerName,
      });
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
    const globalNoEnterpriseMode = shouldUseAnaNoEnterpriseGlobalMode({
      enterpriseIdForAi,
      conversationEnterpriseId: effectiveConv.enterprise_id ?? null,
      resolvedEnterpriseId: enterpriseResolution.enterpriseId ?? null,
      aiSettings: resolvedAiSettings,
    });
    anaGlobalNoEnterpriseModeForTurn = globalNoEnterpriseMode;
    if (globalNoEnterpriseMode) {
      console.log('[ANA_NO_ENTERPRISE_GLOBAL_MODE]', {
        conversationId,
        enterpriseResolutionSource: enterpriseResolution.source,
        reasonWhenNoEnterprise: enterpriseResolution.reasonWhenNoEnterprise,
        aiEnabled: resolvedAiSettings.aiEnabled,
        hasApiKey: Boolean(resolvedAiSettings.openaiApiKey),
        useGlobalDefaults: resolvedAiSettings.useGlobalDefaults,
      });
      console.log('[ANA_GLOBAL_NO_ENTERPRISE_MODE]', {
        conversationId,
        enterpriseResolutionSource: enterpriseResolution.source,
        reasonWhenNoEnterprise: enterpriseResolution.reasonWhenNoEnterprise,
        aiEnabled: resolvedAiSettings.aiEnabled,
        hasApiKey: Boolean(resolvedAiSettings.openaiApiKey),
        useGlobalDefaults: resolvedAiSettings.useGlobalDefaults,
      });
    }
    anaTurnAuditProvider = resolvedAiSettings.provider;
    anaTurnAuditApiKeySource = resolvedAiSettings.apiKeySource;
    anaTurnAuditOpenaiApiKeyId = resolvedAiSettings.openaiApiKeyId;
    anaTurnAuditOpenaiProjectId = resolvedAiSettings.openaiProjectId;

    const loadImageMaterialCommercialContextForModel = async (
      enterprise: EnterpriseRow,
      sourceUserMessage: string
    ): Promise<string> => {
      let variablesMap: Record<string, unknown> = {};
      let knowledgeText = '';
      try {
        variablesMap = await getVariablesMap(enterprise.id);
      } catch (error) {
        console.warn('[ANA_IMAGE_MATERIAL_POST_SEND_CONTEXT_VARS_FAILED]', {
          conversationId,
          enterpriseId: enterprise.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      try {
        const chunkMeta = await loadRankedKnowledgeChunksForPromptWithMeta(
          enterprise.id,
          `${enterprise.name}\n${sourceUserMessage}`.slice(0, 4000),
          {}
        );
        knowledgeText = (chunkMeta.promptText || '').slice(0, 3000);
      } catch (error) {
        console.warn('[ANA_IMAGE_MATERIAL_POST_SEND_CONTEXT_RAG_FAILED]', {
          conversationId,
          enterpriseId: enterprise.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      return buildAnaImageMaterialCommercialContext({
        enterpriseName: enterprise.name,
        variablesMap,
        knowledgeText,
      });
    };

    const sendAnaImageMaterialPostSendModelReply = async (
      params: Omit<AnaImageMaterialPostSendContext, 'enterpriseName'> & {
        enterprise: EnterpriseRow | null;
        phase: string;
      }
    ): Promise<{ sent: boolean; text: string | null; source: 'model' | 'fallback' | 'skipped' }> => {
      if (flowStateParsed.dialoguePolicy?.brokerHandoffAcceptedAt) {
        console.log('[ANA_IMAGE_MATERIAL_POST_SEND_SUPPRESSED]', {
          conversationId,
          reason: 'broker_handoff',
          requestedTheme: params.requestedTheme,
        });
        return { sent: false, text: null, source: 'skipped' };
      }

      let replyText = '';
      let replySource: 'model' | 'fallback' = 'fallback';
      const settings = resolvedAiSettings;
      if (!settings || settings.blocked || !settings.openaiApiKey) {
        console.log('[ANA_IMAGE_MATERIAL_POST_SEND_MODEL_SKIPPED]', {
          conversationId,
          enterpriseId: params.enterprise?.id ?? null,
          requestedTheme: params.requestedTheme,
          reason: !settings ? 'missing_settings' : settings.reason ?? 'missing_api_key_or_blocked',
        });
      } else {
        const modelResolution = resolveAnaOpenAIModel({
          configuredModelFromDb: (settings.modelHotLead || '').trim() || null,
          slot: 'hot_lead',
          provider: settings.provider,
          baseUrl: settings.openaiBaseUrl,
        });
        if (modelResolution.blocked) {
          console.log('[ANA_IMAGE_MATERIAL_POST_SEND_MODEL_SKIPPED]', {
            conversationId,
            enterpriseId: params.enterprise?.id ?? null,
            requestedTheme: params.requestedTheme,
            reason: modelResolution.reason,
          });
        } else {
          const messages = buildAnaImageMaterialPostSendMessages({
            requestedTheme: params.requestedTheme,
            sentImages: params.sentImages,
            lastUserMessage: params.lastUserMessage,
            enterpriseName: params.enterprise?.name ?? null,
            commercialContext: params.commercialContext ?? null,
          });
          console.log('[ANA_IMAGE_MATERIAL_POST_SEND_MODEL_REQUEST]', {
            conversationId,
            enterpriseId: params.enterprise?.id ?? null,
            requestedTheme: params.requestedTheme,
            sentImages: params.sentImages,
            model: modelResolution.finalModel,
          });
          const result = await generateChatCompletion({
            apiKey: settings.openaiApiKey,
            baseUrl: settings.openaiBaseUrl,
            model: modelResolution.finalModel,
            messages,
            temperature: Math.min(settings.temperature, 0.55),
            maxTokens: Math.min(Math.max(settings.maxTokens || 180, 180), 360),
            responseFormatJson: false,
            costTracking: settings.costTrackingEnabled
              ? {
                  purpose: 'ana_image_material_post_send_reply',
                  modelReason: 'db_config',
                  apiKeySource: settings.apiKeySource,
                  openaiApiKeyId: settings.openaiApiKeyId,
                  openaiProjectId: settings.openaiProjectId,
                  requestType: 'ana_image_material_post_send_reply',
                  conversationId,
                  contactId: effectiveConv.contact_id ?? null,
                  enterpriseId: params.enterprise?.id ?? effectiveConv.enterprise_id ?? null,
                  inboundMessageId: lastUserRowForLog?.id ?? null,
                  metadata: {
                    requestedTheme: params.requestedTheme,
                    sentImages: params.sentImages,
                    alreadySentToClient: true,
                  },
                }
              : undefined,
          });
          captureLlmAudit(result, 'ana_image_material_post_send_reply');
          if (result.success && result.content?.trim()) {
            replyText = sanitizeAnaClientVisibleReplyText(result.content).replace(/\s+/g, ' ').trim().slice(0, 900);
            replySource = replyText ? 'model' : 'fallback';
          } else {
            console.warn('[ANA_IMAGE_MATERIAL_POST_SEND_MODEL_EMPTY_OR_FAILED]', {
              conversationId,
              enterpriseId: params.enterprise?.id ?? null,
              requestedTheme: params.requestedTheme,
              success: result.success,
              error: result.error ?? null,
              httpStatus: result.httpStatus ?? null,
            });
          }
        }
      }

      if (!replyText) replyText = ANA_IMAGE_MATERIAL_POST_SEND_FALLBACK_TEXT;
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        console.log('[ANA_IMAGE_MATERIAL_POST_SEND_SUPPRESSED]', {
          conversationId,
          reason: 'pipeline_stale',
          requestedTheme: params.requestedTheme,
        });
        return { sent: false, text: null, source: 'skipped' };
      }
      const send = await sendTextMessage({
        conversationId,
        to: toPhoneNumber,
        text: replyText,
        phase: params.phase,
      });
      if (!send.success || !send.metaMessageId) {
        console.warn('[ANA_IMAGE_MATERIAL_POST_SEND_SEND_FAILED]', {
          conversationId,
          enterpriseId: params.enterprise?.id ?? null,
          requestedTheme: params.requestedTheme,
          source: replySource,
        });
        return { sent: false, text: null, source: 'skipped' };
      }
      await insertMessage(conversationId, 'assistant', replyText, send.metaMessageId);
      console.log('[ANA_IMAGE_MATERIAL_POST_SEND_SENT]', {
        conversationId,
        enterpriseId: params.enterprise?.id ?? null,
        requestedTheme: params.requestedTheme,
        sentImages: params.sentImages,
        source: replySource,
      });
      return { sent: true, text: replyText, source: replySource };
    };

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
      !globalNoEnterpriseMode && effectiveConv.enterprise_id != null
        ? await getActiveEnterpriseById(effectiveConv.enterprise_id)
        : null;
    const flowHintEnterpriseId =
      globalNoEnterpriseMode
        ? null
        : flowStateParsed.lastSingleCatalogEnterpriseId ?? flowStateParsed.lastInferredEnterpriseId ?? null;
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
      lastAssistantMessage: lastAssistantPlain,
      shortConfirmationContext,
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

    const evoraLeadQualificationEnabled = isEvoraEnterpriseName(ent?.name ?? null);
    let leadQualificationStateBeforeTurn = getLeadQualificationState(flowStateParsed);
    let leadQualificationStateForTurn = leadQualificationStateBeforeTurn;
    let leadQualificationSignalsChangedThisTurn = false;
    let leadQualificationNameCollectedThisTurn = false;
    const objectiveCustomerQuestionThisTurn = isObjectiveCustomerQuestion(trimmed);
    if (evoraLeadQualificationEnabled) {
      const extractedQualificationSignals = extractLeadQualificationSignals(trimmed, leadQualificationStateBeforeTurn);
      const knownQualificationName =
        trustedCustomerName || effectiveConv.customer_name || null;
      if (knownQualificationName && !leadQualificationStateBeforeTurn.nameCollected) {
        extractedQualificationSignals.name = knownQualificationName;
        extractedQualificationSignals.customerName = knownQualificationName;
        extractedQualificationSignals.nameCollected = true;
      }
      const hasExtractedSignals = Object.keys(extractedQualificationSignals).length > 0;
      if (hasExtractedSignals) {
        leadQualificationSignalsChangedThisTurn = true;
        flowStateParsed = mergeLeadQualificationState(flowStateParsed, extractedQualificationSignals);
        leadQualificationStateForTurn = getLeadQualificationState(flowStateParsed);
        console.log('[ANA_LEAD_QUALIFICATION_STATE_EXTRACTED]', {
          conversationId,
          state: leadQualificationStateForTurn,
        });
        if (!leadQualificationStateBeforeTurn.nameCollected && leadQualificationStateForTurn.nameCollected) {
          leadQualificationNameCollectedThisTurn = true;
          console.log('[ANA_LEAD_QUALIFICATION_NAME_COLLECTED]', {
            conversationId,
            customerName: leadQualificationStateForTurn.name ?? leadQualificationStateForTurn.customerName ?? null,
          });
        }
      }
    }

    if (
      evoraLeadQualificationEnabled &&
      isFirstAnaReply &&
      !objectiveCustomerQuestionThisTurn &&
      !leadQualificationStateForTurn.nameAsked &&
      !trustedCustomerName &&
      !String(effectiveConv.customer_name ?? '').trim() &&
      !String(leadQualificationStateForTurn.name ?? leadQualificationStateForTurn.customerName ?? '').trim()
    ) {
      const nameQuestion = buildLeadQualificationNameQuestion();

      flowStateParsed = markLeadQualificationQuestionAsked(flowStateParsed, {
        key: 'name',
        question: nameQuestion,
      });

      console.log('[ANA_FIRST_CONTACT_NAME_GATE_BEFORE_LLM]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        isFirstAnaReply,
        objectiveCustomerQuestionThisTurn,
      });

      const committedNameGate = commitTurnResponse({
        handler: 'lead_qualification_name_gate',
        reason: 'first_contact_missing_confirmed_name',
        parts: [nameQuestion],
        stage: 'lead_qualification_name_gate',
        requestedTopic: null,
        commercialAxis: null,
        shouldCallQwen: false,
      });

      if (!committedNameGate.committed || !committedNameGate.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'lead_qualification_name_gate_commit_blocked';
        return;
      }

      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_lead_qualification_name_gate';
        return;
      }

      const nameGateSend = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: committedNameGate.text,
        phase: 'lead_qualification_name_gate',
        replyPipelineToken,
      });

      if (!nameGateSend.success || nameGateSend.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'lead_qualification_name_gate_send_failed';
        return;
      }

      const committedNameGateState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedNameGate.parts,
        finalReplyText: committedNameGate.text,
        handler: 'lead_qualification_name_gate',
        currentTopic: null,
        requestedTopic: null,
        commercialAxis: null,
      });

      flowStateParsed = committedNameGateState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
      await markAnaAskedForCustomerName(conversationId);

      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'lead_qualification_name_gate';
      anaTurnDiagnostics.finalResponse.replySource = 'lead_qualification_name_gate';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      return;
    }

    if (
      evoraLeadQualificationEnabled &&
      leadQualificationNameCollectedThisTurn &&
      !objectiveCustomerQuestionThisTurn &&
      !leadQualificationStateForTurn.purpose &&
      !leadQualificationStateForTurn.askedQualificationKeys.includes('purpose')
    ) {
      const firstName =
        toFirstName(
          trustedCustomerName ||
            leadQualificationStateForTurn.name ||
            leadQualificationStateForTurn.customerName ||
            effectiveConv.customer_name ||
            null
        ) || 'tudo bem';

      const postNameIntro =
        firstName === 'tudo bem'
          ? 'Prazer! Vou te fazer algumas perguntas rápidas para entender melhor seu momento e te orientar melhor sobre o Évora.'
          : `Prazer, ${firstName}! Vou te fazer algumas perguntas rápidas para entender melhor seu momento e te orientar melhor sobre o Évora.`;

      const postNameDiscoveryQuestion =
        'Você está pensando mais em morar, investir ou ainda está conhecendo as possibilidades?';

      flowStateParsed = markLeadQualificationQuestionAsked(flowStateParsed, {
        key: 'purpose' as const,
        question: postNameDiscoveryQuestion,
      });

      console.log('[ANA_POST_NAME_DISCOVERY_GATE_BEFORE_LLM]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        customerName: firstName,
        isFirstAnaReply,
        leadQualificationNameCollectedThisTurn,
      });

      const committedPostNameDiscovery = commitTurnResponse({
        handler: 'lead_qualification_post_name_discovery_gate',
        reason: 'name_collected_missing_purpose',
        parts: [postNameIntro, postNameDiscoveryQuestion],
        stage: 'lead_qualification_post_name_discovery_gate',
        requestedTopic: null,
        commercialAxis: null,
        shouldCallQwen: false,
      });

      if (!committedPostNameDiscovery.committed || !committedPostNameDiscovery.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'lead_qualification_post_name_discovery_commit_blocked';
        return;
      }

      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_lead_qualification_post_name_discovery';
        return;
      }

      const postNameDiscoverySend = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: committedPostNameDiscovery.text,
        phase: 'lead_qualification_post_name_discovery_gate',
        replyPipelineToken,
      });

      if (!postNameDiscoverySend.success || postNameDiscoverySend.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'lead_qualification_post_name_discovery_send_failed';
        return;
      }

      const committedPostNameDiscoveryState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedPostNameDiscovery.parts,
        finalReplyText: committedPostNameDiscovery.text,
        handler: 'lead_qualification_post_name_discovery_gate',
        currentTopic: null,
        requestedTopic: null,
        commercialAxis: null,
      });

      flowStateParsed = committedPostNameDiscoveryState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);

      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'lead_qualification_post_name_discovery_gate';
      anaTurnDiagnostics.finalResponse.replySource = 'lead_qualification_post_name_discovery_gate';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      return;
    }

    const proactiveVideoIntent = isProactiveVideoOfferIntent(trimmed) && !isVideoMaterialRequest(trimmed);
    const visitFlowContextActive =
      appointmentPreflight.active ||
      flowStateParsed.pendingVisitScheduling === true ||
      flowStateParsed.visitScheduling?.active === true;
    const alreadyOfferedOrSentVideo = flowStateParsed.last_material_sent_id != null || flowStateParsed.last_requested_material_type === 'video';
    if (!globalNoEnterpriseMode && proactiveVideoIntent && ent) {
      if (visitFlowContextActive) {
        console.log('[ANA_MEDIA_OFFER_SUPPRESSED_VISIT_FLOW]', {
          conversationId,
          enterpriseId: ent.id,
          visitStatus: flowStateParsed.visitScheduling?.status ?? null,
        });
      } else if (alreadyOfferedOrSentVideo) {
        console.log('[ANA_PROACTIVE_VIDEO_OFFER_SUPPRESSED_REPEAT]', { conversationId, enterpriseId: ent.id });
        console.log('[ANA_MEDIA_OFFER_SUPPRESSED_REPEAT]', {
          conversationId,
          enterpriseId: ent.id,
          mediaType: 'video',
        });
      } else {
        const offerableVideos = await resolveSendableEnterpriseVideoFilesCurrentVersion(ent.id, 1, { requireOfferable: true });
        if (offerableVideos.length > 0) {
          console.log('[ANA_PROACTIVE_VIDEO_OFFER_AVAILABLE]', { conversationId, enterpriseId: ent.id, fileId: offerableVideos[0]?.id ?? null });
          console.log('[ANA_MEDIA_OFFER_CONTEXT_ALLOWED]', {
            conversationId,
            enterpriseId: ent.id,
            mediaType: 'video',
          });
          const offerText = 'Tenho um vídeo do empreendimento que ajuda a visualizar melhor a estrutura. Posso te enviar?';
          const offerSend = await sendTextMessage({
            conversationId,
            to: toPhoneNumber,
            text: offerText,
            phase: 'ana_proactive_video_offer',
          });
          if (offerSend.success && offerSend.metaMessageId) {
            await insertMessage(conversationId, 'assistant', offerText, offerSend.metaMessageId);
            console.log('[ANA_PROACTIVE_VIDEO_OFFER_SENT]', { conversationId, enterpriseId: ent.id });
            console.log('[ANA_MEDIA_OFFER_SENT]', {
              conversationId,
              enterpriseId: ent.id,
              mediaType: 'video',
              phase: 'offer_prompt',
            });
            await mergeConversationCommercialFlowState(conversationId, {
              pending_material_type: 'video',
              pending_action: 'send_material',
              last_requested_material_type: 'video',
            });
            return;
          }
        }
      }
    }

    if (!globalNoEnterpriseMode && isVideoMaterialRequest(trimmed)) {
      console.log('[ANA_PROACTIVE_VIDEO_ACCEPTED]', { conversationId, enterpriseId: ent?.id ?? null });
      console.log('[ANA_VIDEO_MATERIAL_REQUESTED]', {
        conversationId,
        enterpriseId: ent?.id ?? null,
        userMessage: trimmed.slice(0, 180),
      });
      if (!ent) {
        console.log('[ANA_VIDEO_MATERIAL_NOT_AVAILABLE]', {
          conversationId,
          enterpriseId: null,
          reason: 'enterprise_not_resolved',
        });
        const notAvailableText =
          'Não tenho vídeos liberados para envio por aqui no momento. Quer que eu te explique algum ponto específico do empreendimento?';
        const sendNotAvailable = await sendTextMessage({
          conversationId,
          to: toPhoneNumber,
          text: notAvailableText,
          phase: 'ana_video_material_not_available',
        });
        if (sendNotAvailable.success && sendNotAvailable.metaMessageId) {
          await insertMessage(conversationId, 'assistant', notAvailableText, sendNotAvailable.metaMessageId);
          anaTurnAuditOutcome = 'sent';
          anaTurnAuditBlockedReason = null;
          return;
        }
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'video_not_available_send_failed';
        return;
      }
      const videoFiles = await resolveSendableEnterpriseVideoFilesCurrentVersion(ent.id, 2);
      if (videoFiles.length === 0) {
        console.log('[ANA_VIDEO_MATERIAL_NOT_AVAILABLE]', {
          conversationId,
          enterpriseId: ent.id,
          reason: 'no_authorized_videos',
        });
        const notAvailableText =
          'Não tenho vídeos liberados para envio por aqui no momento. Quer que eu te explique algum ponto específico do empreendimento?';
        const sendNotAvailable = await sendTextMessage({
          conversationId,
          to: toPhoneNumber,
          text: notAvailableText,
          phase: 'ana_video_material_not_available',
        });
        if (sendNotAvailable.success && sendNotAvailable.metaMessageId) {
          await insertMessage(conversationId, 'assistant', notAvailableText, sendNotAvailable.metaMessageId);
          anaTurnAuditOutcome = 'sent';
          anaTurnAuditBlockedReason = null;
          return;
        }
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'video_not_available_send_failed';
        return;
      }
      console.log('[ANA_VIDEO_MATERIAL_FOUND]', {
        conversationId,
        enterpriseId: ent.id,
        count: videoFiles.length,
      });
      let sentCount = 0;
      let lastSentVideo: (typeof videoFiles)[number] | null = null;
      for (const [idx, video] of videoFiles.entries()) {
        if (idx > 0) await sleepMs(900);
        const mediaOutcome = await sendAnaEnterpriseMediaFirst({
          conversationId,
          toPhoneNumber,
          ent,
          enterpriseIdForFile: ent.id,
          cat: video.category,
          preResolvedFile: video,
        });
        if (!mediaOutcome.ok) continue;
        sentCount += 1;
        lastSentVideo = video;
      }
      if (sentCount > 0) {
        const rowsAfterVideoSend = await getMessagesByConversationId(conversationId);
        const recentAssistantReplies = rowsAfterVideoSend
          .filter((msg) => msg.role === 'assistant')
          .map((msg) => String(msg.content ?? '').trim())
          .filter((msg) => msg.length > 0)
          .slice(-8);
        await maybeSendAnaMediaPostSendFollowup({
          conversationId,
          toPhoneNumber,
          flowState: flowStateParsed,
          mediaKind: 'video',
          mediaCategory: (lastSentVideo?.category ?? 'outro') as FileCategory,
          mediaFileName: lastSentVideo?.originalName ?? null,
          recentAssistantReplies,
          replyPipelineToken,
        });
        console.log('[ANA_VIDEO_MATERIAL_SENT]', {
          conversationId,
          enterpriseId: ent.id,
          sentCount,
        });
        anaTurnAuditOutcome = 'material_sent';
        anaTurnAuditBlockedReason = null;
        return;
      }
      console.log('[ANA_VIDEO_MATERIAL_NOT_AVAILABLE]', {
        conversationId,
        enterpriseId: ent.id,
        reason: 'send_failed_all',
      });
      const notAvailableText =
        'Não tenho vídeos liberados para envio por aqui no momento. Quer que eu te explique algum ponto específico do empreendimento?';
      const sendNotAvailable = await sendTextMessage({
        conversationId,
        to: toPhoneNumber,
        text: notAvailableText,
        phase: 'ana_video_material_not_available',
      });
      if (sendNotAvailable.success && sendNotAvailable.metaMessageId) {
        await insertMessage(conversationId, 'assistant', notAvailableText, sendNotAvailable.metaMessageId);
        anaTurnAuditOutcome = 'sent';
        anaTurnAuditBlockedReason = null;
        return;
      }
      anaTurnAuditOutcome = 'send_failed';
      anaTurnAuditBlockedReason = 'video_not_available_send_failed';
      return;
    }

    if (!globalNoEnterpriseMode && isImageMaterialRequest(trimmed)) {
      console.log('[ANA_IMAGE_MATERIAL_REQUESTED]', {
        conversationId,
        enterpriseId: ent?.id ?? null,
        userMessage: trimmed.slice(0, 180),
      });
      if (!ent) {
        console.log('[ANA_IMAGE_MATERIAL_NOT_AVAILABLE]', {
          conversationId,
          enterpriseId: null,
          reason: 'enterprise_not_resolved',
        });
        const notAvailableText =
          'Não tenho fotos liberadas para envio por aqui no momento. Quer que eu te explique algum ponto específico do empreendimento?';
        const sendNotAvailable = await sendTextMessage({
          conversationId,
          to: toPhoneNumber,
          text: notAvailableText,
          phase: 'ana_image_material_not_available',
        });
        if (sendNotAvailable.success && sendNotAvailable.metaMessageId) {
          await insertMessage(conversationId, 'assistant', notAvailableText, sendNotAvailable.metaMessageId);
          anaTurnAuditOutcome = 'sent';
          anaTurnAuditBlockedReason = null;
          return;
        }
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'image_not_available_send_failed';
        return;
      }
      const requestedImageTopic = extractAnaImageFilenameTopic(trimmed);
      const imageFiles = await resolveSendableEnterpriseImageFilesCurrentVersion(ent.id, requestedImageTopic ? 20 : 3);
      const selectedImageFiles = requestedImageTopic
        ? filterAnaImageFilesByFilenameTopic(imageFiles, requestedImageTopic).slice(0, 6)
        : imageFiles;
      if (imageFiles.length === 0) {
        console.log('[ANA_IMAGE_MATERIAL_NOT_AVAILABLE]', {
          conversationId,
          enterpriseId: ent.id,
          reason: 'no_authorized_images',
          requestedImageTopic,
        });
        const notAvailableText =
          'Não tenho fotos liberadas para envio por aqui no momento. Quer que eu te explique algum ponto específico do empreendimento?';
        const sendNotAvailable = await sendTextMessage({
          conversationId,
          to: toPhoneNumber,
          text: notAvailableText,
          phase: 'ana_image_material_not_available',
        });
        if (sendNotAvailable.success && sendNotAvailable.metaMessageId) {
          await insertMessage(conversationId, 'assistant', notAvailableText, sendNotAvailable.metaMessageId);
          anaTurnAuditOutcome = 'sent';
          anaTurnAuditBlockedReason = null;
          return;
        }
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'image_not_available_send_failed';
        return;
      }
      if (requestedImageTopic && selectedImageFiles.length === 0) {
        console.log('[ANA_IMAGE_MATERIAL_NOT_AVAILABLE]', {
          conversationId,
          enterpriseId: ent.id,
          reason: 'no_matching_image_filename_topic',
          requestedImageTopic,
          authorizedImageCount: imageFiles.length,
          authorizedImageNames: imageFiles.map((file) => file.originalName).slice(0, 20),
        });
        const notAvailableText =
          'Nao encontrei foto especifica desse ambiente entre os arquivos liberados. Posso te enviar as fotos disponiveis do empreendimento ou te encaminhar para um corretor.';
        const sendNotAvailable = await sendTextMessage({
          conversationId,
          to: toPhoneNumber,
          text: notAvailableText,
          phase: 'ana_image_topic_not_available',
        });
        if (sendNotAvailable.success && sendNotAvailable.metaMessageId) {
          await insertMessage(conversationId, 'assistant', notAvailableText, sendNotAvailable.metaMessageId);
          anaTurnAuditOutcome = 'sent';
          anaTurnAuditBlockedReason = null;
          return;
        }
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'image_topic_not_available_send_failed';
        return;
      }
      console.log('[ANA_IMAGE_MATERIAL_FOUND]', {
        conversationId,
        enterpriseId: ent.id,
        count: selectedImageFiles.length,
        requestedImageTopic,
        selectedImageNames: selectedImageFiles.map((file) => file.originalName),
      });
      let sentCount = 0;
      const sentImageNames: string[] = [];
      for (const [idx, img] of selectedImageFiles.entries()) {
        if (idx > 0) await sleepMs(900);
        const mediaOutcome = await sendAnaEnterpriseMediaFirst({
          conversationId,
          toPhoneNumber,
          ent,
          enterpriseIdForFile: ent.id,
          cat: img.category,
          preResolvedFile: img,
        });
        if (!mediaOutcome.ok) continue;
        sentCount += 1;
        sentImageNames.push(img.originalName);
      }
      if (sentCount > 0) {
        const commercialContext = await loadImageMaterialCommercialContextForModel(ent, trimmed);
        await sendAnaImageMaterialPostSendModelReply({
          enterprise: ent,
          requestedTheme: requestedImageTopic,
          sentImages: sentImageNames,
          lastUserMessage: trimmed,
          commercialContext,
          phase: 'ana_image_material_model_followup',
        });
        console.log('[ANA_IMAGE_MATERIAL_SENT]', {
          conversationId,
          enterpriseId: ent.id,
          sentCount,
        });
        anaTurnAuditOutcome = 'material_sent';
        anaTurnAuditBlockedReason = null;
        return;
      }
      console.log('[ANA_IMAGE_MATERIAL_NOT_AVAILABLE]', {
        conversationId,
        enterpriseId: ent.id,
        reason: 'send_failed_all',
      });
      const notAvailableText =
        'Não tenho fotos liberadas para envio por aqui no momento. Quer que eu te explique algum ponto específico do empreendimento?';
      const sendNotAvailable = await sendTextMessage({
        conversationId,
        to: toPhoneNumber,
        text: notAvailableText,
        phase: 'ana_image_material_not_available',
      });
      if (sendNotAvailable.success && sendNotAvailable.metaMessageId) {
        await insertMessage(conversationId, 'assistant', notAvailableText, sendNotAvailable.metaMessageId);
        anaTurnAuditOutcome = 'sent';
        anaTurnAuditBlockedReason = null;
        return;
      }
      anaTurnAuditOutcome = 'send_failed';
      anaTurnAuditBlockedReason = 'image_not_available_send_failed';
      return;
    }

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
    if (materialTurnResult.handled && !globalNoEnterpriseMode) {
      if (materialTurnResult.status === 'MATERIAL_SENT') {
        anaTurnAuditOutcome = 'material_sent';
        anaTurnAuditBlockedReason = null;
      } else if (materialTurnResult.status === 'SEND_FAILED') {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'material_flow_send_failed_handoff';
      } else {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = `material_flow_${materialTurnResult.status.toLowerCase()}_handoff`;
      }
      if (materialTurnResult.status !== 'MATERIAL_SENT') {
        console.log('[ANA_MATERIAL_FLOW_BLOCKED]', {
          conversationId,
          status: materialTurnResult.status,
          blockedReason: anaTurnAuditBlockedReason,
        });
      }
      return;
    } else if (materialTurnResult.handled && globalNoEnterpriseMode) {
      console.log('[ANA_NO_ENTERPRISE_MATERIAL_FLOW_CONTINUES_TO_LLM]', {
        conversationId,
        status: materialTurnResult.status,
        failureReason: materialTurnResult.log.failureReason ?? null,
      });
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
    const authorizedLocationLink = pickAuthorizedLocationLink(vars);
    const authorizedLocationAddress = pickAuthorizedLocationAddress(vars);
    let commercialSnapshots: CommercialSnapshot[] = [];
    if (globalNoEnterpriseMode) {
      commercialSnapshots = [];
    } else if (mode === 'scoped' && ent) {
      commercialSnapshots = [{ enterpriseName: ent.name, variables: vars }];
    } else {
      for (const e of enterprisesPool) {
        commercialSnapshots.push({ enterpriseName: e.name, variables: await getVariablesMap(e.id) });
      }
    }

    const anaBudgetConfig = getAnaTokenBudgetConfig();
    const likelyLocalRuntimeForRag =
      isLocalOrCustomProviderContext(resolvedAiSettings.openaiBaseUrl) ||
      isQwenLikeModel(resolvedAiSettings.modelHotLead) ||
      isQwenLikeModel(resolvedAiSettings.modelColdLead);
    const evoraKnowledgePriority = isEvoraEnterpriseName(ent?.name ?? null);
    const localQwenMaxChunks = anaBudgetConfig.ragMaxChunks;
    const promptRagMaxContextChars = Math.max(2_400, Math.min(9_000, anaBudgetConfig.targetInputTokens * 4));
    const shortConversationContext = fullUserUtterances.slice(-2_400);
    const pendingRegionDeepDiveBeforeRag = resolvePendingRegionDeepDiveTopic({
      currentUserText: trimmed,
      expandedUserText: userMessageForReasoning,
      rows: rows.map((row) => ({ role: row.role, content: String(row.content ?? '') })),
      lastAssistantQuestionText: shortConfirmationContext.lastAssistantQuestionText ?? null,
      lastOfferedTopics: shortConfirmationContext.lastOfferedTopics ?? [],
    });
    const regionDeepDiveRagHint = pendingRegionDeepDiveBeforeRag.resolved
      ? [
          'aprofundamento de regiao Atibaia regiao bragantina gastronomia Avenida Lucas Nogueira Garcez clima',
          'Pedreira Rio Abaixo Rodovia Dom Pedro I 50 minutos Sao Paulo moradia casa de veraneio',
          'secao 5 regiao localizacao estilo de vida',
        ].join('\n')
      : '';
    const chunkHint = [userMessageForReasoning, regionDeepDiveRagHint, shortConversationContext]
      .filter(Boolean)
      .join('\n')
      .slice(0, likelyLocalRuntimeForRag ? 3_200 : 12_000);
    const commercialAxisForRagRequest = inferUserRequestedAxis(userMessageForReasoning);
    const commercialTopicForRagRequest = detectRequestedTopicForTurn(userMessageForReasoning);
    if (
      ANA_LLM_FIRST_COMMERCIAL_REPLIES &&
      isEvoraEnterpriseName(ent?.name ?? null) &&
      (commercialAxisForRagRequest != null ||
        (commercialTopicForRagRequest != null &&
          !['visita', 'corretor', 'rota'].includes(commercialTopicForRagRequest)))
    ) {
      console.log('[ANA_COMMERCIAL_RAG_CONTEXT_REQUESTED]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        enterpriseName: ent?.name ?? null,
        axis: commercialAxisForRagRequest,
        topic: commercialTopicForRagRequest,
        maxChunks: localQwenMaxChunks,
        maxContextChars: promptRagMaxContextChars,
      });
    }
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
      if (pendingRegionDeepDiveBeforeRag.resolved) {
        console.log('[ANA_REGION_RAG_CONTEXT_REQUESTED]', {
          conversationId,
          enterpriseId: eid,
          enterpriseName: row.name,
          reason: pendingRegionDeepDiveBeforeRag.reason,
          hintPreview: regionDeepDiveRagHint.slice(0, 220),
          selectedChunkCount: chunkMeta.selectedChunkCount,
          selectedChunkIds: chunkMeta.selectedChunkIds.slice(0, 20),
          sourceFiles: chunkMeta.sourceFiles.slice(0, 10),
        });
      }
      const chunk = (chunkMeta.promptText || '').slice(0, promptRagMaxContextChars);
      if (chunkMeta.retrievalError && !ragRetrievalError) {
        ragRetrievalError = chunkMeta.retrievalError;
      }
      ragChunksFound += likelyLocalRuntimeForRag
        ? Math.min(chunkMeta.selectedChunkCount, localQwenMaxChunks)
        : chunkMeta.selectedChunkCount;
      for (const chunkId of chunkMeta.selectedChunkIds) ragChunkIds.add(chunkId);
      for (const fileName of chunkMeta.sourceFiles) ragSourceFiles.add(fileName);
      const safeChunk = evoraKnowledgePriority ? sanitizeEvoraRestrictedKnowledgeForAna(chunk || '') : chunk;
      const merged = safeChunk;
      if (merged.trim()) knowledgeParts.push(`--- ${row.name} ---\n${merged}`);
    }
    const knowledgeText = knowledgeParts.join('\n\n').slice(0, promptRagMaxContextChars);
    const knowledgeLocationLink = pickLocationLinkFromKnowledge(knowledgeText);
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
    const safeTopicAvailabilityForPolicy = buildSafeTopicAvailabilityForPolicy({
      evidence: enterpriseEvidence,
      sendableCategories: sendableAnaCategories,
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
    if (globalNoEnterpriseMode) {
      allEnterpriseNames = [];
    } else if (mode === 'scoped' && ent) {
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
        isEmptyCommercialFlowState(effectiveConv.commercial_flow_state) ? 'null' : JSON.stringify(flowStateParsed).slice(0, 1_200)
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
    anaTurnContextResolved = resolveAnaConversationTurn({
      conversationId,
      currentUserText: trimmed,
      expandedUserText: userMessageForReasoning,
      rows: rows.map((row) => ({ role: row.role, content: String(row.content ?? '') })),
      flowState: flowStateParsed,
      lastAssistantQuestionText: shortConfirmationContext.lastAssistantQuestionText ?? null,
      lastAssistantQuestionType: shortConfirmationContext.lastAssistantQuestionType ?? null,
      lastOfferedTopics: shortConfirmationContext.lastOfferedTopics ?? [],
      requestedAxis: currentAxisForRepetition,
    });
    const isRegionDeepDiveResolved =
      anaTurnContextResolved.requestedTopic === 'region_deep_dive' || pendingRegionDeepDiveBeforeRag.resolved;
    if (isRegionDeepDiveResolved) {
      console.log('[ANA_REGION_DEEP_DIVE_DETECTED]', {
        conversationId,
        requestedTopic: anaTurnContextResolved.requestedTopic,
        commercialAxis: anaTurnContextResolved.commercialAxis,
        reason: pendingRegionDeepDiveBeforeRag.reason,
        userText: trimmed.slice(0, 160),
        expandedUserText: userMessageForReasoning.slice(0, 220),
      });
      console.log('[ANA_PENDING_REGION_TOPIC_RESOLVED]', {
        conversationId,
        requestedTopic: anaTurnContextResolved.requestedTopic,
        commercialAxis: anaTurnContextResolved.commercialAxis,
        preRagReason: pendingRegionDeepDiveBeforeRag.reason,
        decisionPath: anaTurnContextResolved.decisionPath,
        userText: trimmed.slice(0, 160),
        assistantContextPreview: pendingRegionDeepDiveBeforeRag.assistantContextPreview,
      });
      console.log('[ANA_QWEN_REQUIRED_FOR_REGION_DEEP_DIVE]', {
        conversationId,
        requestedTopic: anaTurnContextResolved.requestedTopic,
        commercialAxis: anaTurnContextResolved.commercialAxis,
        reason: 'region_deep_dive_requires_rag_qwen',
      });
    }
    if (
      anaTurnContextResolved.acceptedOfferTopic &&
      shortConfirmationContext.source === 'state' &&
      shortConfirmationContext.kind === 'followup_topic_confirmation'
    ) {
      console.log('[ANA_ACCEPTED_COMMITTED_TOPIC_OFFER]', {
        conversationId,
        topic: anaTurnContextResolved.acceptedOfferTopic,
        source: 'committed_reply_state',
      });
    }
    if (
      anaTurnContextResolved.requestedTopic === 'localizacao' &&
      !isLocationLinkRequest(trimmed)
    ) {
      console.log('[ANA_LOCATION_LINK_INTENT_REJECTED_DIRECT_LOCATION]', {
        conversationId,
        userText: trimmed.slice(0, 160),
        requestedTopic: anaTurnContextResolved.requestedTopic,
      });
    }
    const offeredTopicsFromHistory = (anaTurnContextResolved.lastOfferedTopics ?? [])
      .map((topic) => normalizeOfferedTopicForTurn(topic))
      .filter((topic): topic is AnaTurnTopic => topic != null);
    const staleTopicsIgnored = offeredTopicsFromHistory.filter(
      (topic) => anaTurnContextResolved?.requestedTopic && topic !== anaTurnContextResolved.requestedTopic
    );
    if (staleTopicsIgnored.length > 0 && anaTurnContextResolved.requestedTopic) {
      console.log('[ANA_CONTEXT_STALE_TOPIC_IGNORED]', {
        conversationId,
        requestedTopic: anaTurnContextResolved.requestedTopic,
        ignoredTopics: [...new Set(staleTopicsIgnored)],
      });
      anaTurnContextResolved.decisionPath.push('stale_topic_ignored');
    }
    console.log('[ANA_TURN_CONTEXT_RESOLVED]', {
      conversationId: anaTurnContextResolved.conversationId,
      currentUserText: anaTurnContextResolved.currentUserText.slice(0, 220),
      requestedTopic: anaTurnContextResolved.requestedTopic,
      acceptedOfferTopic: anaTurnContextResolved.acceptedOfferTopic,
      commercialAxis: anaTurnContextResolved.commercialAxis,
      lastAssistantQuestionType: anaTurnContextResolved.lastAssistantQuestionType,
      lastOfferedTopics: anaTurnContextResolved.lastOfferedTopics,
      topicsAlreadyAnswered: anaTurnContextResolved.topicsAlreadyAnswered,
      decisionPath: anaTurnContextResolved.decisionPath,
    });
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

    if (
      effectiveConv.pending_resolution_choice === true &&
      (pendingResolutionChoiceIntent === 'ambiguous' || pendingResolutionChoiceIntent === 'broker')
    ) {
      if (pendingResolutionChoiceIntent === 'ambiguous') {
        const clarificationReply =
          'Voce prefere que eu te encaminhe ao corretor ou que eu te ajude a agendar uma visita?';
        if (isPipelineStale(conversationId, replyPipelineToken)) {
          anaTurnAuditOutcome = 'silent';
          anaTurnAuditBlockedReason = 'pipeline_stale_before_pending_resolution_send';
          return;
        }
        const clarificationSend = await sendAnaOutboundMessages({
          conversationId,
          toPhoneNumber,
          text: clarificationReply,
          phase: 'ana_pending_resolution_choice',
          replyPipelineToken,
        });
        if (!clarificationSend.success || clarificationSend.metaMessageIds.length === 0) {
          anaTurnAuditOutcome = 'send_failed';
          anaTurnAuditBlockedReason = 'pending_resolution_send_failed';
          return;
        }
        anaTurnAuditOutcome = 'sent';
        anaTurnAuditBlockedReason = null;
        console.log('[ANA_PENDING_RESOLUTION_AMBIGUOUS_CHOICE]', {
          conversationId,
          choice: pendingResolutionChoiceIntent,
        });
        return;
      }

      const pendingResolutionModelResolution = resolveAnaOpenAIModel({
        configuredModelFromDb: (aiSettings?.modelHotLead || '').trim() || null,
        slot: 'hot_lead',
        provider: anaTurnDiagnostics.provider,
        baseUrl: aiSettings?.openaiBaseUrl ?? null,
      });
      if (pendingResolutionModelResolution.blocked) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = pendingResolutionModelResolution.reason;
        anaTurnAuditLlmStatus = 'blocked';
        anaTurnAuditErrorCode = pendingResolutionModelResolution.reason;
        anaTurnAuditErrorMessage = 'Modelo operacional da Ana nao esta configurado corretamente.';
        return;
      }
      const pendingResolutionModel = pendingResolutionModelResolution.finalModel;
      const pendingResolutionContext =
        pendingResolutionChoiceIntent === 'broker'
          ? [
              '[CONTEXTO OPERACIONAL - NAO MOSTRAR AO CLIENTE]',
              'O cliente escolheu falar com o corretor responsavel.',
              'Responda de forma curta e natural confirmando que o atendimento sera encaminhado.',
              'Nao invente dados comerciais.',
              'Nao ofereca visita neste momento.',
              '[/CONTEXTO OPERACIONAL]',
            ].join('\n')
          : [
              '[CONTEXTO OPERACIONAL - NAO MOSTRAR AO CLIENTE]',
              'O cliente respondeu de forma ambigua a uma pergunta com duas opcoes.',
              'Ele precisa escolher entre:',
              '1. encaminhamento para o corretor responsavel;',
              '2. agendamento de visita.',
              'Responda de forma natural e curta pedindo que ele escolha uma das duas opcoes.',
              'Nao invente dados comerciais.',
              '[/CONTEXTO OPERACIONAL]',
            ].join('\n');
      if (pendingResolutionChoiceIntent === 'broker') {
        console.log('[ANA_HANDOFF_CONFIRMATION_CONTEXT_INJECTED]', { conversationId });
      } else {
        console.log('[ANA_PENDING_RESOLUTION_AMBIGUOUS_CHOICE]', {
          conversationId,
          choice: pendingResolutionChoiceIntent,
        });
      }
      const pendingResolutionMessages: ChatMessage[] = [
        { role: 'system', content: pendingResolutionContext },
        { role: 'user', content: trimmed },
      ];
      const pendingResolutionResult = await generateChatCompletion({
        apiKey: aiApiKey,
        baseUrl: aiSettings.openaiBaseUrl,
        model: pendingResolutionModel,
        messages: pendingResolutionMessages,
        temperature: Math.min(aiSettings.temperature, 0.65),
        maxTokens: Math.max(aiSettings.maxTokens, 450),
        responseFormatJson: false,
      });
      captureLlmAudit(
        pendingResolutionResult,
        pendingResolutionChoiceIntent === 'broker'
          ? 'pending_resolution_broker_confirmation'
          : 'pending_resolution_ambiguous_disambiguation'
      );
      const pendingResolutionReplyRaw = (pendingResolutionResult.content || '').trim();
      if (pendingResolutionResult.success && pendingResolutionReplyRaw) {
        const pendingResolutionReply = finalizeAnaReplyText(pendingResolutionReplyRaw, {
          userMessage: trimmed,
          lastAssistantMessage: lastAssistantPlain,
          conversationMode: mode,
          isFirstAnaReply,
          enterpriseName: ent?.name ?? null,
          isKnowledgeGapTurn: true,
        }).slice(0, 4000);
        if (pendingResolutionReply.trim()) {
          if (isPipelineStale(conversationId, replyPipelineToken)) {
            anaTurnAuditOutcome = 'silent';
            anaTurnAuditBlockedReason = 'pipeline_stale_before_pending_resolution_send';
            return;
          }
          const pendingResolutionSend = await sendAnaOutboundMessages({
            conversationId,
            toPhoneNumber,
            text: pendingResolutionReply,
            phase: 'ana_pending_resolution_choice',
            replyPipelineToken,
          });
          if (!pendingResolutionSend.success || pendingResolutionSend.metaMessageIds.length === 0) {
            anaTurnAuditOutcome = 'send_failed';
            anaTurnAuditBlockedReason = 'pending_resolution_send_failed';
            return;
          }
          if (pendingResolutionChoiceIntent === 'broker') {
            let assignment: Awaited<ReturnType<typeof assignConversationToNextBroker>> = null;
            try {
              assignment = await assignConversationToNextBroker({
                conversationId,
                reason: 'pending_resolution_broker_choice',
              });
            } catch (error) {
              console.error('[ANA_BROKER_ASSIGNMENT_FAILED]', {
                conversationId,
                reason: 'pending_resolution_broker_choice',
                error: error instanceof Error ? error.message : String(error),
              });
            }
            if (!assignment) {
              console.warn('[ANA_BROKER_ASSIGNMENT_FAILED]', {
                conversationId,
                reason: 'conversation_not_found_after_customer_confirmation',
              });
            } else {
              await verifyAndRepairHandoffAfterBrokerAssignment(assignment);
              await cancelAnaVisitFollowupForConversation({
                conversationId,
                reason: 'handoff',
              });

              if (assignment.assignedBrokerId != null) {
                const enterpriseNameForNotification =
                  assignment.enterpriseName ?? ent?.name ?? 'empreendimento';

                await sendBrokerPendingAttendanceTemplate({
                  brokerPhone: assignment.assignedBrokerPhone,
                  brokerName: assignment.assignedBrokerName,
                  customerNameOrPhone: assignment.customerNameOrPhone,
                  enterpriseName: enterpriseNameForNotification,
                  conversationId,
                });

                await sendBrokerPendingAttendancePush({
                  brokerId: assignment.assignedBrokerId,
                  conversationId,
                  enterpriseId: assignment.enterpriseId,
                  customerNameOrPhone: assignment.customerNameOrPhone,
                  enterpriseName: enterpriseNameForNotification,
                });

                await publishConversationUpdated(conversationId);
              }

              console.log('[ANA_HANDOFF_ACCEPTED_BY_CUSTOMER]', {
                conversationId,
                assignedBrokerId: assignment.assignedBrokerId,
                handoffReason: assignment.handoffReason,
              });
            }
          }
          anaTurnAuditOutcome = 'sent';
          anaTurnAuditBlockedReason = null;
          return;
        }
      }
    }

    const userRefusedScheduling =
      isVisitSchedulingRefusal(trimmed) || isVisitSchedulingRefusalMessage(trimmed);
    const explicitVisitSchedulingNegativeThisTurn = isExplicitVisitSchedulingNegativeMessage(trimmed);
    const userIrritatedNow = isUserIrritated(trimmed);
    if (
      userRefusedScheduling &&
      !explicitVisitSchedulingNegativeThisTurn &&
      flowStateParsed.pendingVisitScheduling === true
    ) {
      const cancelledSchedulingState = {
        ...flowStateParsed,
        pendingVisitScheduling: false,
        pendingVisitDateLabel: null,
        pendingVisitDay: null,
        pendingVisitDate: null,
        pendingVisitTime: null,
        pendingVisitPeriod: null,
        pendingVisitEnterpriseId: null,
        pendingVisitInvalidTime: null,
        pendingVisitMissingSlot: null,
        pendingVisitCustomerName: null,
        pendingVisitConfirmationAsked: false,
        updatedAt: new Date().toISOString(),
      };
      await mergeConversationCommercialFlowState(conversationId, cancelledSchedulingState);
      flowStateParsed = cancelledSchedulingState;
      console.log('[ANA_VISIT_STATE_SAVED]', {
        conversationId,
        source: 'visit_cancelled_by_user',
        pendingVisitScheduling: false,
        pendingVisitDay: null,
        pendingVisitTime: null,
        pendingVisitInvalidTime: null,
        pendingVisitMissingSlot: null,
        pendingVisitCustomerName: null,
      });
      console.log('[APPOINTMENT_FLOW_CANCELLED_BY_USER]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        reason: 'user_refused_scheduling',
        userMessagePreview: trimmed.slice(0, 220),
      });
      await cancelAnaVisitFollowupForConversation({
        conversationId,
        reason: 'visit_refused',
      });
      anaTurnAuditGuardsApplied.appointmentFlowCancelledByUser = true;
    }

    const rawDirectVisitSchedulingIntent = isVisitSchedulingIntent({
      userMessage: trimmed,
      flowState: flowStateParsed,
      confirmationContextKind: shortConfirmationContext.kind,
      resolvedIntent: anaDecision.resolvedIntent,
      primaryAxis: anaDecision.primaryAxis,
      currentAxis: anaDecision.currentAxis,
      requestedAxis: requestedAxisForPolicy,
      lastAssistantMessage: lastAssistantPlain,
      enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
      referenceNow: lastUserMessageAt,
    });
    const explicitVisitSchedulingAcceptanceThisTurn = isExplicitVisitSchedulingAcceptance(trimmed);
    const confirmedAcceptedVisitFlowActive =
      flowStateParsed.visitScheduling?.accepted === true &&
      (flowStateParsed.pendingVisitScheduling === true || flowStateParsed.visitScheduling?.active === true);
    const commercialQuestionThisTurn = isCommercialQuestionThatShouldBypassVisitScheduling(trimmed);
    const awaitingAlternativeSlotInterestForTurn =
      flowStateParsed.suggestedVisitStatus === 'declined' &&
      flowStateParsed.awaitingAlternativeSlotInterest === true;
    const alternativeSlotInterestAnswerThisTurn =
      awaitingAlternativeSlotInterestForTurn &&
      (
        isSuggestedSlotAlternativeInterestMessage(trimmed) ||
        explicitVisitSchedulingNegativeThisTurn
      );
    const visitSchedulingSlotAnswerThisTurn = isVisitSchedulingSlotAnswer({
      userMessage: trimmed,
      flowState: flowStateParsed,
      lastAssistantMessage: lastAssistantPlain,
      referenceNow: lastUserMessageAt,
    });
    const shouldBypassVisitSchedulingForCommercialQuestion =
      commercialQuestionThisTurn &&
      !explicitVisitSchedulingAcceptanceThisTurn &&
      !alternativeSlotInterestAnswerThisTurn &&
      !visitSchedulingSlotAnswerThisTurn;
    console.log('[ANA_VISIT_SCHEDULING_BYPASS_EVALUATED]', {
      conversationId,
      commercialQuestionThisTurn,
      explicitVisitSchedulingAcceptanceThisTurn,
      visitSchedulingSlotAnswerThisTurn,
      confirmedAcceptedVisitFlowActive,
      shouldBypassVisitSchedulingForCommercialQuestion,
      pendingVisitScheduling: flowStateParsed.pendingVisitScheduling === true,
      visitActive: flowStateParsed.visitScheduling?.active === true,
      visitAccepted: flowStateParsed.visitScheduling?.accepted === true,
      visitStatus: flowStateParsed.visitScheduling?.status ?? null,
    });
    const ackOnlyVisitCandidate = isVisitSchedulingAckOnlyMessage(trimmed);
    const lastAssistantAskedVisitOffer =
      shortConfirmationContext.lastAssistantQuestionType === 'visit_offer' ||
      isAssistantVisitOfferContextMessage(lastAssistantPlain);
    const visitFlowSuppressedByConfirmationContext =
      suppressVisitByConfirmationContext &&
      shortConfirmationContext.isShortConfirmation &&
      flowStateParsed.pendingVisitScheduling !== true &&
      !visitStateReconstructedThisTurn;
    const directVisitSchedulingIntent = visitFlowSuppressedByConfirmationContext
      ? false
      : (effectiveConv.pending_resolution_choice === true &&
        pendingResolutionChoiceIntent !== null &&
        pendingResolutionChoiceIntent !== 'visit')
        ? false
      : shouldBypassVisitSchedulingForCommercialQuestion
        ? false
      : rawDirectVisitSchedulingIntent;
    const hadVisitFlowSignalsBeforeSuppression =
      rawDirectVisitSchedulingIntent ||
      flowStateParsed.pendingVisitScheduling === true ||
      flowStateParsed.visitScheduling?.active === true;
    if (
      ackOnlyVisitCandidate &&
      !lastAssistantAskedVisitOffer &&
      flowStateParsed.pendingVisitScheduling !== true &&
      flowStateParsed.visitScheduling?.active !== true &&
      directVisitSchedulingIntent === false
    ) {
      console.log('[ANA_VISIT_CONFIRMATION_REJECTED_NO_VISIT_CONTEXT]', {
        conversationId,
        userMessage: trimmed.slice(0, 120),
        lastAssistantMessage: (lastAssistantPlain || '').slice(0, 220),
      });
    }
    if (visitFlowSuppressedByConfirmationContext) {
      console.log('[ANA_VISIT_INTENT_SUPPRESSED_BY_CONFIRMATION_CONTEXT]', {
        conversationId,
        shortConfirmationKind: shortConfirmationContext.kind,
        rawDirectVisitSchedulingIntent,
        hadVisitFlowSignalsBeforeSuppression,
        pendingVisitScheduling: flowStateParsed.pendingVisitScheduling === true,
        visitActive: flowStateParsed.visitScheduling?.active === true,
      });
      if (hadVisitFlowSignalsBeforeSuppression) {
        const previousVisitScheduling = flowStateParsed.visitScheduling ?? null;
        const clearedVisitSchedulingStatus: 'scheduled' | 'none' =
          previousVisitScheduling?.status === 'scheduled' ? 'scheduled' : 'none';
        const clearedVisitState: CommercialFlowState = {
          ...flowStateParsed,
          pendingVisitScheduling: false,
          pendingVisitDateLabel: null,
          pendingVisitDay: null,
          pendingVisitDate: null,
          pendingVisitTime: null,
          pendingVisitPeriod: null,
          pendingVisitEnterpriseId: null,
          pendingVisitInvalidTime: null,
          pendingVisitMissingSlot: null,
          pendingVisitCustomerName: null,
          pendingVisitConfirmationAsked: false,
          visitScheduling: previousVisitScheduling
            ? {
                ...previousVisitScheduling,
                active: false,
                accepted: previousVisitScheduling.status === 'scheduled' ? previousVisitScheduling.accepted : false,
                requestedDateText:
                  previousVisitScheduling.status === 'scheduled' ? previousVisitScheduling.requestedDateText : null,
                requestedTimeText:
                  previousVisitScheduling.status === 'scheduled' ? previousVisitScheduling.requestedTimeText : null,
                requestedPeriodText:
                  previousVisitScheduling.status === 'scheduled'
                    ? previousVisitScheduling.requestedPeriodText ?? null
                    : null,
                normalizedDate:
                  previousVisitScheduling.status === 'scheduled' ? previousVisitScheduling.normalizedDate : null,
                normalizedTime:
                  previousVisitScheduling.status === 'scheduled' ? previousVisitScheduling.normalizedTime : null,
                nameCollected:
                  previousVisitScheduling.status === 'scheduled' ? previousVisitScheduling.nameCollected : false,
                customerName:
                  previousVisitScheduling.status === 'scheduled' ? previousVisitScheduling.customerName : null,
                status: clearedVisitSchedulingStatus,
              }
            : undefined,
          updatedAt: new Date().toISOString(),
        };
        await mergeConversationCommercialFlowState(conversationId, clearedVisitState);
        flowStateParsed = clearedVisitState;
        console.log('[ANA_VISIT_STATE_SAVED]', {
          conversationId,
          source: 'visit_flow_cleared_by_confirmation_context',
          pendingVisitScheduling: false,
          pendingVisitDay: null,
          pendingVisitTime: null,
          pendingVisitInvalidTime: null,
          pendingVisitMissingSlot: null,
          pendingVisitCustomerName: null,
        });
      }
    }
    const visitTopicSwitchRequested =
      flowStateParsed.pendingVisitScheduling === true &&
      isVisitSchedulingTopicSwitchMessage(trimmed);
    const visitSchedulingFlowActiveForTurn =
      !shouldBypassVisitSchedulingForCommercialQuestion &&
      !visitTopicSwitchRequested &&
      !visitFlowSuppressedByConfirmationContext &&
      (explicitVisitSchedulingAcceptanceThisTurn ||
        alternativeSlotInterestAnswerThisTurn ||
        visitSchedulingSlotAnswerThisTurn ||
        directVisitSchedulingIntent ||
        (flowStateParsed.pendingVisitScheduling === true && !commercialQuestionThisTurn) ||
        flowStateParsed.visitScheduling?.active === true);
    if (shouldBypassVisitSchedulingForCommercialQuestion) {
      console.log('[ANA_VISIT_SCHEDULING_BYPASSED_COMMERCIAL_QUESTION]', {
        conversationId,
        userMessagePreview: trimmed.slice(0, 220),
        previousPendingVisitScheduling: flowStateParsed.pendingVisitScheduling === true,
        previousVisitAccepted: flowStateParsed.visitScheduling?.accepted === true,
        reason: 'commercial_question_without_explicit_visit_acceptance',
      });
      const hasWeakPendingVisitState =
        flowStateParsed.pendingVisitScheduling === true || flowStateParsed.visitScheduling?.active === true;
      if (hasWeakPendingVisitState) {
        const previousVisitScheduling = flowStateParsed.visitScheduling ?? null;
        const preserveScheduled = previousVisitScheduling?.status === 'scheduled';
        const clearedVisitState: CommercialFlowState = {
          ...flowStateParsed,
          pendingVisitScheduling: false,
          pendingVisitDateLabel: null,
          pendingVisitDay: null,
          pendingVisitDate: null,
          pendingVisitTime: null,
          pendingVisitPeriod: null,
          pendingVisitEnterpriseId: null,
          pendingVisitInvalidTime: null,
          pendingVisitMissingSlot: null,
          pendingVisitCustomerName: null,
          pendingVisitConfirmationAsked: false,
          visitScheduling: previousVisitScheduling
            ? {
                ...previousVisitScheduling,
                active: false,
                accepted: preserveScheduled ? previousVisitScheduling.accepted : false,
              }
            : undefined,
          updatedAt: new Date().toISOString(),
        };
        await mergeConversationCommercialFlowState(conversationId, clearedVisitState);
        flowStateParsed = clearedVisitState;
        console.log('[ANA_VISIT_STATE_CLEARED_AFTER_FALSE_POSITIVE]', {
          conversationId,
        });
      }
    }
    if (visitSchedulingFlowActiveForTurn) {
      console.log('[ANA_VISIT_FLOW_ACTIVE]', {
        conversationId,
        directVisitSchedulingIntent,
        pendingVisitScheduling: flowStateParsed.pendingVisitScheduling === true,
        visitStatus: flowStateParsed.visitScheduling?.status ?? null,
      });
      if (flowStateParsed.pendingVisitScheduling === true) {
        console.log('[ANA_VISIT_FLOW_CONTINUED_FROM_STATE]', {
          conversationId,
          pendingVisitDay: flowStateParsed.pendingVisitDay ?? flowStateParsed.pendingVisitDateLabel ?? null,
          pendingVisitTime: flowStateParsed.pendingVisitTime ?? null,
          pendingVisitInvalidTime: flowStateParsed.pendingVisitInvalidTime ?? null,
          pendingVisitMissingSlot: flowStateParsed.pendingVisitMissingSlot ?? null,
          pendingVisitCustomerName: flowStateParsed.pendingVisitCustomerName ?? null,
        });
      }
      console.log('[ANA_VISIT_FLOW_TURN_LOCKED]', {
        conversationId,
        directVisitSchedulingIntent,
        pendingVisitScheduling: flowStateParsed.pendingVisitScheduling === true,
        visitStatus: flowStateParsed.visitScheduling?.status ?? null,
      });
      console.log('[ANA_VISIT_FLOW_BYPASS_LLM]', {
        conversationId,
        reason: 'visit_flow_turn_locked_before_prompt_build',
      });
    }
    const visitAvailabilityEnterpriseId = ent?.id ?? effectiveConv.enterprise_id ?? null;
    let visitAvailabilitySuggestion: AnaVisitAvailabilitySlot | null = null;
    let visitAvailabilitySearchCompleted = false;
    let suggestedSlotValidation: AnaVisitSlotAvailabilityResult | null = null;
    let suggestedSlotReplacement: AnaVisitAvailabilitySlot | null = null;
    let suggestedSlotUnavailable = false;
    let exactSlotAvailability: AnaVisitSlotAvailabilityResult | null = null;
    let exactSlotUnavailableReplacement: AnaVisitAvailabilitySlot | null = null;
    let exactSlotUnavailable = false;

    if (visitSchedulingFlowActiveForTurn && !userRefusedScheduling && visitAvailabilityEnterpriseId != null) {
      const preferenceFromMessage = extractAnaVisitSlotPreferenceFromText(trimmed, lastUserMessageAt);
      const pendingSuggestedStartAt = flowStateParsed.suggestedVisitStartAt
        ? new Date(flowStateParsed.suggestedVisitStartAt)
        : null;
      const pendingSuggestedEndAt = flowStateParsed.suggestedVisitEndAt
        ? new Date(flowStateParsed.suggestedVisitEndAt)
        : null;
      const declinedSuggestedStartAt = flowStateParsed.suggestedVisitDeclinedStartAt
        ? new Date(flowStateParsed.suggestedVisitDeclinedStartAt)
        : null;
      const hasValidPendingSuggestedDates =
        pendingSuggestedStartAt instanceof Date &&
        !Number.isNaN(pendingSuggestedStartAt.getTime()) &&
        pendingSuggestedEndAt instanceof Date &&
        !Number.isNaN(pendingSuggestedEndAt.getTime());
      const hasValidDeclinedSuggestedStart =
        declinedSuggestedStartAt instanceof Date &&
        !Number.isNaN(declinedSuggestedStartAt.getTime());
      const awaitingSuggestedVisitSlot =
        flowStateParsed.pendingVisitScheduling === true &&
        flowStateParsed.suggestedVisitStatus === 'awaiting_confirmation' &&
        hasValidPendingSuggestedDates &&
        Boolean((flowStateParsed.suggestedVisitSlotLabel ?? '').trim());
      const alternativeSlotSearchAccepted =
        awaitingAlternativeSlotInterestForTurn &&
        hasValidDeclinedSuggestedStart &&
        isSuggestedSlotAlternativeInterestMessage(trimmed);
      const suggestedSlotAccepted =
        awaitingSuggestedVisitSlot &&
        !explicitVisitSchedulingNegativeThisTurn &&
        (
          isVisitSchedulingConfirmationMessage(trimmed) ||
          isVisitSchedulingAckOnlyMessage(trimmed) ||
          shortConfirmationContext.kind === 'visit_confirmation'
        );
      const normalizedForAvailability = normText(trimmed);
      const suggestedSlotChangeRequested =
        awaitingSuggestedVisitSlot &&
        !suggestedSlotAccepted &&
        (
          Boolean(preferenceFromMessage.dateYmd || preferenceFromMessage.timeHm || preferenceFromMessage.period) ||
          /\b(nao posso|nao consigo|nao da|outro|outra|tem outro|tem outra|melhor|prefiro|manha|tarde|noite)\b/.test(
            normalizedForAvailability
          )
        );
      const messageHasExplicitTime = Boolean(preferenceFromMessage.timeHm);
      const suggestedSlotAlternativeDayRequested =
        awaitingSuggestedVisitSlot &&
        !suggestedSlotAccepted &&
        /\b(outro dia|outra data|outro diazinho|em outro dia|para outro dia|pra outro dia)\b/.test(
          normalizedForAvailability
        );

      if (suggestedSlotAccepted && pendingSuggestedStartAt && pendingSuggestedEndAt) {
        suggestedSlotValidation = await validateVisitSlotStillAvailable({
          enterpriseId: visitAvailabilityEnterpriseId,
          startAt: pendingSuggestedStartAt,
          endAt: pendingSuggestedEndAt,
          preferredBrokerId: flowStateParsed.suggestedVisitBrokerId ?? null,
        });
        suggestedSlotUnavailable = !suggestedSlotValidation.available;
        if (suggestedSlotUnavailable) {
          suggestedSlotReplacement = await findNextAvailableVisitSlot({
            enterpriseId: visitAvailabilityEnterpriseId,
            referenceNow: lastUserMessageAt,
            preference: null,
          });
          visitAvailabilitySearchCompleted = true;
        }
      } else {
        const exactDateYmd =
          preferenceFromMessage.dateYmd ??
          (flowStateParsed.pendingVisitScheduling === true
            ? flowStateParsed.pendingVisitDate ?? flowStateParsed.visitScheduling?.normalizedDate ?? null
            : null);
        const exactTimeHm =
          preferenceFromMessage.timeHm ??
          (flowStateParsed.pendingVisitScheduling === true
            ? flowStateParsed.pendingVisitTime ?? flowStateParsed.visitScheduling?.normalizedTime ?? null
            : null);
        const hasExactSlotCandidate = Boolean(exactDateYmd && exactTimeHm);
        const explicitExactSlotAfterSuggestion =
          awaitingSuggestedVisitSlot &&
          suggestedSlotChangeRequested &&
          messageHasExplicitTime &&
          Boolean(exactDateYmd);
        const shouldValidateExactSlot =
          hasExactSlotCandidate &&
          !alternativeSlotSearchAccepted &&
          (
            explicitExactSlotAfterSuggestion ||
            (
              !awaitingSuggestedVisitSlot &&
              (
            Boolean(preferenceFromMessage.dateYmd && preferenceFromMessage.timeHm) ||
            flowStateParsed.pendingVisitConfirmationAsked === true ||
            flowStateParsed.pendingVisitScheduling === true
              )
            )
          );

        if (shouldValidateExactSlot && exactDateYmd && exactTimeHm) {
          const parsedExact = parseAppointmentStartEndInSaoPaulo(exactDateYmd, exactTimeHm);
          if (parsedExact) {
            exactSlotAvailability = await validateVisitSlotStillAvailable({
              enterpriseId: visitAvailabilityEnterpriseId,
              startAt: parsedExact.startAt,
              endAt: parsedExact.endAt,
              preferredBrokerId: flowStateParsed.suggestedVisitBrokerId ?? null,
            });
            exactSlotUnavailable = !exactSlotAvailability.available;
            visitAvailabilitySearchCompleted = true;
            if (!exactSlotUnavailable && exactSlotAvailability.brokerId != null) {
              visitAvailabilitySuggestion = {
                enterpriseId: visitAvailabilityEnterpriseId,
                startAt: parsedExact.startAt,
                endAt: parsedExact.endAt,
                startYmd: exactDateYmd,
                timeHm: exactTimeHm,
                brokerId: exactSlotAvailability.brokerId,
                eligibleBrokerCount: exactSlotAvailability.eligibleBrokerCount,
                timezone: APPOINTMENT_BUSINESS_TZ,
                label: formatAnaVisitSlotLabel({ startYmd: exactDateYmd, timeHm: exactTimeHm }, lastUserMessageAt),
              };
            } else {
              exactSlotUnavailableReplacement = await findNextAvailableVisitSlot({
                enterpriseId: visitAvailabilityEnterpriseId,
                referenceNow: lastUserMessageAt,
                minimumStartAt: parsedExact.startAt,
                excludeStartAt: parsedExact.startAt,
                preference: {
                  dateYmd: exactDateYmd,
                  period: preferenceFromMessage.period ?? null,
                  weekday: preferenceFromMessage.weekday ?? null,
                  timeHm: null,
                },
              });
            }
          } else {
            exactSlotUnavailable = true;
          }
        }

        const shouldFindSuggestedSlot =
          visitAvailabilitySuggestion == null &&
          !exactSlotUnavailable &&
          !shouldValidateExactSlot &&
          (
            alternativeSlotSearchAccepted ||
            !awaitingSuggestedVisitSlot ||
            suggestedSlotChangeRequested ||
            Boolean(preferenceFromMessage.dateYmd || preferenceFromMessage.period || preferenceFromMessage.weekday)
          );

        if (shouldFindSuggestedSlot) {
          const fallbackPendingDate =
            awaitingSuggestedVisitSlot && suggestedSlotChangeRequested
              ? (
                  suggestedSlotAlternativeDayRequested
                    ? (
                        (flowStateParsed.pendingVisitDate
                          ? addDaysYmdForAnaVisitAvailability(flowStateParsed.pendingVisitDate, 1)
                          : null) ?? null
                      )
                    : (preferenceFromMessage.period ? flowStateParsed.pendingVisitDate ?? null : null)
                )
              : flowStateParsed.pendingVisitDate ?? null;
          visitAvailabilitySuggestion = await findNextAvailableVisitSlot({
            enterpriseId: visitAvailabilityEnterpriseId,
            referenceNow: lastUserMessageAt,
            minimumStartAt:
              alternativeSlotSearchAccepted
                ? declinedSuggestedStartAt
                : awaitingSuggestedVisitSlot &&
              suggestedSlotChangeRequested &&
              !suggestedSlotAlternativeDayRequested &&
              !preferenceFromMessage.period
                ? pendingSuggestedStartAt
                : null,
            excludeStartAt: alternativeSlotSearchAccepted
              ? declinedSuggestedStartAt
              : awaitingSuggestedVisitSlot && suggestedSlotChangeRequested ? pendingSuggestedStartAt : null,
            preference: {
              dateYmd: preferenceFromMessage.dateYmd ?? fallbackPendingDate,
              weekday: preferenceFromMessage.weekday ?? null,
              period: preferenceFromMessage.period ?? null,
              timeHm: null,
            },
          });
          visitAvailabilitySearchCompleted = true;
        }
      }
    }

    const directVisitSchedulingDecision = visitSchedulingFlowActiveForTurn && (!userRefusedScheduling || explicitVisitSchedulingNegativeThisTurn)
      ? handleVisitSchedulingDeterministically({
          userMessage: trimmed,
          flowState: flowStateParsed,
          resolvedIntent: anaDecision.resolvedIntent,
          primaryAxis: anaDecision.primaryAxis,
          currentAxis: anaDecision.currentAxis,
          requestedAxis: requestedAxisForPolicy,
          lastAssistantMessage: lastAssistantPlain,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          customerName: trustedCustomerName || effectiveConv.customer_name || null,
          customerPhone: (effectiveConv.contact_phone || effectiveConv.external_contact_id || '').replace(/\D/g, ''),
          referenceNow: lastUserMessageAt,
          availabilitySuggestion: visitAvailabilitySuggestion,
          availabilitySearchCompleted: visitAvailabilitySearchCompleted,
          suggestedSlotValidation,
          suggestedSlotReplacement,
          suggestedSlotUnavailable,
          exactSlotAvailability,
          exactSlotUnavailableReplacement,
          exactSlotUnavailable,
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
      extractedPeriod: directVisitSchedulingDecision?.extractedPeriod ?? null,
      extractedTime: directVisitSchedulingDecision?.extractedTime ?? null,
      capturedSlots: directVisitSchedulingDecision?.capturedSlots ?? [],
      missingSlot: directVisitSchedulingDecision?.missingSlot ?? null,
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
      extractedPeriod: directVisitSchedulingAudit.extractedPeriod,
      extractedTime: directVisitSchedulingAudit.extractedTime,
      capturedSlots: directVisitSchedulingAudit.capturedSlots,
      missingSlot: directVisitSchedulingAudit.missingSlot,
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
      const visitCustomerNameBeforeDecision =
        (flowStateParsed.pendingVisitCustomerName || '').trim() || null;
      let scheduledVisitStateSnapshot: CommercialFlowState | null = null;
      let deterministicVisitReply = directVisitSchedulingDecision.reply;
      await mergeConversationCommercialFlowState(conversationId, directVisitSchedulingDecision.nextState);
      flowStateParsed = directVisitSchedulingDecision.nextState;
      console.log('[ANA_VISIT_STATE_SAVED]', {
        conversationId,
        source: 'direct_visit_decision',
        pendingVisitScheduling: flowStateParsed.pendingVisitScheduling === true,
        pendingVisitDay: flowStateParsed.pendingVisitDay ?? flowStateParsed.pendingVisitDateLabel ?? null,
        pendingVisitTime: flowStateParsed.pendingVisitTime ?? null,
        pendingVisitInvalidTime: flowStateParsed.pendingVisitInvalidTime ?? null,
        pendingVisitMissingSlot: flowStateParsed.pendingVisitMissingSlot ?? null,
        pendingVisitCustomerName: flowStateParsed.pendingVisitCustomerName ?? null,
      });
      for (const slot of directVisitSchedulingDecision.capturedSlots) {
        console.log('[ANA_VISIT_SLOT_CAPTURED]', {
          conversationId,
          slot,
          reason: directVisitSchedulingDecision.reason,
        });
      }
      if (directVisitSchedulingDecision.missingSlot) {
        console.log('[ANA_VISIT_MISSING_SLOT_REQUESTED]', {
          conversationId,
          missingSlot: directVisitSchedulingDecision.missingSlot,
          reason: directVisitSchedulingDecision.reason,
        });
      }
      if (
        directVisitSchedulingDecision.missingSlot === 'valid_time' &&
        directVisitSchedulingDecision.capturedSlots.includes('nome')
      ) {
        console.log('[ANA_VISIT_NAME_REQUEST_SUPPRESSED_INVALID_TIME]', {
          conversationId,
          reason: directVisitSchedulingDecision.reason,
          pendingVisitInvalidTime: directVisitSchedulingDecision.invalidVisitTime ?? null,
        });
      }
      if (
        directVisitSchedulingDecision.capturedSlots.includes('nome') &&
        directVisitSchedulingDecision.missingSlot !== 'nome'
      ) {
        console.log('[ANA_VISIT_NAME_ALREADY_KNOWN]', {
          conversationId,
          reason: directVisitSchedulingDecision.reason,
        });
      }
      if (
        directVisitSchedulingDecision.missingSlot === 'valid_time' ||
        directVisitSchedulingDecision.reason === 'time_outside_visit_window' ||
        directVisitSchedulingDecision.reason === 'time_outside_visit_window_repeat'
      ) {
        console.log('[ANA_VISIT_INVALID_TIME_REJECTED]', {
          conversationId,
          invalidVisitTime: directVisitSchedulingDecision.invalidVisitTime ?? null,
          reason: directVisitSchedulingDecision.reason,
        });
      }
      if (
        directVisitSchedulingDecision.missingSlot === 'valid_time' &&
        (isVisitSchedulingAckOnlyMessage(trimmed) || shortConfirmationContext.kind === 'visit_confirmation')
      ) {
        console.log('[ANA_VISIT_CONFIRMATION_BLOCKED_INVALID_SLOT]', {
          conversationId,
          userMessage: trimmed.slice(0, 120),
          reason: directVisitSchedulingDecision.reason,
        });
      }
      if (directVisitSchedulingDecision.reason === 'invalid_time_pending_confusion_repair') {
        console.log('[ANA_VISIT_FLOW_REPAIR_AFTER_CONFUSION]', {
          conversationId,
          userMessage: trimmed.slice(0, 120),
        });
      }

      let directVisitAppointmentRegistration: Awaited<ReturnType<typeof registerAnaAppointmentIfConfirmed>> | null = null;
      if (directVisitSchedulingDecision.appointmentConfirmed) {
        if (ent) {
          try {
            const convForApptRegister = await getConversationById(conversationId);
            directVisitAppointmentRegistration = await registerAnaAppointmentIfConfirmed({
              conversationId,
              customerName: (convForApptRegister?.customer_name || trustedCustomerName || '').trim(),
              customerPhone: (convForApptRegister?.contact_phone || convForApptRegister?.external_contact_id || '').replace(/\D/g, ''),
              enterpriseId: ent.id,
              city: '',
              appointmentConfirmed: true,
              appointmentDateYmd: directVisitSchedulingDecision.appointmentDateYmd,
              appointmentTimeHm: directVisitSchedulingDecision.appointmentTimeHm,
              notes: 'Agendamento confirmado no fluxo deterministico da Ana.',
              brokerId:
                directVisitSchedulingDecision.appointmentBrokerId ??
                convForApptRegister?.assigned_broker_id ??
                null,
              userUtteranceText: fullUserUtterances.trim() || trimmed,
              referenceNow: lastUserMessageAt,
            });
          } catch (e) {
            console.error('[ANA_DIRECT_VISIT_SCHEDULING] appointment_register_error', {
              conversationId,
              error: e instanceof Error ? e.message : String(e),
            });
          }
          const scheduledCustomerName = (
            trustedCustomerName ||
            effectiveConv.customer_name ||
            visitCustomerNameBeforeDecision ||
            ''
          ).trim();
          const scheduledHm = directVisitSchedulingDecision.appointmentTimeHm ?? null;
          const scheduledHh = scheduledHm ? Number.parseInt(scheduledHm.slice(0, 2), 10) : null;
          const scheduledMm = scheduledHm ? scheduledHm.slice(3, 5) : null;
          const scheduledTimeText =
            scheduledHm && Number.isFinite(scheduledHh)
              ? scheduledMm === '00'
                ? `${scheduledHh}h`
                : `${scheduledHh}h${scheduledMm}`
              : null;
          const scheduledState = {
            ...directVisitSchedulingDecision.nextState,
            pendingVisitScheduling: false,
            pendingVisitDateLabel: null,
            pendingVisitDay: null,
            pendingVisitDate: null,
            pendingVisitTime: null,
            pendingVisitPeriod: null,
            pendingVisitEnterpriseId: null,
            pendingVisitInvalidTime: null,
            pendingVisitMissingSlot: null,
            pendingVisitCustomerName: null,
            pendingVisitConfirmationAsked: false,
            visitScheduling: {
              active: false,
              offered: true,
              accepted: true,
              requestedDateText: directVisitSchedulingDecision.extractedDateLabel ?? null,
              requestedTimeText: scheduledTimeText,
              requestedPeriodText:
                directVisitSchedulingDecision.extractedPeriod === 'manha'
                  ? 'de manhã'
                  : directVisitSchedulingDecision.extractedPeriod === 'tarde'
                    ? 'à tarde'
                    : directVisitSchedulingDecision.extractedPeriod === 'noite'
                      ? 'à noite'
                      : null,
              normalizedDate: directVisitSchedulingDecision.appointmentDateYmd ?? null,
              normalizedTime: scheduledHm,
              nameCollected: scheduledCustomerName.length > 0,
              customerName: scheduledCustomerName || null,
              status: 'scheduled' as const,
            },
            updatedAt: new Date().toISOString(),
          };
          scheduledVisitStateSnapshot = scheduledState;
          await mergeConversationCommercialFlowState(conversationId, scheduledState);
          flowStateParsed = scheduledState;
          await cancelAnaVisitFollowupForConversation({
            conversationId,
            reason: 'visit_scheduled',
          });
          console.log('[ANA_VISIT_STATE_SAVED]', {
            conversationId,
            source: 'direct_visit_confirmed',
            pendingVisitScheduling: flowStateParsed.pendingVisitScheduling === true,
            pendingVisitDay: flowStateParsed.pendingVisitDay ?? flowStateParsed.pendingVisitDateLabel ?? null,
            pendingVisitTime: flowStateParsed.pendingVisitTime ?? null,
            pendingVisitInvalidTime: flowStateParsed.pendingVisitInvalidTime ?? null,
            pendingVisitMissingSlot: flowStateParsed.pendingVisitMissingSlot ?? null,
            pendingVisitCustomerName: flowStateParsed.pendingVisitCustomerName ?? null,
          });
        } else {
          deterministicVisitReply =
            'Perfeito, ja tenho dia e horario. Me confirma qual empreendimento voce quer visitar?';
          const waitingEnterpriseState = {
            ...directVisitSchedulingDecision.nextState,
            pendingVisitScheduling: true,
            pendingVisitDateLabel: directVisitSchedulingDecision.extractedDateLabel,
            pendingVisitDay: directVisitSchedulingDecision.extractedDateLabel,
            pendingVisitDate: directVisitSchedulingDecision.extractedDateYmd,
            pendingVisitTime: directVisitSchedulingDecision.appointmentTimeHm ?? null,
            pendingVisitPeriod: directVisitSchedulingDecision.extractedPeriod ?? null,
            pendingVisitEnterpriseId: null,
            pendingVisitInvalidTime: null,
            pendingVisitMissingSlot: null,
            pendingVisitCustomerName: flowStateParsed.pendingVisitCustomerName ?? null,
            pendingVisitConfirmationAsked: false,
            updatedAt: new Date().toISOString(),
          };
          await mergeConversationCommercialFlowState(conversationId, waitingEnterpriseState);
          flowStateParsed = waitingEnterpriseState;
          console.log('[ANA_VISIT_STATE_SAVED]', {
            conversationId,
            source: 'direct_visit_waiting_enterprise',
            pendingVisitScheduling: true,
            pendingVisitDay: directVisitSchedulingDecision.extractedDateLabel ?? null,
            pendingVisitTime: directVisitSchedulingDecision.appointmentTimeHm ?? null,
            pendingVisitInvalidTime: null,
            pendingVisitMissingSlot: null,
            pendingVisitCustomerName: flowStateParsed.pendingVisitCustomerName ?? null,
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
      if ((userRefusedScheduling && !explicitVisitSchedulingNegativeThisTurn) || repeatedVisitLoopReply) {
        const schedulingAlreadyScheduled =
          directVisitSchedulingDecision.nextState.visitScheduling?.status === 'scheduled' ||
          flowStateParsed.visitScheduling?.status === 'scheduled';
        console.warn('[ANA_REPEATED_RESPONSE_BLOCKED]', {
          conversationId,
          reason: userRefusedScheduling && !explicitVisitSchedulingNegativeThisTurn ? 'user_refused_scheduling' : 'repeated_visit_scheduling_reply',
          reply: deterministicVisitReply,
        });
        if (userRefusedScheduling && !explicitVisitSchedulingNegativeThisTurn) {
          deterministicVisitReply = userIrritatedNow
            ? 'Desculpa, você tem razão. Sem agendar visita agora. Vou te passar os detalhes por aqui.'
            : 'Claro, sem problema. Te passo os detalhes por aqui.';
        } else {
          deterministicVisitReply = schedulingAlreadyScheduled
            ? 'Perfeito. Visita agendada. Se quiser, também posso te ajudar com valores, pagamento ou localização.'
            : 'Perfeito. Se quiser, seguimos com outros detalhes do Évora por aqui.';
        }
      }

      const visitStillActiveForPolicy =
        directVisitSchedulingDecision.appointmentConfirmed !== true &&
        (
          flowStateParsed.pendingVisitScheduling === true ||
          flowStateParsed.visitScheduling?.active === true
        );
      if (directVisitSchedulingDecision.appointmentConfirmed !== true) {
        const visitPolicyResult = applyAnaConversationPolicy({
          conversationId,
          userMessage: trimmed,
          replyText: deterministicVisitReply,
          isFirstAnaReply,
          flowState: flowStateParsed,
          recentMessages: rows.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
          knownCustomerName: trustedCustomerName || effectiveConv.customer_name || null,
          probableCustomerName:
            !(trustedCustomerName || effectiveConv.customer_name || '').trim()
              ? linkedContact?.first_name ?? linkedContact?.full_name ?? null
              : null,
          now: lastUserMessageAt,
          disableFollowupQuestion: true,
          visitFlowActive: visitStillActiveForPolicy,
          shortConfirmationContext: shortConfirmationContext.isShortConfirmation
            ? {
                kind: shortConfirmationContext.kind,
                lastAssistantQuestionType: shortConfirmationContext.lastAssistantQuestionType,
                lastAssistantQuestionText: shortConfirmationContext.lastAssistantQuestionText,
                lastOfferedTopics: shortConfirmationContext.lastOfferedTopics,
              }
            : undefined,
          safeTopicAvailability: safeTopicAvailabilityForPolicy,
        });
        deterministicVisitReply = visitPolicyResult.text;
        if (visitPolicyResult.changed) {
          flowStateParsed = visitPolicyResult.flowState;
          await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
          console.log('[ANA_VISIT_STATE_SAVED]', {
            conversationId,
            source: 'visit_policy_adjustment',
            pendingVisitScheduling: flowStateParsed.pendingVisitScheduling === true,
            pendingVisitDay: flowStateParsed.pendingVisitDay ?? flowStateParsed.pendingVisitDateLabel ?? null,
            pendingVisitTime: flowStateParsed.pendingVisitTime ?? null,
            pendingVisitInvalidTime: flowStateParsed.pendingVisitInvalidTime ?? null,
            pendingVisitMissingSlot: flowStateParsed.pendingVisitMissingSlot ?? null,
            pendingVisitCustomerName: flowStateParsed.pendingVisitCustomerName ?? null,
          });
        }

      } else {
        console.log('[ANA_VISIT_POLICY_SKIPPED_FOR_CONFIRMED_APPOINTMENT]', {
          conversationId,
          reason: directVisitSchedulingDecision.reason,
          appointmentConfirmed: true,
          appointmentDateYmd: directVisitSchedulingDecision.appointmentDateYmd ?? null,
          appointmentTimeHm: directVisitSchedulingDecision.appointmentTimeHm ?? null,
        });
      }

      const committedVisitReply = commitTurnResponse({
        handler: 'deterministic_visit_scheduling',
        reason: directVisitSchedulingDecision.reason,
        parts: [deterministicVisitReply],
        stage: 'deterministic_visit_scheduling',
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
        shouldCallQwen: false,
      });
      if (!committedVisitReply.committed || !committedVisitReply.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'deterministic_visit_commit_blocked';
        return;
      }
      deterministicVisitReply = committedVisitReply.text;

      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_direct_visit_send';
        anaTurnDiagnostics.finalResponse.replySource = 'deterministic_visit_scheduling';
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        return;
      }
      const sendVisitResult = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: deterministicVisitReply,
        phase: 'deterministic_visit_scheduling',
        replyPipelineToken,
      });
      if (!sendVisitResult.success || sendVisitResult.metaMessageIds.length === 0) {
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
      const committedVisitState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedVisitReply.parts,
        finalReplyText: deterministicVisitReply,
        handler: 'deterministic_visit_scheduling',
        currentTopic: anaTurnContextResolved?.currentTopic ?? null,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
      });
      if (directVisitSchedulingDecision.appointmentConfirmed && scheduledVisitStateSnapshot?.visitScheduling?.status === 'scheduled') {
        const baseVisitScheduling =
          scheduledVisitStateSnapshot.visitScheduling ??
          committedVisitState.nextState.visitScheduling ?? {
            active: false,
            offered: true,
            accepted: true,
            requestedDateText: null,
            requestedTimeText: null,
            requestedPeriodText: null,
            normalizedDate: null,
            normalizedTime: null,
            nameCollected: false,
            customerName: null,
            status: 'scheduled' as const,
          };
        flowStateParsed = {
          ...committedVisitState.nextState,
          pendingVisitScheduling: false,
          pendingVisitDateLabel: null,
          pendingVisitDay: null,
          pendingVisitDate: null,
          pendingVisitTime: null,
          pendingVisitPeriod: null,
          pendingVisitEnterpriseId: null,
          pendingVisitInvalidTime: null,
          pendingVisitMissingSlot: null,
          pendingVisitCustomerName: null,
          pendingVisitConfirmationAsked: false,
          visitScheduling: {
            ...baseVisitScheduling,
            active: false,
            status: 'scheduled' as const,
          },
        };
      } else {
        flowStateParsed = committedVisitState.nextState;
      }
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
      const directVisitDeclinedSuggestedSlot =
        directVisitSchedulingDecision.reason === 'suggested_slot_declined' ||
        directVisitSchedulingDecision.reason === 'suggested_slot_declined_again' ||
        directVisitSchedulingDecision.nextState.suggestedVisitStatus === 'declined';
      if (directVisitSchedulingDecision.appointmentConfirmed) {
        await cancelAnaVisitFollowupForConversation({
          conversationId,
          reason: 'visit_scheduled',
        });
      } else if (directVisitDeclinedSuggestedSlot) {
        await cancelAnaVisitFollowupForConversation({
          conversationId,
          reason: directVisitSchedulingDecision.reason,
        });
      } else {
        await startAnaVisitFollowupIfEligible({
          conversationId,
          flowState: flowStateParsed,
          replyText: deterministicVisitReply,
          anchorAssistantMessageId: sendVisitResult.messageIds[sendVisitResult.messageIds.length - 1] ?? null,
          missingSlot: directVisitSchedulingDecision.missingSlot ?? null,
        });
      }
      console.log('[ANA_COMMITTED_REPLY_STATE_SAVED]', {
        conversationId,
        savedFields: [
          'lastAssistantQuestionText',
          'lastAssistantQuestionType',
          'recentQuestions',
          'lastOfferedTopics',
          'lastAnsweredTopic',
          'topicsAlreadyAnswered',
          'lastCommittedHandler',
          'lastCommittedAt',
        ],
      });
      console.log('[ANA_VISIT_FLOW_RESPONSE_SENT]', {
        conversationId,
        reason: directVisitSchedulingDecision.reason,
        missingSlot: directVisitSchedulingDecision.missingSlot ?? null,
      });
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
        outboundMetaMessageId:
          sendVisitResult.metaMessageIds[sendVisitResult.metaMessageIds.length - 1] ?? null,
      });
      await notifyBrokerAppointmentConfirmedAfterAnaSend(
        directVisitAppointmentRegistration,
        ent?.name ?? null
      );
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
      if (await sendGlobalNoEnterpriseFinalSafeReply(anaTurnAuditBlockedReason)) return;
      return;
    }

    if (
      lastAssistantAskedCustomerNameThisTurn &&
      !trustedCustomerName &&
      !objectiveCustomerQuestionThisTurn &&
      !isInitialQualificationClarificationMessage(trimmed)
    ) {
      console.log('[ANA_MISSING_RAG_FALLBACK_BLOCKED_AFTER_NAME_QUESTION]', {
        conversationId,
        reason: 'name_question_non_name_reply',
        userMessagePreview: trimmed.slice(0, 120),
        lastAssistantMessage: (lastAssistantPlain || '').slice(0, 220),
      });
      console.log('[ANA_MISSING_RAG_FALLBACK_BLOCKED_FOR_CONVERSATION_STATE]', {
        conversationId,
        reason: 'name_question_non_name_reply',
        userMessagePreview: trimmed.slice(0, 120),
      });
      const committedNameQuestionRepair = commitTurnResponse({
        handler: 'lead_qualification_policy',
        reason: 'name_question_non_name_reply',
        parts: [ANA_NAME_QUESTION_REPAIR_REPLY],
        stage: 'lead_qualification_name_repair',
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
        shouldCallQwen: false,
      });
      if (!committedNameQuestionRepair.committed || !committedNameQuestionRepair.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'lead_qualification_name_repair_commit_blocked';
        return;
      }
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_lead_qualification_name_repair_send';
        return;
      }
      const nameQuestionRepairSend = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: committedNameQuestionRepair.text,
        phase: 'lead_qualification_policy',
        replyPipelineToken,
      });
      if (!nameQuestionRepairSend.success || nameQuestionRepairSend.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'lead_qualification_name_repair_send_failed';
        return;
      }
      flowStateParsed = markLeadQualificationQuestionAsked(flowStateParsed, {
        key: 'name',
        question: ANA_NAME_QUESTION_REPAIR_REPLY,
      });
      const committedNameRepairState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedNameQuestionRepair.parts,
        finalReplyText: committedNameQuestionRepair.text,
        handler: 'lead_qualification_policy',
        currentTopic: anaTurnContextResolved?.currentTopic ?? null,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
      });
      flowStateParsed = committedNameRepairState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
      await markAnaAskedForCustomerName(conversationId);
      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'lead_qualification_policy';
      anaTurnDiagnostics.finalResponse.replySource = 'lead_qualification_policy';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      return;
    }

    const evoraKnowledgeDrivenMode =
      isEvoraEnterpriseName(ent?.name ?? null) &&
      (enterpriseEvidence.hasUsableKnowledgeChunks || knowledgeText.trim().length > 0 || structuredFactsFound);
    if (ANA_LLM_FIRST_COMMERCIAL_REPLIES && isEvoraEnterpriseName(ent?.name ?? null)) {
      console.log('[ANA_LLM_FIRST_COMMERCIAL_ENABLED]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        enterpriseName: ent?.name ?? null,
      });
    }
    if (evoraKnowledgeDrivenMode) {
      console.log('[ANA_COMMERCIAL_RULES_BYPASSED_CANONICAL_BASE]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        enterpriseName: ent?.name ?? null,
        ragChunksFound,
        structuredFactsFound,
      });
    }

    const buildEvoraSafeNextTopicQuestion = (
      currentTopic: 'lazer' | 'seguranca' | 'localizacao' | 'lotes' | 'valores'
    ): string => {
      console.log('[ANA_EVORA_SAFE_NEXT_TOPIC_QUESTION_HELPER]', {
        conversationId,
        currentTopic,
      });

      const assistantTopicText = normText(
        rows
          .filter((message) => message.role === 'assistant')
          .map((message) => message.content || '')
          .join('\n')
      );

      const topicSeen = {
        lazer:
          currentTopic === 'lazer' ||
          /\b(lazer|piscina|beach tennis|academia|salao de festas|playground|coworking|espaco zen|fireplace|campo society|quadra)\b/.test(
            assistantTopicText
          ),
        seguranca:
          currentTopic === 'seguranca' ||
          /\b(seguranca|portaria 24|portaria 24 horas|controle de acesso|rotina mais reservada e segura)\b/.test(
            assistantTopicText
          ),
        localizacao:
          currentTopic === 'localizacao' ||
          /\b(atibaia|pedreira|rio abaixo|dom pedro|estrada dos pires|50 minutos de sao paulo|mapa|acesso)\b/.test(
            assistantTopicText
          ),
        lotes:
          currentTopic === 'lotes' ||
          /\b(145 lotes|lotes no total|360 m|725 m|metragens|tamanhos dos lotes|lotes e tamanhos)\b/.test(
            assistantTopicText
          ),
        valores:
          currentTopic === 'valores' ||
          /\b(r\$279|279\.000|metro quadrado|r\$775|entrada padrao|entrada de 20|48x|120x|financiamento direto|formas de pagamento)\b/.test(
            assistantTopicText
          ),
      };

      const availableTopics = [
        { key: 'lazer', label: 'lazer' },
        { key: 'seguranca', label: 'segurança' },
        { key: 'localizacao', label: 'localização/acesso' },
        { key: 'lotes', label: 'lotes/tamanhos' },
        { key: 'valores', label: 'valores/formas de pagamento' },
      ].filter((topic) => !topicSeen[topic.key as keyof typeof topicSeen]);

      if (availableTopics.length === 0) {
        return 'Já te passei os principais pontos do Évora. Que tal agendarmos uma visita para você conhecer o empreendimento com calma?';
      }

      if (availableTopics.length === 1) {
        return `Quer que eu te explique também sobre ${availableTopics[0].label} ou prefere que eu te ajude a agendar uma visita?`;
      }

      const labels = availableTopics.slice(0, 3).map((topic) => topic.label);
      const last = labels.pop();

      return `Quer que eu te explique também sobre ${labels.join(', ')} ou ${last}?`;
    };

    const stripEvoraTrailingQuestion = (text: string): string =>
      text
        .replace(/\n\n(?:Quer|Você|Voce|Qual|O que|Posso|Se fizer sentido)[^?]*\?\s*$/i, '')
        .replace(/\s+(?:Quer|Você|Voce|Qual|O que|Posso|Se fizer sentido)[^?]*\?\s*$/i, '')
        .trim();

    if (isLocationLinkRequest(trimmed) && isEvoraEnterpriseName(ent?.name ?? null)) {
      const resolvedLocationLink = getEvoraCanonicalMapsLink();
      const locationOverview = buildEvoraAddressCanonicalReply();
      const finalQuestionHistory = collectRecentAssistantQuestionsForFinalCheck({
        flowState: flowStateParsed,
        recentMessages: rows.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });
      const contextualLocationQuestion = buildEvoraSafeNextTopicQuestion('localizacao');
      const locationLinkMessages: string[] = [locationOverview];
      locationLinkMessages.push(resolvedLocationLink);
      console.log('[ANA_LOCATION_LINK_SENT]', {
        conversationId,
        linkPreview: resolvedLocationLink.slice(0, 120),
      });
      if (contextualLocationQuestion) {
        locationLinkMessages.push(contextualLocationQuestion);
      }
      console.log('[ANA_LOCATION_RESPONSE_SPLIT]', {
        conversationId,
        partsCount: locationLinkMessages.length,
      });
      const committedLocationLink = commitTurnResponse({
        handler: 'deterministic_location_link',
        reason: 'location_link_request',
        parts: locationLinkMessages,
        stage: 'location_link_intent',
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? null,
        shouldCallQwen: false,
      });
      if (!committedLocationLink.committed || !committedLocationLink.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'location_link_commit_blocked';
        return;
      }
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_location_link_message';
        return;
      }
      const sendResult = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: committedLocationLink.text,
        phase: 'commercial_rules',
        replyPipelineToken,
      });
      if (!sendResult.success || sendResult.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'location_link_send_failed';
        return;
      }
      const committedLocationState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedLocationLink.parts,
        finalReplyText: committedLocationLink.text,
        handler: 'deterministic_location_link',
        currentTopic: anaTurnContextResolved?.currentTopic ?? null,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
      });
      flowStateParsed = committedLocationState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
      console.log('[ANA_COMMITTED_REPLY_STATE_SAVED]', {
        conversationId,
        savedFields: [
          'lastAssistantQuestionText',
          'lastAssistantQuestionType',
          'recentQuestions',
          'lastOfferedTopics',
          'lastAnsweredTopic',
          'topicsAlreadyAnswered',
          'lastCommittedHandler',
          'lastCommittedAt',
        ],
      });
      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'commercial_rules';
      anaTurnDiagnostics.finalResponse.replySource = 'commercial_rules_intent';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      return;
    }

    const evoraLotSizeFollowupNorm = normText(trimmed);
    const previousAssistantOfferedLotSizes =
      /\b(lotes e tamanhos|tamanhos dos lotes|tamanhos de lotes|tamanhos|metragem|metragens)\b/i.test(
        normText(lastAssistantPlain ?? '')
      );

    const evoraLotSizeFollowupIntent =
      isEvoraEnterpriseName(ent?.name ?? null) &&
      (
        /\b(quero|queria|gostaria|me fala|me fale|explica|explique|saber|mais sobre)\b.{0,80}\b(lotes e tamanhos|tamanhos dos lotes|tamanhos de lotes|metragem|metragens|area dos lotes|área dos lotes)\b/i.test(
          evoraLotSizeFollowupNorm
        ) ||
        /\b(lotes e tamanhos|tamanhos dos lotes|metragem dos lotes|metragens dos lotes|area dos lotes|área dos lotes)\b/i.test(
          evoraLotSizeFollowupNorm
        ) ||
        (
          previousAssistantOfferedLotSizes &&
          /\b(quero|sim|pode|me explica|me fale|fala mais|mais sobre|lotes|tamanhos|metragem|metragens)\b/i.test(
            evoraLotSizeFollowupNorm
          )
        )
      );

    if (evoraLotSizeFollowupIntent) {
      const lotSizeFollowupMessages = dedupeMessageParts([
        'Claro. O Évora tem 145 lotes no total, com metragens de 360 m² a 725 m².',
        'Na prática, isso atende desde quem busca um projeto mais compacto e funcional até quem quer uma casa com mais área externa, quintal e espaço de convivência.',
        `As opções específicas mudam conforme disponibilidade, então eu não confirmo lote exato por aqui. ${buildEvoraSafeNextTopicQuestion('lotes')}`
      ], {
        conversationId,
        stage: 'evora_lot_size_followup',
      });

      console.log('[ANA_EVORA_LOT_SIZE_FOLLOWUP_USED]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        userMessagePreview: trimmed.slice(0, 180),
      });

      const committedLotSizeFollowup = commitTurnResponse({
        handler: 'evora_lot_size_followup',
        reason: 'customer_asked_lot_sizes_after_offer',
        parts: lotSizeFollowupMessages,
        stage: 'evora_lot_size_followup',
        requestedTopic: 'lotes',
        commercialAxis: null,
        shouldCallQwen: false,
      });

      if (!committedLotSizeFollowup.committed || !committedLotSizeFollowup.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'evora_lot_size_followup_commit_blocked';
        return;
      }

      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_evora_lot_size_followup';
        return;
      }

      const lotSizeFollowupSend = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: committedLotSizeFollowup.text,
        phase: 'evora_lot_size_followup',
        replyPipelineToken,
      });

      if (!lotSizeFollowupSend.success || lotSizeFollowupSend.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'evora_lot_size_followup_send_failed';
        return;
      }

      const committedLotSizeFollowupState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedLotSizeFollowup.parts,
        finalReplyText: committedLotSizeFollowup.text,
        handler: 'evora_lot_size_followup',
        currentTopic: anaTurnContextResolved?.currentTopic ?? null,
        requestedTopic: 'lotes',
        commercialAxis: null,
      });

      flowStateParsed = committedLotSizeFollowupState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);

      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'evora_lot_size_followup';
      anaTurnDiagnostics.finalResponse.replySource = 'evora_lot_size_followup';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      return;
    }

    const evoraLocationClarificationNorm = normText(trimmed);
    const previousAssistantWasLocationContext =
      /\b(regiao da pedreira|rio abaixo|atibaia|dom pedro|50 minutos de sao paulo|localizacao|acesso|onde fica)\b/i.test(
        normText(lastAssistantPlain ?? '')
      );

    const evoraLocationClarificationIntent =
      isEvoraEnterpriseName(ent?.name ?? null) &&
      (
        /\b(nao sei onde fica|nao sei aonde fica|nao conheco|nao conheço|onde fica isso|onde e isso|onde é isso|me explica melhor onde fica|como chega|como eu chego|fica onde|que regiao e essa|que região é essa)\b/i.test(
          evoraLocationClarificationNorm
        ) ||
        (
          previousAssistantWasLocationContext &&
          /\b(nao sei|nao conheco|nao conheço|nunca fui|me explica melhor|como assim|onde exatamente)\b/i.test(
            evoraLocationClarificationNorm
          )
        )
      );

    if (evoraLocationClarificationIntent) {
      const locationClarificationMessages = dedupeMessageParts([
        'Sem problema. O Évora fica em Atibaia, na região da Pedreira, bairro Rio Abaixo, com acesso pela Rodovia Dom Pedro I.',
        'Para ter uma referência simples: é uma região mais tranquila e com bastante contato com a natureza, a cerca de 50 minutos de São Paulo. A proposta é ficar perto do acesso principal, mas com clima mais reservado para morar.',
        buildEvoraSafeNextTopicQuestion('localizacao')
      ], {
        conversationId,
        stage: 'evora_location_clarification',
      });

      console.log('[ANA_EVORA_LOCATION_CLARIFICATION_USED]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        userMessagePreview: trimmed.slice(0, 180),
      });

      const committedLocationClarification = commitTurnResponse({
        handler: 'evora_location_clarification',
        reason: 'customer_does_not_know_location',
        parts: locationClarificationMessages,
        stage: 'evora_location_clarification',
        requestedTopic: 'localizacao',
        commercialAxis: 'localizacao',
        shouldCallQwen: false,
      });

      if (!committedLocationClarification.committed || !committedLocationClarification.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'evora_location_clarification_commit_blocked';
        return;
      }

      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_evora_location_clarification';
        return;
      }

      const locationClarificationSend = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: committedLocationClarification.text,
        phase: 'evora_location_clarification',
        replyPipelineToken,
      });

      if (!locationClarificationSend.success || locationClarificationSend.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'evora_location_clarification_send_failed';
        return;
      }

      const committedLocationClarificationState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedLocationClarification.parts,
        finalReplyText: committedLocationClarification.text,
        handler: 'evora_location_clarification',
        currentTopic: anaTurnContextResolved?.currentTopic ?? null,
        requestedTopic: 'localizacao',
        commercialAxis: 'localizacao',
      });

      flowStateParsed = committedLocationClarificationState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);

      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'evora_location_clarification';
      anaTurnDiagnostics.finalResponse.replySource = 'evora_location_clarification';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      return;
    }

    const evoraBrokerRequestNorm = normText(trimmed);
    const evoraBrokerRequestIntent =
      isEvoraEnterpriseName(ent?.name ?? null) &&
      (
        /\b(falar|conversar|chamar|encaminhar|passar|acionar)\b.{0,60}\b(corretor|consultor|vendedor|atendente)\b/.test(evoraBrokerRequestNorm) ||
        /\b(corretor|consultor|vendedor|atendente)\b.{0,60}\b(falar|conversar|contato|me chama|me chamar|me liga|ligar)\b/.test(evoraBrokerRequestNorm)
      );

    if (evoraBrokerRequestIntent) {
      const brokerMessages = dedupeMessageParts([
        'Perfeito, vou encaminhar você para o corretor responsável continuar o atendimento.',
        'Pode aguardar o contato dele por aqui. Ele vai te passar os detalhes certinhos e te ajudar com os próximos passos.'
      ], {
        conversationId,
        stage: 'evora_broker_request',
      });

      console.log('[ANA_EVORA_BROKER_REQUEST_REPLY_USED]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        userMessagePreview: trimmed.slice(0, 180),
      });

      const committedBrokerRequest = commitTurnResponse({
        handler: 'evora_broker_request',
        reason: 'customer_requested_broker',
        parts: brokerMessages,
        stage: 'evora_broker_request',
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: null,
        shouldCallQwen: false,
      });

      if (!committedBrokerRequest.committed || !committedBrokerRequest.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'evora_broker_request_commit_blocked';
        return;
      }

      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_evora_broker_request';
        return;
      }

      const brokerRequestSend = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: committedBrokerRequest.text,
        phase: 'evora_broker_request',
        replyPipelineToken,
      });

      if (!brokerRequestSend.success || brokerRequestSend.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'evora_broker_request_send_failed';
        return;
      }

      const committedBrokerRequestState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedBrokerRequest.parts,
        finalReplyText: committedBrokerRequest.text,
        handler: 'evora_broker_request',
        currentTopic: anaTurnContextResolved?.currentTopic ?? null,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: null,
      });

      flowStateParsed = committedBrokerRequestState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);

      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'evora_broker_request';
      anaTurnDiagnostics.finalResponse.replySource = 'evora_broker_request';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      return;
    }

    const evoraPaymentGeneralNorm = normText(trimmed);
    const previousAssistantOfferedPaymentTerms =
      /\b(formas de pagamento|forma de pagamento|condicoes de pagamento|condições de pagamento|entrada|parcelamento|financiamento|financiamento direto|48x|120x)\b/i.test(
        normText(lastAssistantPlain ?? '')
      );

    const evoraPaymentExplicitGeneralIntent =
      /\b(forma de pagamento|formas de pagamento|pagamento|entrada|sinal|financiamento|financiar|construtora|incorporadora|parcelamento|sem juros|48x|120x|comprovacao de renda|comprovação de renda)\b/.test(evoraPaymentGeneralNorm);

    const paymentContextBlockedByOtherTopic =
      /\b(regiao|região|localizacao|localização|onde fica|endereco|endereço|mapa|acesso|lazer|seguranca|segurança|lote|lotes|tamanho|tamanhos|metragem|metragens|natureza|piscina|quadra|portaria)\b/.test(
        evoraPaymentGeneralNorm
      );

    const shortGenericPaymentTermsConfirmation =
      previousAssistantOfferedPaymentTerms &&
      !paymentContextBlockedByOtherTopic &&
      /^(sim|sim pode|pode|pode sim|quero|quero sim|gostaria|me explica|me explique|explica|explique|fala|fale|me fala|me fale)$/.test(
        evoraPaymentGeneralNorm
      );

    const shortPaymentTermsConfirmation =
      evoraPaymentExplicitGeneralIntent || shortGenericPaymentTermsConfirmation;

    const evoraPaymentGeneralIntent =
      isEvoraEnterpriseName(ent?.name ?? null) &&
      shortPaymentTermsConfirmation;

    const evoraPaymentPersonalizedIntent =
      /\b(simulacao|simulação|simular|quanto fica|quanto ficaria|por mes|por mês|valor da parcela|parcela mensal|desconto|negociar|negociacao|negociação|proposta|tabela|lote especifico|lote específico|disponibilidade)\b/.test(evoraPaymentGeneralNorm);

    if (evoraPaymentGeneralIntent && !evoraPaymentPersonalizedIntent) {
      const paymentMessages = dedupeMessageParts([
        'Sim. A entrada padrão do Évora é de 20%.',
        'Nas condições gerais, existe parcelamento sem juros em até 48x, ou planos estendidos em até 120x com juros.',
        'O financiamento é direto com a incorporadora/construtora, com menos burocracia e mais facilidade. Eu só não faço simulação de parcela por aqui, porque isso depende do lote e do plano escolhido.',
        buildEvoraSafeNextTopicQuestion('valores')
      ], {
        conversationId,
        stage: 'evora_payment_general_authorized',
      });

      console.log('[ANA_EVORA_PAYMENT_GENERAL_AUTHORIZED_USED]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        userMessagePreview: trimmed.slice(0, 180),
      });

      const committedPaymentGeneral = commitTurnResponse({
        handler: 'evora_payment_general_authorized',
        reason: 'authorized_general_payment_terms',
        parts: paymentMessages,
        stage: 'evora_payment_general_authorized',
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: 'financiamento',
        shouldCallQwen: false,
      });

      if (!committedPaymentGeneral.committed || !committedPaymentGeneral.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'evora_payment_general_commit_blocked';
        return;
      }

      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_evora_payment_general';
        return;
      }

      const paymentGeneralSend = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: committedPaymentGeneral.text,
        phase: 'evora_payment_general_authorized',
        replyPipelineToken,
      });

      if (!paymentGeneralSend.success || paymentGeneralSend.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'evora_payment_general_send_failed';
        return;
      }

      const committedPaymentGeneralState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedPaymentGeneral.parts,
        finalReplyText: committedPaymentGeneral.text,
        handler: 'evora_payment_general_authorized',
        currentTopic: anaTurnContextResolved?.currentTopic ?? null,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: 'financiamento',
      });

      flowStateParsed = committedPaymentGeneralState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);

      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'evora_payment_general_authorized';
      anaTurnDiagnostics.finalResponse.replySource = 'evora_payment_general_authorized';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      return;
    }

    const knowledgeGapMeta: AnaKnowledgeGapResult = globalNoEnterpriseMode
      ? {
          hasKnowledgeGap: false,
          reason: 'global_no_enterprise_mode',
          allowedNextActions: [],
          instructionForModel: '',
        }
      : detectAnaKnowledgeGap({
          userMessage: trimmed,
          requestedAxis: requestedAxisForPolicy,
          recentMessages: rows.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
        });
    const isKnowledgeGapTurn = knowledgeGapMeta.hasKnowledgeGap === true;
    const deterministicKnowledgeGapBridgeReply = isKnowledgeGapTurn
      ? buildLeadQualificationBridgeReply({
          matchedIntent: knowledgeGapMeta.matchedIntent ?? null,
          locationOverview: buildEvoraLocationOverview({
            addressComplete: authorizedLocationAddress.addressComplete,
            addressNumber: authorizedLocationAddress.addressNumber,
          }),
          locationLink: authorizedLocationLink ?? knowledgeLocationLink,
          addressComplete: authorizedLocationAddress.addressComplete,
          addressNumber: authorizedLocationAddress.addressNumber,
        })
      : null;
    let knowledgeGapOfferValidationResult: ReturnType<typeof validateKnowledgeGapResolutionOffer> | null = null;
    if (isKnowledgeGapTurn) {
      console.log('[ANA_KNOWLEDGE_GAP_DETECTED]', {
        conversationId,
        reason: knowledgeGapMeta.reason,
        matchedIntent: knowledgeGapMeta.matchedIntent ?? null,
      });
    }

    if (isEvoraEnterpriseName(ent?.name ?? null)) {
    const commercialRuleFromMessage = resolveAnaCommercialRule({
      enterpriseName: ent?.name ?? null,
      userMessage: trimmed,
      isFirstAnaReply,
      previousAssistantMessage: lastAssistantPlain,
    });
    const commercialRule = isRegionDeepDiveResolved ? null : commercialRuleFromMessage;
    const forcedIntentFromTurnContext = (() => {
      if (!isEvoraEnterpriseName(ent?.name ?? null)) return null;
      const topic = anaTurnContextResolved?.requestedTopic ?? null;
      if (topic === 'region_deep_dive') return null;
      if (topic === 'localizacao' || topic === 'rota') return 'localizacao_endereco' as const;
      if (topic === 'lotes') return 'metragem_faixa' as const;
      if (topic === 'lazer') return 'areas_lazer' as const;
      if (topic === 'seguranca') return 'seguranca_portaria' as const;
      if (topic === 'pagamento') return 'formas_pagamento' as const;
      if (topic === 'valores') return 'preco_valor_lote' as const;
      return null;
    })();
    const forcedCommercialRule =
      forcedIntentFromTurnContext != null
        ? {
            ruleId: forcedIntentFromTurnContext,
            commercialAxis:
              forcedIntentFromTurnContext === 'localizacao_endereco'
                ? ('location' as const)
                : forcedIntentFromTurnContext === 'metragem_faixa'
                    ? ('availability' as const)
                  : forcedIntentFromTurnContext === 'areas_lazer'
                    ? ('leisure' as const)
                    : forcedIntentFromTurnContext === 'seguranca_portaria'
                      ? ('security' as const)
                      : forcedIntentFromTurnContext === 'formas_pagamento'
                        ? ('payment_terms' as const)
                        : ('price' as const),
            messages: splitCommercialRuleMessages(ANA_COMMERCIAL_RULES.byIntent[forcedIntentFromTurnContext]),
            replySource: 'commercial_rules_intent' as const,
            inheritedIntent: null,
            financialIntentType:
              forcedIntentFromTurnContext === 'formas_pagamento'
                ? ('payment_terms_general' as const)
                : null,
          }
        : null;
    if (
      forcedCommercialRule &&
      commercialRule &&
      commercialRule.ruleId !== forcedCommercialRule.ruleId
    ) {
      console.log('[ANA_CONTEXT_STALE_TOPIC_IGNORED]', {
        conversationId,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        ignoredRule: commercialRule.ruleId,
        forcedRule: forcedCommercialRule.ruleId,
      });
    }
    const normalizedUserForCanonical = normText(trimmed);
    const locationLikeIntent =
      requestedAxisForPolicy === 'localizacao' ||
      anaDecision.currentAxis === 'localizacao' ||
      anaDecision.resolvedIntent === 'localizacao' ||
      /\b(localizacao|localização|regiao|região|onde fica|bairro|pedreira|rio abaixo)\b/.test(normalizedUserForCanonical);
    const addressLikeIntent = /\b(endereco|endereço)\b/.test(normalizedUserForCanonical);
    const canonicalLocationFallbackRule =
      !isRegionDeepDiveResolved &&
      !commercialRule &&
      isEvoraEnterpriseName(ent?.name ?? null) &&
      (locationLikeIntent || addressLikeIntent)
        ? {
            ruleId: addressLikeIntent ? 'endereco' : 'localizacao_endereco',
            commercialAxis: 'location' as const,
            messages: splitCommercialRuleMessages(
              ANA_COMMERCIAL_RULES.byIntent[addressLikeIntent ? 'endereco' : 'localizacao_endereco']
            ),
            replySource: 'commercial_rules_intent' as const,
            inheritedIntent: null,
            financialIntentType: null,
          }
        : null;
    if (isRegionDeepDiveResolved && (commercialRuleFromMessage || locationLikeIntent || addressLikeIntent)) {
      console.log('[ANA_LOCATION_CANONICAL_BLOCKED_BY_REGION_DEEP_DIVE]', {
        conversationId,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        blockedRule: commercialRuleFromMessage?.ruleId ?? (addressLikeIntent ? 'endereco' : 'localizacao_endereco'),
        userMessagePreview: trimmed.slice(0, 180),
      });
      console.log('[ANA_LOCATION_SHORT_CANONICAL_SKIPPED_FOR_REGION_DEEP_DIVE]', {
        conversationId,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        skippedRule: commercialRuleFromMessage?.ruleId ?? (addressLikeIntent ? 'endereco' : 'localizacao_endereco'),
        userMessagePreview: trimmed.slice(0, 180),
      });
    }
    const effectiveCommercialRule = forcedCommercialRule ?? commercialRule ?? canonicalLocationFallbackRule;
    const commercialRuleAllowedAsOperationalDeterministic =
      effectiveCommercialRule?.ruleId === 'visita_agendamento' ||
      (
        isEvoraEnterpriseName(ent?.name ?? null) &&
        (
          effectiveCommercialRule?.ruleId === 'areas_lazer' ||
          effectiveCommercialRule?.ruleId === 'seguranca_portaria' ||
          effectiveCommercialRule?.ruleId === 'quantidade_lotes_info_gap'
        )
      );
    if (
      ANA_LLM_FIRST_COMMERCIAL_REPLIES &&
      effectiveCommercialRule &&
      !commercialRuleAllowedAsOperationalDeterministic
    ) {
      console.log('[ANA_COMMERCIAL_DETERMINISTIC_BYPASSED]', {
        conversationId,
        ruleName: effectiveCommercialRule.ruleId,
        axis: effectiveCommercialRule.commercialAxis,
        replySourceBeforeLlm: effectiveCommercialRule.replySource,
        reason: 'llm_first_commercial_replies',
      });
      console.log('[ANA_QWEN_REQUIRED_FOR_COMMERCIAL_REPLY]', {
        conversationId,
        ruleName: effectiveCommercialRule.ruleId,
        axis: effectiveCommercialRule.commercialAxis,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
      });
    }
    const shouldHandleInitialQualificationClarification =
      evoraLeadQualificationEnabled &&
      ANA_LLM_FIRST_COMMERCIAL_REPLIES &&
      isInitialQualificationClarificationMessage(trimmed) &&
      (
        getLeadQualificationState(flowStateParsed).nameAsked ||
        Boolean(getLeadQualificationState(flowStateParsed).lastQualificationQuestion) ||
        /\b(nome|morar|investir|conhecendo|possibilidades|momento|procur)\b/.test(normText(lastAssistantPlain || ''))
      );
    if (shouldHandleInitialQualificationClarification) {
      const clarificationRepairReply = buildInitialQualificationClarificationReply({
        lastAssistantMessage: lastAssistantPlain,
        state: getLeadQualificationState(flowStateParsed),
      });
      console.log('[ANA_MISSING_RAG_FALLBACK_BLOCKED_FOR_CONVERSATION_STATE]', {
        conversationId,
        reason: 'initial_qualification_clarification',
        userMessagePreview: trimmed.slice(0, 120),
      });
      console.log('[ANA_CLARIFICATION_REPAIR_HANDLED]', {
        conversationId,
        lastAssistantQuestion: (lastAssistantPlain || '').slice(0, 220),
      });
      const committedClarificationRepair = commitTurnResponse({
        handler: 'lead_qualification_policy',
        reason: 'initial_qualification_clarification',
        parts: [clarificationRepairReply],
        stage: 'lead_qualification_clarification',
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
        shouldCallQwen: false,
      });
      if (!committedClarificationRepair.committed || !committedClarificationRepair.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'lead_qualification_clarification_commit_blocked';
        return;
      }
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_lead_qualification_clarification_send';
        return;
      }
      const clarificationRepairSend = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: committedClarificationRepair.text,
        phase: 'lead_qualification_policy',
        replyPipelineToken,
      });
      if (!clarificationRepairSend.success || clarificationRepairSend.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'lead_qualification_clarification_send_failed';
        return;
      }
      const committedClarificationState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedClarificationRepair.parts,
        finalReplyText: committedClarificationRepair.text,
        handler: 'lead_qualification_policy',
        currentTopic: anaTurnContextResolved?.currentTopic ?? null,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
      });
      flowStateParsed = committedClarificationState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'lead_qualification_policy';
      anaTurnDiagnostics.finalResponse.replySource = 'lead_qualification_policy';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      return;
    }
    if (
      !(ANA_LLM_FIRST_COMMERCIAL_REPLIES && isEvoraEnterpriseName(ent?.name ?? null)) &&
      !effectiveCommercialRule &&
      !isKnowledgeGapTurn &&
      leadQualificationSignalsChangedThisTurn &&
      !objectiveCustomerQuestionThisTurn &&
      anaDecision.canRespond &&
      anaDecision.outboundAllowed
    ) {
      const qualificationQuestionHistory = collectRecentAssistantQuestionsForFinalCheck({
        flowState: flowStateParsed,
        recentMessages: rows.map((message) => ({
          role: message.role,
          content: message.content,
        })),
      });
      const nextQualificationQuestion = selectNextLeadQualificationQuestion({
        state: getLeadQualificationState(flowStateParsed),
        userMessage: trimmed,
        customerName: trustedCustomerName || effectiveConv.customer_name || null,
        recentQuestions: qualificationQuestionHistory,
      });
      let qualificationReply = buildEvoraLeadQualificationProgressReply({
        previousState: leadQualificationStateBeforeTurn,
        currentState: getLeadQualificationState(flowStateParsed),
        userMessage: trimmed,
        nextQuestionKey: nextQualificationQuestion?.key ?? null,
      });
      if (nextQualificationQuestion) {
        flowStateParsed = markLeadQualificationQuestionAsked(flowStateParsed, nextQualificationQuestion);
        qualificationReply = `${qualificationReply}\n\n${nextQualificationQuestion.question}`.trim();
        console.log('[ANA_LEAD_QUALIFICATION_NEXT_QUESTION_SELECTED]', {
          conversationId,
          key: nextQualificationQuestion.key,
          question: nextQualificationQuestion.question,
        });
        if (nextQualificationQuestion.key === 'name') {
          console.log('[ANA_LEAD_QUALIFICATION_NAME_ASKED]', {
            conversationId,
            source: 'qualification_continuation',
          });
        }
      } else {
        console.log('[ANA_LEAD_QUALIFICATION_QUESTION_SKIPPED_ALREADY_ASKED]', {
          conversationId,
          askedQualificationKeys: getLeadQualificationState(flowStateParsed).askedQualificationKeys,
        });
      }
      if (leadQualificationNameCollectedThisTurn) {
        console.log('[ANA_NAME_CAPTURED_LLM_FIRST_BYPASS]', {
          conversationId,
          customerName: getLeadQualificationState(flowStateParsed).name ?? getLeadQualificationState(flowStateParsed).customerName ?? null,
        });
        console.log('[ANA_INITIAL_QUALIFICATION_CONTINUED_AFTER_NAME]', {
          conversationId,
          nextQuestionKey: nextQualificationQuestion?.key ?? null,
        });
      } else if (ANA_LLM_FIRST_COMMERCIAL_REPLIES) {
        console.log('[ANA_MISSING_RAG_FALLBACK_BLOCKED_FOR_CONVERSATION_STATE]', {
          conversationId,
          reason: 'lead_qualification_signal',
          userMessagePreview: trimmed.slice(0, 120),
        });
      }
      const committedQualificationReply = commitTurnResponse({
        handler: 'lead_qualification_policy',
        reason: 'lead_qualification_signal',
        parts: [qualificationReply],
        stage: 'lead_qualification_policy',
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
        shouldCallQwen: false,
      });
      if (!committedQualificationReply.committed || !committedQualificationReply.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'lead_qualification_commit_blocked';
        return;
      }
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_lead_qualification_send';
        return;
      }
      const qualificationSend = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: committedQualificationReply.text,
        phase: 'lead_qualification_policy',
        replyPipelineToken,
      });
      if (!qualificationSend.success || qualificationSend.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'lead_qualification_send_failed';
        return;
      }
      if (replyExplicitlyAsksCustomerName(committedQualificationReply.text)) {
        await markAnaAskedForCustomerName(conversationId);
      }
      const committedQualificationState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedQualificationReply.parts,
        finalReplyText: committedQualificationReply.text,
        handler: 'lead_qualification_policy',
        currentTopic: anaTurnContextResolved?.currentTopic ?? null,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
      });
      flowStateParsed = committedQualificationState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'lead_qualification_policy';
      anaTurnDiagnostics.finalResponse.replySource = 'lead_qualification_policy';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      return;
    }
    const shouldEnforceCanonicalPriorityRule =
      effectiveCommercialRule != null &&
      (
        effectiveCommercialRule.ruleId === 'first_contact' ||
        effectiveCommercialRule.ruleId === 'preco_valor_lote' ||
        effectiveCommercialRule.ruleId === 'quantidade_lotes_info_gap' ||
        effectiveCommercialRule.ruleId === 'metragem_faixa' ||
        effectiveCommercialRule.ruleId === 'metragem_especifica' ||
        effectiveCommercialRule.ruleId === 'localizacao_endereco' ||
        effectiveCommercialRule.ruleId === 'endereco' ||
        effectiveCommercialRule.ruleId === 'areas_lazer'
      );
    if (
      effectiveCommercialRule &&
      (!ANA_LLM_FIRST_COMMERCIAL_REPLIES || commercialRuleAllowedAsOperationalDeterministic) &&
      anaDecision.canRespond &&
      anaDecision.outboundAllowed &&
      (shouldEnforceCanonicalPriorityRule || !isKnowledgeGapTurn)
    ) {
      console.log('[ANA_LLM_DECISION]', {
        conversationId,
        willCallQwen: false,
        reason: 'deterministic_rule_matched',
        deterministicMatched: true,
        deterministicAxis: effectiveCommercialRule.commercialAxis,
        financialIntentType: effectiveCommercialRule.financialIntentType,
        replySourceBeforeLlm: effectiveCommercialRule.replySource,
        provider: aiSettings.provider,
        model: null,
        baseUrl: aiSettings.openaiBaseUrl,
        responseFormatJson: null,
        historyCount: history.length,
        messagesCount: 0,
        systemPromptLen: 0,
      });
      console.log('[ANA_QWEN_SKIPPED_BY_DETERMINISTIC]', {
        conversationId,
        axis: effectiveCommercialRule.commercialAxis,
        financialIntentType: effectiveCommercialRule.financialIntentType,
        ruleName: effectiveCommercialRule.ruleId,
        replyPreview: effectiveCommercialRule.messages.join(' ').slice(0, 260),
      });
      const isFirstContactRule = effectiveCommercialRule.ruleId === 'first_contact';
      console.log('[ANA_CANONICAL_INTENT_MATCHED]', {
        conversationId,
        intent: effectiveCommercialRule.ruleId,
        axis: effectiveCommercialRule.commercialAxis,
        source: 'Exemplos.txt/canonical',
      });
      console.log('[ANA_COMMERCIAL_AXIS_CLASSIFIED]', {
        conversationId,
        axis: effectiveCommercialRule.commercialAxis,
        userText: trimmed.slice(0, 260),
      });
      console.log(
        isFirstContactRule ? '[ANA_COMMERCIAL_RULE_FIRST_CONTACT_START]' : '[ANA_COMMERCIAL_RULE_INTENT_START]',
        {
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          enterpriseName: ent?.name ?? null,
          userMessagePreview: trimmed.slice(0, 180),
          ruleId: effectiveCommercialRule.ruleId,
          messagesCount: effectiveCommercialRule.messages.length,
        }
      );
      if (effectiveCommercialRule.ruleId === 'disponibilidade_simulacao_desconto') {
        console.log('[ANA_COMMERCIAL_RULE_LOT_DETAILS]', {
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          userMessagePreview: trimmed.slice(0, 220),
        });
      }
      if (effectiveCommercialRule.ruleId === 'quantidade_lotes_info_gap') {
        console.log('[ANA_LOT_COUNT_INFO_GAP_HANDLED]', {
          conversationId,
          source: 'commercial_rule',
        });
      }
      if (effectiveCommercialRule.ruleId === 'formas_pagamento') {
        console.log('[ANA_COMMERCIAL_RULE_PAYMENT_PLANS]', {
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          userMessagePreview: trimmed.slice(0, 220),
        });
        console.log('[ANA_PAYMENT_TERMS_REQUEST_HANDLED]', {
          conversationId,
          axis: effectiveCommercialRule.commercialAxis,
        });
      }
      if (effectiveCommercialRule.ruleId === 'parcela_simulacao') {
        console.log('[ANA_INSTALLMENT_REQUEST_HANDLED]', {
          conversationId,
          axis: effectiveCommercialRule.commercialAxis,
        });
      }
      if (effectiveCommercialRule.ruleId === 'preco_valor_lote') {
        console.log('[ANA_PRICE_REQUEST_HANDLED]', {
          conversationId,
          axis: effectiveCommercialRule.commercialAxis,
        });
      }
      if (effectiveCommercialRule.ruleId === 'metragem_faixa') {
        console.log('[ANA_LOT_SIZE_RANGE_REQUEST_HANDLED]', {
          conversationId,
          axis: effectiveCommercialRule.commercialAxis,
        });
      }
      if (effectiveCommercialRule.ruleId === 'metragem_especifica') {
        console.log('[ANA_SPECIFIC_LOT_SIZE_REQUEST_DETECTED]', {
          conversationId,
          userPreview: trimmed.slice(0, 180),
        });
        console.log('[ANA_SPECIFIC_LOT_AVAILABILITY_BLOCKED]', {
          conversationId,
          reason: 'canonical_specific_lot_size_reply',
        });
      }
      if (effectiveCommercialRule.inheritedIntent === 'payment_terms') {
        console.log('[ANA_PAYMENT_INTENT_CONTEXT_GUARD]', {
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          previousAssistantMessage: (lastAssistantPlain ?? '').slice(0, 240),
          customerMessage: trimmed.slice(0, 240),
          inheritedIntent: effectiveCommercialRule.inheritedIntent,
          finalAnswer: effectiveCommercialRule.messages.join('\n'),
        });
      }

      const commercialRuleVisitOfferDecision =
        effectiveCommercialRule.ruleId === 'visita_agendamento' ||
        effectiveCommercialRule.ruleId === 'localizacao_endereco' ||
        effectiveCommercialRule.ruleId === 'endereco' ||
        effectiveCommercialRule.ruleId === 'areas_lazer' ||
        effectiveCommercialRule.ruleId === 'seguranca_portaria' ||
        effectiveCommercialRule.ruleId === 'quantidade_lotes_info_gap' ||
        effectiveCommercialRule.ruleId === 'metragem_faixa' ||
        effectiveCommercialRule.ruleId === 'metragem_especifica' ||
        effectiveCommercialRule.ruleId === 'preco_valor_lote' ||
        effectiveCommercialRule.ruleId === 'parcela_simulacao' ||
        effectiveCommercialRule.ruleId === 'formas_pagamento' ||
        effectiveCommercialRule.ruleId === 'valor_condominio' ||
        effectiveCommercialRule.ruleId === 'entrega_empreendimento'
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
              answer: effectiveCommercialRule.messages.join('\n'),
              rowsBeforeSend: rows,
              isSchedulingFlow:
                !visitFlowSuppressedByConfirmationContext &&
                (appointmentPreflight.active || flowStateParsed.pendingVisitScheduling === true),
              isHandoff: Boolean(effectiveConv.handoff || effectiveConv.classification === 'Handoff'),
              isMaterialOnlyFlow: false,
            });
      const visitOfferMessagesFromCommercialRule = dedupeMessageParts(
        commercialRuleVisitOfferDecision.appendedVisitOfferMessages ?? [],
        {
          conversationId,
          stage: 'commercial_rule_visit_offer',
        }
      );
      if (commercialRuleVisitOfferDecision.appendedVisitOfferMessages.length > 0) {
        console.log('[ANA_VISIT_OFFER_SUPPRESSED]', {
          conversationId,
          intent: effectiveCommercialRule.ruleId,
          reason: 'canonical_intent_disallows_auto_visit_offer',
        });
      }

      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_commercial_rule_send';
        anaTurnDiagnostics.finalResponse.replySource = effectiveCommercialRule.replySource;
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
          replySource: effectiveCommercialRule.replySource,
          outboundStatus: anaTurnAuditOutcome,
          blockedReason: anaTurnAuditBlockedReason,
        });
        return;
      }

      const knownNameFromConversation = toFirstName(effectiveConv.customer_name || null);
      const knownNameFromCurrentTurn = toFirstName(trustedCustomerName || null);
      const hasKnownCustomerName = Boolean(
        knownNameFromConversation || knownNameFromCurrentTurn
      );

      const recentAssistantForCtaPolicy = [...rows]
        .filter((m) => m.role === 'assistant')
        .map((m) => (m.content || '').trim())
        .filter((msg) => msg.length > 0)
        .slice(-8);
      const hasRecentVisitCta = hasRecentExplicitVisitCta(recentAssistantForCtaPolicy);

      const commercialMessagesToSend = dedupeMessageParts([...effectiveCommercialRule.messages], {
        conversationId,
        stage: 'commercial_rule_messages_initial',
      });
            let evoraCommercialRegionOverrideApplied = false;

if (effectiveCommercialRule.ruleId === 'localizacao_endereco' && commercialMessagesToSend.length === 0) {
        commercialMessagesToSend.push(buildEvoraLocationOverview({
          addressComplete: authorizedLocationAddress.addressComplete,
          addressNumber: authorizedLocationAddress.addressNumber,
        }));
      }
      if (isEvoraEnterpriseName(ent?.name ?? null) && commercialMessagesToSend.length > 0) {
        const evoraCommercialCurrentUserNorm = normText(trimmed);
        const evoraCommercialExplicitRegionRequest =
          /\b(regiao|região|bairro|pedreira|rio abaixo|atibaia|entorno|cidade|redondeza|redondezas)\b/i.test(evoraCommercialCurrentUserNorm) &&
          /\b(me fala|me fale|fala|fale|conte|conta|explica|explique|mais|como e|como eh|como é|detalhe|detalhes)\b/i.test(
            evoraCommercialCurrentUserNorm
          );

        const evoraCommercialRuleConflictsWithExplicitRegion =
          effectiveCommercialRule.ruleId === 'quantidade_lotes_info_gap' ||
          effectiveCommercialRule.ruleId === 'metragem_faixa' ||
          effectiveCommercialRule.ruleId === 'metragem_especifica' ||
          effectiveCommercialRule.ruleId === 'preco_valor_lote' ||
          effectiveCommercialRule.ruleId === 'parcela_simulacao' ||
          effectiveCommercialRule.ruleId === 'formas_pagamento' ||
          effectiveCommercialRule.ruleId === 'areas_lazer' ||
          effectiveCommercialRule.ruleId === 'seguranca_portaria';

        if (evoraCommercialExplicitRegionRequest && evoraCommercialRuleConflictsWithExplicitRegion) {
          commercialMessagesToSend.length = 0;
          commercialMessagesToSend.push(
            'Claro. A região da Pedreira/Rio Abaixo, em Atibaia, tem um perfil mais tranquilo, com bastante verde e contato com a natureza. O acesso é pela Rodovia Dom Pedro I, a cerca de 50 minutos de São Paulo, então a proposta é ter um clima mais reservado sem ficar isolado.'
          );
          commercialMessagesToSend.push(
            'Quer que eu te explique melhor o acesso pela Dom Pedro I ou prefere falar de valores/formas de pagamento?'
          );
          evoraCommercialRegionOverrideApplied = true;

          console.log('[ANA_EVORA_EXPLICIT_REGION_OVERRIDE_COMMERCIAL_RULE]', {
            conversationId,
            previousRuleId: effectiveCommercialRule.ruleId,
            userMessagePreview: trimmed.slice(0, 180),
            lastAssistantPreview: (lastAssistantPlain ?? '').slice(0, 220),
          });
        }
      }

      if (effectiveCommercialRule.ruleId === 'entrega_empreendimento') {
        const operational = resolveOperationalFactAnswer(trimmed, knowledgeText, vars, {
          enterpriseName: ent?.name ?? null,
          hintedTopic: 'entrega_prazo',
        });
        const fallbackEntrega = '';
        const fallbackEntregaBrokerAsk =
          'Quer que eu encaminhe para um corretor te passar essa informação certinho?';
        let resolvedEntrega = operational?.dataFound ? operational.answer : fallbackEntrega;
        if (isWeakEntregaAnswer(resolvedEntrega)) resolvedEntrega = fallbackEntrega;
        commercialMessagesToSend.length = 0;
        commercialMessagesToSend.push(resolvedEntrega.replace(/\[DATA\/PRAZO DA BASE\]/gi, '').replace(/\s{2,}/g, ' ').trim());
        commercialMessagesToSend.push(fallbackEntregaBrokerAsk);
        console.log('[ANA_INFO_GAP_BROKER_HANDOFF_ASKED]', {
          conversationId,
          reason: 'entrega_empreendimento_without_exact_data',
        });
      }
      if (
        isEvoraEnterpriseName(ent?.name ?? null) &&
        effectiveCommercialRule.ruleId === 'areas_lazer' &&
        commercialMessagesToSend.length > 0
      ) {
        const leisureContextText = `${trimmed}\n${lastAssistantPlain ?? ''}`;
        const leisureLifestyleContext =
          /\b(lazer|calmaria|calma|tranquilidade|tranquilo|paz|sossego|natureza|verde|família|familia|qualidade de vida|descanso)\b/i.test(
            leisureContextText
          ) ||
          /chamaria aten[cç][aã]o|lugar como esse|dia a dia|perfil/i.test(leisureContextText);

        if (leisureLifestyleContext && !/^Faz sentido/i.test(commercialMessagesToSend[0] ?? '')) {
          const firstName =
            toFirstName(
              trustedCustomerName ||
                effectiveConv.customer_name ||
                getLeadQualificationState(flowStateParsed).name ||
                null
            );

          const leisureLeadIn = firstName
            ? `Faz sentido, ${firstName}. Para quem busca lazer com tranquilidade, o Évora conversa bem com esse perfil.`
            : 'Faz sentido. Para quem busca lazer com tranquilidade, o Évora conversa bem com esse perfil.';

          commercialMessagesToSend[0] = `${leisureLeadIn}\n\n${commercialMessagesToSend[0]}`.trim();

          console.log('[ANA_LEISURE_LIFESTYLE_LEAD_IN_APPLIED]', {
            conversationId,
            enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
            firstName: firstName ?? null,
          });
        }
      }

      if (
        isEvoraEnterpriseName(ent?.name ?? null) &&
        effectiveCommercialRule.ruleId === 'seguranca_portaria' &&
        commercialMessagesToSend.length > 0
      ) {
        const securityContextText = `${trimmed}\n${lastAssistantPlain ?? ''}`;
        const securityLifestyleContext =
          /\b(seguran[cç]a|tranquilidade|tranquilo|calma|calmaria|família|familia|morar|moradia|prote[cç][aã]o|portaria|controle de acesso)\b/i.test(
            securityContextText
          );

        if (securityLifestyleContext && !/^Esse ponto é importante/i.test(commercialMessagesToSend[0] ?? '')) {
          const firstName =
            toFirstName(
              trustedCustomerName ||
                effectiveConv.customer_name ||
                getLeadQualificationState(flowStateParsed).name ||
                null
            );

          const securityLeadIn = firstName
            ? `Esse ponto é importante, ${firstName}. Para quem pensa em morar, segurança não é só portaria: é previsibilidade na rotina, tranquilidade para a família e controle de acesso no dia a dia.`
            : 'Esse ponto é importante. Para quem pensa em morar, segurança não é só portaria: é previsibilidade na rotina, tranquilidade para a família e controle de acesso no dia a dia.';

          commercialMessagesToSend[0] = `${securityLeadIn}\n\n${commercialMessagesToSend[0]}`.trim();

          console.log('[ANA_SECURITY_LIFESTYLE_LEAD_IN_APPLIED]', {
            conversationId,
            enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
            firstName: firstName ?? null,
          });
        }
      }

      if (
        isEvoraEnterpriseName(ent?.name ?? null) &&
        (effectiveCommercialRule.ruleId === 'areas_lazer' || effectiveCommercialRule.ruleId === 'seguranca_portaria') &&
        commercialMessagesToSend.length > 0
      ) {
        const joinedCommercialReply = commercialMessagesToSend.join('\n').toLowerCase();
        const alreadyRescuesTopics =
          /seguran[cç]a/.test(joinedCommercialReply) &&
          /(regi[aã]o|localiza[cç][aã]o|acesso)/.test(joinedCommercialReply);

        const userAskedSpecificSubtopic =
          /\b(beach\s*tennis|tenis|tênis|piscina|academia|society|campo|quadra|playground|portaria|controle de acesso)\b/i.test(trimmed);

        if (!alreadyRescuesTopics && userAskedSpecificSubtopic) {
          commercialMessagesToSend.push(
            'Além desse ponto, quer que eu te explique também sobre segurança, região/acesso ou os lotes?'
          );

          console.log('[ANA_TOPIC_RESCUE_QUESTION_APPENDED]', {
            conversationId,
            enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
            ruleId: effectiveCommercialRule.ruleId,
          });
        }
      }

      if (
        isEvoraEnterpriseName(ent?.name ?? null) &&
        commercialMessagesToSend.length > 0 &&
        !evoraCommercialRegionOverrideApplied
      ) {
        const currentSafeTopic =
          effectiveCommercialRule.ruleId === 'areas_lazer'
            ? 'lazer'
            : effectiveCommercialRule.ruleId === 'seguranca_portaria'
              ? 'seguranca'
              : effectiveCommercialRule.ruleId === 'localizacao_endereco' || effectiveCommercialRule.ruleId === 'endereco'
                ? 'localizacao'
                : effectiveCommercialRule.ruleId === 'metragem_faixa' ||
                    effectiveCommercialRule.ruleId === 'metragem_especifica' ||
                    effectiveCommercialRule.ruleId === 'quantidade_lotes_info_gap'
                  ? 'lotes'
                  : effectiveCommercialRule.ruleId === 'preco_valor_lote' ||
                      effectiveCommercialRule.ruleId === 'formas_pagamento' ||
                      effectiveCommercialRule.ruleId === 'entrada' ||
                      effectiveCommercialRule.ruleId === 'parcela_simulacao'
                    ? 'valores'
                    : null;

        if (currentSafeTopic != null) {
          const safeNextTopicQuestion = buildEvoraSafeNextTopicQuestion(currentSafeTopic);
          const lastIndex = commercialMessagesToSend.length - 1;
          const cleanedLastMessage = stripEvoraTrailingQuestion(commercialMessagesToSend[lastIndex] ?? '');

          if (cleanedLastMessage.length > 0) {
            commercialMessagesToSend[lastIndex] = cleanedLastMessage;
          } else {
            commercialMessagesToSend.splice(lastIndex, 1);
          }

          commercialMessagesToSend.push(safeNextTopicQuestion);

          console.log('[ANA_EVORA_NON_REPEATED_TOPIC_OFFER_APPLIED]', {
            conversationId,
            ruleId: effectiveCommercialRule.ruleId,
            currentSafeTopic,
            safeNextTopicQuestion,
          });
        }
      }

      console.log('[ANA_CANONICAL_REPLY_USED]', {
        conversationId,
        intent: effectiveCommercialRule.ruleId,
        messagePartsCount: commercialMessagesToSend.length,
      });

      if (isFirstContactRule && isFirstAnaReply) {
        const firstContactQuestionHistory = collectRecentAssistantQuestionsForFinalCheck({
          flowState: flowStateParsed,
          recentMessages: rows.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        });
        const shouldAskName = shouldAskNameFirst({
          isFirstAnaReply,
          isEvora: isEvoraEnterpriseName(ent?.name ?? null),
          hasKnownCustomerName,
          state: getLeadQualificationState(flowStateParsed),
          userMessage: trimmed,
        });
        const nonNameFirstContactQuestion = selectNextLeadQualificationQuestion({
          state: getLeadQualificationState(flowStateParsed),
          userMessage: trimmed,
          customerName: trustedCustomerName || effectiveConv.customer_name || null,
          recentQuestions: firstContactQuestionHistory,
        });
        const firstContactQuestionSelection: LeadQualificationQuestionSelection = shouldAskName
          ? { key: 'name', question: buildLeadQualificationNameQuestion() }
          : nonNameFirstContactQuestion ?? {
              key: 'purpose',
              question: 'Voce esta olhando o Evora mais pensando em morar, investir ou ainda esta conhecendo as possibilidades?',
            };
        const firstContactQuestion = firstContactQuestionSelection.question;
        flowStateParsed = markLeadQualificationQuestionAsked(flowStateParsed, firstContactQuestionSelection);
        if (shouldAskName) {
          console.log('[ANA_LEAD_QUALIFICATION_NAME_ASKED]', {
            conversationId,
            source: 'first_contact',
          });
        }
        const firstContactIntro =
          !shouldAskName && firstContactQuestionSelection.key === 'purpose'
            ? buildEvoraShortPresentationAfterName(
                trustedCustomerName ||
                  effectiveConv.customer_name ||
                  getLeadQualificationState(flowStateParsed).name ||
                  null
              )
            : null;
        const firstContactMessages = dedupeMessageParts(
          [firstContactIntro, firstContactQuestion].filter((part): part is string => Boolean(part && part.trim())),
          {
            conversationId,
            stage: 'evora_first_contact_split',
          }
        ).filter(Boolean);
        console.log('[ANA_FIRST_CONTACT_RESPONSE_SPLIT]', {
          conversationId,
          messageCount: firstContactMessages.length,
        });
        const committedFirstContact = commitTurnResponse({
          handler: 'deterministic_commercial_rule_first_contact',
          reason: 'rule_first_contact_split',
          parts: firstContactMessages,
          stage: 'commercial_rule_first_contact_split',
          requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
          commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
          shouldCallQwen: false,
        });
        if (!committedFirstContact.committed || !committedFirstContact.text.trim()) {
          anaTurnAuditOutcome = 'blocked';
          anaTurnAuditBlockedReason = 'first_contact_commit_blocked';
          return;
        }
        if (isPipelineStale(conversationId, replyPipelineToken)) {
          anaTurnAuditOutcome = 'silent';
          anaTurnAuditBlockedReason = 'pipeline_stale_before_first_contact_send';
          return;
        }
        const firstContactSend = await sendAnaOutboundMessages({
          conversationId,
          toPhoneNumber,
          text: committedFirstContact.text,
          phase: 'commercial_rules',
          replyPipelineToken,
        });
        if (!firstContactSend.success || firstContactSend.metaMessageIds.length === 0) {
          anaTurnAuditOutcome = 'send_failed';
          anaTurnAuditBlockedReason = 'first_contact_send_failed';
          return;
        }
        if (replyExplicitlyAsksCustomerName(committedFirstContact.text)) {
          await markAnaAskedForCustomerName(conversationId);
        }
        const committedFirstContactState = updateConversationStateFromCommittedReply({
          conversationId,
          flowState: flowStateParsed,
          finalReplyParts: committedFirstContact.parts,
          finalReplyText: committedFirstContact.text,
          handler: 'deterministic_commercial_rule_first_contact',
          currentTopic: anaTurnContextResolved?.currentTopic ?? null,
          requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
          commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
        });
        flowStateParsed = committedFirstContactState.nextState;
        await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
        await applyAnaConversationUpdate(conversationId, {
          classification: 'Qualificado',
          lead_temperature: maxLeadTemperature(effectiveConv.lead_temperature, 'quente'),
          handoff: false,
        });
        console.log('[ANA_CANONICAL_TURN_SHORT_CIRCUITED]', {
          conversationId,
          intent: 'first_contact',
        });
        anaTurnAuditOutcome = 'sent';
        anaTurnAuditBlockedReason = null;
        anaTurnAuditLlmStatus = 'skipped';
        anaTurnAuditModel = 'commercial_rules';
        anaTurnDiagnostics.finalResponse.replySource = effectiveCommercialRule.replySource;
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        return;
      }

      const leadQualificationTopicByRule = (() => {
        if (effectiveCommercialRule.ruleId === 'preco_valor_lote' || effectiveCommercialRule.ruleId === 'parcela_simulacao') return 'valores';
        if (effectiveCommercialRule.ruleId === 'localizacao_endereco' || effectiveCommercialRule.ruleId === 'endereco') return 'localizacao';
        if (effectiveCommercialRule.ruleId === 'areas_lazer') return 'lazer';
        if (effectiveCommercialRule.ruleId === 'seguranca_portaria') return 'seguranca';
        if (
          effectiveCommercialRule.ruleId === 'metragem_faixa' ||
          effectiveCommercialRule.ruleId === 'metragem_especifica' ||
          effectiveCommercialRule.ruleId === 'quantidade_lotes_info_gap'
        ) return 'lotes';
        return null;
      })();
      if (
        evoraLeadQualificationEnabled &&
        leadQualificationTopicByRule &&
        commercialMessagesToSend.length > 0 &&
        effectiveCommercialRule.ruleId !== 'endereco'
      ) {
        const qualificationQuestionHistory = collectRecentAssistantQuestionsForFinalCheck({
          flowState: flowStateParsed,
          recentMessages: rows.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        });
        const nextQualificationQuestion = selectNextLeadQualificationQuestion({
          state: getLeadQualificationState(flowStateParsed),
          userMessage: trimmed,
          customerName: trustedCustomerName || effectiveConv.customer_name || null,
          answeredTopic: leadQualificationTopicByRule,
          recentQuestions: qualificationQuestionHistory,
        });
        if (nextQualificationQuestion) {
          const commercialReplyBody = stripTrailingQuestion(commercialMessagesToSend.join('\n\n'));
          commercialMessagesToSend.length = 0;
          commercialMessagesToSend.push(`${commercialReplyBody}\n\n${nextQualificationQuestion.question}`.trim());
          flowStateParsed = markLeadQualificationQuestionAsked(flowStateParsed, nextQualificationQuestion);
          console.log('[ANA_FINAL_QUESTION_SELECTED_FROM_QUALIFICATION]', {
            conversationId,
            key: nextQualificationQuestion.key,
            topic: leadQualificationTopicByRule,
            question: nextQualificationQuestion.question,
          });
          console.log('[ANA_LEAD_QUALIFICATION_NEXT_QUESTION_SELECTED]', {
            conversationId,
            key: nextQualificationQuestion.key,
            question: nextQualificationQuestion.question,
          });
          if (nextQualificationQuestion.key === 'name') {
            console.log('[ANA_LEAD_QUALIFICATION_NAME_ASKED]', {
              conversationId,
              source: 'commercial_rule_followup',
            });
          }
        } else {
          console.log('[ANA_LEAD_QUALIFICATION_QUESTION_SKIPPED_ALREADY_ASKED]', {
            conversationId,
            topic: leadQualificationTopicByRule,
            askedQualificationKeys: getLeadQualificationState(flowStateParsed).askedQualificationKeys,
          });
        }
      }

      const shouldAskNameAfterCommercialReply =
        !evoraLeadQualificationEnabled &&
        !hasKnownCustomerName &&
        effectiveCommercialRule.ruleId !== 'visita_agendamento' &&
        effectiveCommercialRule.ruleId !== 'localizacao_endereco' &&
        effectiveCommercialRule.ruleId !== 'endereco' &&
        effectiveCommercialRule.ruleId !== 'quantidade_lotes_info_gap' &&
        effectiveCommercialRule.ruleId !== 'metragem_faixa' &&
        effectiveCommercialRule.ruleId !== 'metragem_especifica' &&
        effectiveCommercialRule.ruleId !== 'preco_valor_lote' &&
        effectiveCommercialRule.ruleId !== 'parcela_simulacao' &&
        effectiveCommercialRule.ruleId !== 'entrada' &&
        effectiveCommercialRule.ruleId !== 'formas_pagamento';
      if (shouldAskNameAfterCommercialReply) {
        commercialMessagesToSend.push(ANA_COMMERCIAL_RULES.askNameMessage);
      }

      let lastCommercialRuleMetaMessageId: string | null = null;
      const recentAssistantForNoRepeat = [...rows]
        .filter((m) => m.role === 'assistant')
        .map((m) => (m.content || '').trim())
        .filter((msg) => msg.length > 0)
        .slice(-8);
      const processedCommercialRuleMessages: string[] = [];
      for (const [index, commercialRuleMessageRaw] of commercialMessagesToSend.entries()) {
        let commercialRuleMessage = commercialRuleMessageRaw;
        const aggressiveBlockCommercial = blockLegacyAggressiveVisitCtaByIntent({
          text: commercialRuleMessage,
          intent: effectiveCommercialRule.ruleId,
          hasRecentVisitCta,
        });
        if (aggressiveBlockCommercial.changed) {
          commercialRuleMessage = aggressiveBlockCommercial.text;
          console.log('[ANA_VISIT_OFFER_SUPPRESSED]', {
            conversationId,
            intent: effectiveCommercialRule.ruleId,
            reason: aggressiveBlockCommercial.reason,
          });
          if (hasRecentVisitCta) {
            console.log('[ANA_CTA_REPEAT_SUPPRESSED]', {
              conversationId,
              ctaType: 'visit_offer',
              reason: aggressiveBlockCommercial.reason,
              phase: 'commercial_rule_message',
            });
          }
        }
        if (effectiveCommercialRule.ruleId !== 'visita_agendamento') {
          const visitSuppressed = stripInappropriateVisitOffer(commercialRuleMessage);
          if (visitSuppressed.removed) {
            commercialRuleMessage = visitSuppressed.text;
            console.log('[ANA_VISIT_OFFER_SUPPRESSED]', {
              conversationId,
              intent: effectiveCommercialRule.ruleId,
              reason: 'removed_from_canonical_non_visit_intent',
            });
          }
        }
        const commercialPolicyResult = applyAnaConversationPolicy({
          conversationId,
          userMessage: trimmed,
          replyText: commercialRuleMessage,
          isFirstAnaReply: isFirstAnaReply && index === 0,
          flowState: flowStateParsed,
          recentMessages: rows.map((m) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
          })),
          knownCustomerName: trustedCustomerName || effectiveConv.customer_name || null,
          probableCustomerName:
            !(trustedCustomerName || effectiveConv.customer_name || '').trim()
              ? linkedContact?.first_name ?? linkedContact?.full_name ?? null
              : null,
          now: lastUserMessageAt,
          disableFollowupQuestion:
            effectiveCommercialRule.ruleId === 'visita_agendamento' || commercialMessagesToSend.length > 1,
          visitFlowActive:
            !visitFlowSuppressedByConfirmationContext &&
            (effectiveCommercialRule.ruleId === 'visita_agendamento' ||
              appointmentPreflight.active ||
              flowStateParsed.pendingVisitScheduling === true ||
              flowStateParsed.visitScheduling?.active === true),
          shortConfirmationContext: shortConfirmationContext.isShortConfirmation
            ? {
                kind: shortConfirmationContext.kind,
                lastAssistantQuestionType: shortConfirmationContext.lastAssistantQuestionType,
                lastAssistantQuestionText: shortConfirmationContext.lastAssistantQuestionText,
                lastOfferedTopics: shortConfirmationContext.lastOfferedTopics,
              }
            : undefined,
          safeTopicAvailability: safeTopicAvailabilityForPolicy,
          isKnowledgeGapTurn,
        });
        commercialRuleMessage = commercialPolicyResult.text;
        if (commercialPolicyResult.changed) {
          flowStateParsed = commercialPolicyResult.flowState;
          await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
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
          console.log('[ANA_REPEAT_REPLY_AVOIDED]', {
            conversationId,
            intent: effectiveCommercialRule.ruleId,
            reason: noRepeatForCommercialRule.reason,
          });
          console.log('[ANA_REPEAT_SUPPRESSED]', {
            conversationId,
            reason: noRepeatForCommercialRule.reason,
            phase: 'commercial_rule_message',
          });
        }
        if (commercialRuleMessage.trim()) {
          processedCommercialRuleMessages.push(commercialRuleMessage.trim());
          recentAssistantForNoRepeat.push(commercialRuleMessage.trim());
        }
      }
      if (
        isEvoraEnterpriseName(ent?.name ?? null) &&
        effectiveCommercialRule.ruleId !== 'visita_agendamento' &&
        processedCommercialRuleMessages.length > 0
      ) {
        const safeGuardCurrentTopic: 'lazer' | 'seguranca' | 'localizacao' | 'lotes' | 'valores' | null = (() => {
          if (effectiveCommercialRule.ruleId === 'areas_lazer') return 'lazer';
          if (effectiveCommercialRule.ruleId === 'seguranca_portaria') return 'seguranca';
          if (effectiveCommercialRule.ruleId === 'localizacao_endereco' || effectiveCommercialRule.ruleId === 'endereco') return 'localizacao';
          if (
            effectiveCommercialRule.ruleId === 'metragem_faixa' ||
            effectiveCommercialRule.ruleId === 'metragem_especifica' ||
            effectiveCommercialRule.ruleId === 'quantidade_lotes_info_gap'
          ) return 'lotes';
          if (
            effectiveCommercialRule.ruleId === 'preco_valor_lote' ||
            effectiveCommercialRule.ruleId === 'formas_pagamento' ||
            effectiveCommercialRule.ruleId === 'entrada' ||
            effectiveCommercialRule.ruleId === 'parcela_simulacao'
          ) return 'valores';
          return null;
        })();

        const commercialReplyAlreadyHasQuestion = processedCommercialRuleMessages.some((message) =>
          /\?\s*$/.test((message || '').trim()) || /\?/.test(message || '')
        );

        if (safeGuardCurrentTopic != null && !commercialReplyAlreadyHasQuestion) {
          const safeFinalQuestion = buildEvoraSafeNextTopicQuestion(safeGuardCurrentTopic);
          processedCommercialRuleMessages.push(safeFinalQuestion);

          console.log('[ANA_EVORA_COMMERCIAL_FINAL_QUESTION_GUARD]', {
            conversationId,
            ruleId: effectiveCommercialRule.ruleId,
            safeGuardCurrentTopic,
            safeFinalQuestion,
          });
        }
      }

      if (effectiveCommercialRule.ruleId === 'first_contact' && isFirstAnaReply) {
        const finalQuestionHistoryForCommercialRule = collectRecentAssistantQuestionsForFinalCheck({
          flowState: flowStateParsed,
          recentMessages: rows.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        });
        const lastCommercialMessage = processedCommercialRuleMessages[processedCommercialRuleMessages.length - 1] ?? '';
        const finalQuestionCheck = evaluateFinalQuestionCheck({
          replyText: lastCommercialMessage,
          recentQuestions: finalQuestionHistoryForCommercialRule,
        });
        console.log('[ANA_FINAL_QUESTION_REQUIRED]', {
          conversationId,
          handler: 'deterministic_commercial_rule_first_contact',
          hasFinalQuestion: finalQuestionCheck.hasFinalQuestion,
          repeatedQuestion: finalQuestionCheck.repeatedQuestion,
          forbiddenQuestion: finalQuestionCheck.forbiddenQuestion,
        });
        if (
          !finalQuestionCheck.hasFinalQuestion ||
          finalQuestionCheck.repeatedQuestion ||
          finalQuestionCheck.forbiddenQuestion
        ) {
          console.log('[ANA_FINAL_QUESTION_MISSING]', {
            conversationId,
            reasons: finalQuestionCheck.reasons,
          });
          const contextualQuestion = pickContextualCommercialFollowupQuestion({
            userMessage: trimmed,
            recentQuestions: finalQuestionHistoryForCommercialRule,
            topicHint: 'first_contact',
          });
          if (contextualQuestion) {
            processedCommercialRuleMessages.push(contextualQuestion);
          }
        }
      }
      const committedCommercialRule = commitTurnResponse({
        handler: 'deterministic_commercial_rule',
        reason: `rule_${effectiveCommercialRule.ruleId}`,
        parts: [...processedCommercialRuleMessages, ...visitOfferMessagesFromCommercialRule],
        stage: 'commercial_rule_messages_final',
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
        shouldCallQwen: false,
      });
      if (!committedCommercialRule.committed || !committedCommercialRule.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'commercial_rule_commit_blocked';
        return;
      }
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_commercial_rule_send';
        anaTurnDiagnostics.finalResponse.replySource = effectiveCommercialRule.replySource;
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        return;
      }
      const sendResult = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: committedCommercialRule.text,
        phase: 'commercial_rules',
        replyPipelineToken,
      });
      if (!sendResult.success || sendResult.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'commercial_rule_send_failed';
        anaTurnDiagnostics.finalResponse.replySource = effectiveCommercialRule.replySource;
        anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
        markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'failed', {
          replySource: effectiveCommercialRule.replySource,
          outboundStatus: anaTurnAuditOutcome,
          blockedReason: anaTurnAuditBlockedReason,
        });
        return;
      }
      lastCommercialRuleMetaMessageId = sendResult.metaMessageIds[sendResult.metaMessageIds.length - 1] ?? null;
      const committedCommercialState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedCommercialRule.parts,
        finalReplyText: committedCommercialRule.text,
        handler: 'deterministic_commercial_rule',
        currentTopic: anaTurnContextResolved?.currentTopic ?? null,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
      });
      flowStateParsed = committedCommercialState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
      console.log('[ANA_COMMITTED_REPLY_STATE_SAVED]', {
        conversationId,
        savedFields: [
          'lastAssistantQuestionText',
          'lastAssistantQuestionType',
          'recentQuestions',
          'lastOfferedTopics',
          'lastAnsweredTopic',
          'topicsAlreadyAnswered',
          'lastCommittedHandler',
          'lastCommittedAt',
        ],
      });

      await applyAnaConversationUpdate(conversationId, {
        classification: 'Qualificado',
        lead_temperature: maxLeadTemperature(effectiveConv.lead_temperature, 'quente'),
        handoff: false,
      });

      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'commercial_rules';
      anaTurnAuditGuardsApplied.outboundReason = `commercial_rule_${effectiveCommercialRule.ruleId}`;
      anaTurnDiagnostics.finalResponse.replySource = effectiveCommercialRule.replySource;
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'llm_generation', 'skipped', {
        reason: `commercial_rule_${effectiveCommercialRule.ruleId}`,
      });
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
        replySource: effectiveCommercialRule.replySource,
        outboundStatus: anaTurnAuditOutcome,
        messagesCount: effectiveCommercialRule.messages.length + visitOfferMessagesFromCommercialRule.length,
      });
      console.log(
        isFirstContactRule ? '[ANA_COMMERCIAL_RULE_FIRST_CONTACT_SENT]' : '[ANA_COMMERCIAL_RULE_INTENT_SENT]',
        {
          conversationId,
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          ruleId: effectiveCommercialRule.ruleId,
          messagesCount: effectiveCommercialRule.messages.length,
          outboundMetaMessageId: lastCommercialRuleMetaMessageId,
        }
      );
      console.log('[ANA_CANONICAL_TURN_SHORT_CIRCUITED]', {
        conversationId,
        intent: effectiveCommercialRule.ruleId,
      });
      return;
    }
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

    const ragMissingAndKnowledgeDependent =
      ragChunksFound === 0 &&
      isKnowledgeDependentRequest(userMessageForReasoning, currentAxisForRepetition);
    if (isKnowledgeGapTurn && ragMissingAndKnowledgeDependent) {
      console.log('[ANA_RAG_MISSING_BYPASSED_FOR_KNOWLEDGE_GAP]', {
        conversationId,
        reason: knowledgeGapMeta.reason,
        matchedIntent: knowledgeGapMeta.matchedIntent ?? null,
      });
    }
    const shouldBlockFreeformWithoutRag =
      !globalNoEnterpriseMode &&
      !ANA_LLM_FIRST_COMMERCIAL_REPLIES &&
      !isKnowledgeGapTurn &&
      ragMissingAndKnowledgeDependent;
    if (shouldBlockFreeformWithoutRag) {
      const canonicalReply = buildCanonicalSafeReplyForMissingRag({
        axis: currentAxisForRepetition,
        isEvora: isEvoraEnterpriseName(ent?.name ?? null),
      });
      console.log('[ANA_RAG_CONTEXT_MISSING_BLOCKED_FREEFORM]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        userMessagePreview: userMessageForReasoning.slice(0, 260),
        chunksCount: ragChunksFound,
        chunkIds: Array.from(ragChunkIds).slice(0, 30),
        contextChars: knowledgeText.length,
      });
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_rag_missing_fallback';
        return;
      }
      const sendCanonical = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: canonicalReply,
        phase: 'ana_rag_missing_fallback',
        replyPipelineToken,
      });
      if (!sendCanonical.success || sendCanonical.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'rag_missing_fallback_send_failed';
        return;
      }
      anaTurnAuditOutcome = 'blocked';
      anaTurnAuditBlockedReason = 'rag_missing_blocked_freeform';
      anaTurnDiagnostics.finalResponse.replySource = 'policy_missing_information';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
        replySource: 'policy_missing_information',
        outboundStatus: anaTurnAuditOutcome,
      });
      return;
    }

    const commercialNoLlmIntent = detectAnaCommercialSpecificNoLlmIntent(trimmed);
    const commercialNoLlmMissingAuthorizedData =
      commercialNoLlmIntent === 'price'
        ? !enterpriseEvidence.hasPricingInfo
        : commercialNoLlmIntent != null && isCommercialNoLlmIntentAlwaysSensitive(commercialNoLlmIntent);
    if (
      !globalNoEnterpriseMode &&
      !ANA_LLM_FIRST_COMMERCIAL_REPLIES &&
      anaBudgetConfig.priceMissingNoLlm &&
      commercialNoLlmIntent != null &&
      commercialNoLlmMissingAuthorizedData
    ) {
      const noLlmReply = buildAnaCommercialSpecificNoLlmReply({
        intent: commercialNoLlmIntent,
        userMessage: trimmed,
        hasSendableBook: enterpriseEvidence.hasSendableBook,
      });
      console.log('[ANA_PRICE_MISSING_NO_LLM_BYPASS]', {
        conversationId,
        intent: commercialNoLlmIntent,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        hasPricingInfo: enterpriseEvidence.hasPricingInfo,
        hasFinancingInfo: enterpriseEvidence.hasFinancingInfo,
        hasSendableBook: enterpriseEvidence.hasSendableBook,
      });
      const committedNoLlmReply = commitTurnResponse({
        handler: 'commercial_specific_no_llm',
        reason: `price_missing_no_llm_${commercialNoLlmIntent}`,
        parts: [noLlmReply],
        stage: 'commercial_specific_no_llm',
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
        shouldCallQwen: false,
      });
      if (!committedNoLlmReply.committed || !committedNoLlmReply.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'commercial_specific_no_llm_commit_blocked';
        return;
      }
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_commercial_specific_no_llm';
        return;
      }
      const noLlmSend = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: committedNoLlmReply.text,
        phase: 'commercial_specific_no_llm',
        replyPipelineToken,
      });
      if (!noLlmSend.success || noLlmSend.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'commercial_specific_no_llm_send_failed';
        return;
      }
      const committedNoLlmState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedNoLlmReply.parts,
        finalReplyText: committedNoLlmReply.text,
        handler: 'commercial_specific_no_llm',
        currentTopic: anaTurnContextResolved?.currentTopic ?? null,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
      });
      flowStateParsed = committedNoLlmState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'commercial_specific_no_llm';
      anaTurnAuditRequestType = 'ana_price_missing_no_llm';
      anaTurnAuditGuardsApplied.outboundReason = `price_missing_no_llm_${commercialNoLlmIntent}`;
      anaTurnDiagnostics.fallbackUsed = true;
      anaTurnDiagnostics.fallbackReason = `price_missing_no_llm_${commercialNoLlmIntent}`;
      anaTurnDiagnostics.finalResponse.replySource = 'commercial_specific_no_llm';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'llm_generation', 'skipped', {
        reason: 'price_missing_no_llm',
        intent: commercialNoLlmIntent,
      });
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
        replySource: 'commercial_specific_no_llm',
        outboundStatus: anaTurnAuditOutcome,
      });
      return;
    }

    anaEngineTrace('prompt_build_start', { conversationId, historyCount, mode });
    const isLocalQwenRuntime =
      isLocalOrCustomProviderContext(resolvedAiSettings.openaiBaseUrl) ||
      isQwenLikeModel((resolvedAiSettings?.modelHotLead || '').trim()) ||
      isQwenLikeModel((resolvedAiSettings?.modelColdLead || '').trim());
    const knowledgeEvidenceBody = knowledgeText.trim();
    const evidenceHeader =
      'BASE DO EMPREENDIMENTO / EVIDÊNCIAS AUTORIZADAS\n' +
      'Responda somente com base nas evidências acima. Se não houver evidência suficiente, conduza para corretor/visita sem inventar.\n';
    const localEvidenceBudget = Math.max(2_400, Math.min(promptRagMaxContextChars, 6_000));
    const promptKnowledgeText = knowledgeEvidenceBody
      ? isLocalQwenRuntime
        ? `${evidenceHeader}\n${knowledgeEvidenceBody.slice(0, localEvidenceBudget)}`
        : knowledgeEvidenceBody
      : '';
    const promptOpts: BuildAnaSystemPromptOpts = {
      mode,
      enterprise: ent,
      variablesMap: vars,
      knowledgeText: promptKnowledgeText,
      fileInventory,
      allEnterpriseNames,
      requestedProductType: promptProductTypeForPrompt,
      knownCustomerName: effectiveConv.customer_name,
      probableCustomerName:
        !(effectiveConv.customer_name || '').trim()
          ? linkedContact?.first_name ?? linkedContact?.full_name ?? null
          : null,
      customerNameMentionsSoFar: effectiveConv.ana_customer_name_mentions ?? 0,
      anaAskedCustomerName: effectiveConv.ana_asked_customer_name === true,
      conversationClassification: effectiveConv.classification,
      appointmentPreflight,
      openAppointmentSummary,
      locationQueryContext:
        globalNoEnterpriseMode || (mode === 'scoped' && ent) ? undefined : (locationQueryContext ?? undefined),
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
      provider: anaTurnDiagnostics.provider,
      baseUrl: resolvedAiSettings?.openaiBaseUrl ?? null,
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

    let systemPrompt = buildAnaSystemPrompt(promptOpts);
    if (isLocalQwenRuntime && systemPrompt.length > 12_000 && promptKnowledgeText.length > 0) {
      const tighterKnowledge = `${evidenceHeader}\n${knowledgeEvidenceBody.slice(0, 3_500)}`;
      systemPrompt = buildAnaSystemPrompt({
        ...promptOpts,
        knowledgeText: tighterKnowledge,
      });
      console.log('[ANA_QWEN_PROMPT_REDUCED]', {
        conversationId,
        chunksCountEffective: Math.min(ragChunksFound, 6),
        contextChars: tighterKnowledge.length,
        systemPromptLen: systemPrompt.length,
      });
    }
    anaTurnDiagnostics.model = model;
    anaTurnDiagnostics.llm.model = model;
    anaTurnDiagnostics.rag.includedInPrompt = promptKnowledgeText.trim().length > 0;
    markAnaTurnStage(anaTurnDiagnostics, 'prompt_build', 'passed', {
      mode,
      model,
      modelSelectionReason: 'db_config',
      enterpriseResolvedForModel,
      knowledgeTextLength: promptKnowledgeText.length,
      knowledgeIncludedInPrompt: anaTurnDiagnostics.rag.includedInPrompt,
      messagesPlanned: history.length + 2,
    });
    console.log('[ANA_RAG_CONTEXT_RESOLVED]', {
      conversationId,
      enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
      userMessagePreview: userMessageForReasoning.slice(0, 260),
      chunksCount: isLocalQwenRuntime ? Math.min(ragChunksFound, 6) : ragChunksFound,
      chunkIds: Array.from(ragChunkIds).slice(0, 30),
      fileVersionIds: [],
      contextChars: promptKnowledgeText.length,
      systemPromptLen: systemPrompt.length,
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
        : isEvoraEnterpriseName(ent?.name ?? null)
          ? 'Responda de forma natural, consultiva e menos seca. Use 2 a 4 frases quando o assunto pedir contexto. Pode separar em até 2 mensagens curtas. Conecte o interesse do cliente ao Évora, cite 2 ou 3 pontos relevantes e finalize com UMA pergunta objetiva de avanço. Nao antecipe visita logo apos o cliente dizer que ainda nao visitou; nesse caso, pergunte qual tema ele quer entender primeiro: lazer, segurança, região/acesso, lotes ou valores. Ao aprofundar um assunto especifico, como beach tennis, piscina ou seguranca, finalize resgatando outros temas importantes em vez de ficar apenas no mesmo assunto.'
          : 'Responda de forma curta e objetiva, com no maximo 3 linhas e no maximo 1 pergunta.',
      anaDecision.shouldSuggestVisit
        ? 'O cliente demonstrou interesse comercial direto ou oportunidade clara de avanço. Nao responda apenas com localizacao ou uma frase vaga como "Que mais?". Responda com acolhimento e contexto suficiente, conectando o interesse do cliente ao empreendimento. Traga 2 pontos relevantes quando fizer sentido e conduza com UMA pergunta concreta de avanço. Regra importante: nao ofereca agendamento de visita cedo demais, especialmente quando o cliente apenas respondeu "ainda nao" sobre ja ter visitado. Antes de pedir dia/horario de visita, responda as duvidas do cliente e resgate temas relevantes como lazer, seguranca, regiao/acesso, lotes/tamanho e formas de pagamento. Ofereca visita apenas quando o cliente pedir, demonstrar clara prontidao, ou depois de pelo menos alguns temas principais terem sido esclarecidos. Se falar de visita, use tom humano: "O corretor pode te passar tudo certinho. Que tal marcarmos uma visita?". Evite perguntas abstratas como "como voce imagina seu dia começando?".'
        : null,
      !anaDecision.canMentionExactLocation
        ? 'Nao passe endereco/localizacao exata como se estivesse confirmado.'
        : null,
      !anaDecision.canMentionPaymentSimulation
        ? 'Nao simule pagamento, entrada, parcela, prazo, juros ou desconto.'
        : null,
      ANA_LLM_FIRST_COMMERCIAL_REPLIES && isEvoraEnterpriseName(ent?.name ?? null)
        ? 'Responda perguntas comerciais com base no RAG/evidencias autorizadas. Nao invente. Se faltar informacao ou depender de disponibilidade/condicao atualizada, ofereca corretor ou visita naturalmente, mas nao antes de tirar as duvidas principais. Seja natural e comercial. Nao mencione NETIV, sistema, RAG, base, regra ou instrucao interna. No Évora, evite ficar preso em um único detalhe por muitas respostas seguidas: conecte o tema atual a uma visão mais ampla de rotina, natureza, lazer, segurança, localização, família e visita. Depois que o cliente disser morar, investir ou conhecer, avance a descoberta com perguntas concretas. Quando concluir ou aprofundar um tema, resgate outros temas úteis em forma de escolha simples, por exemplo: "Quer que eu te explique também sobre segurança, região/acesso ou os lotes?". Nao conduza tudo para visita antes de responder lazer, seguranca, regiao/localizacao ou tamanho dos lotes, salvo se o cliente pedir visita diretamente.'
        : null,
      isLocalQwenRuntime
        ? 'Não copie instruções internas. Responda apenas ao cliente com fatos autorizados.'
        : null,
      isEvoraEnterpriseName(ent?.name ?? null)
        ? 'No Évora, trate sempre como loteamento fechado (nunca apartamento), com lotes a partir de 360 m² em Atibaia, região da Pedreira, acesso pela Rodovia Dom Pedro I, cerca de 50 minutos de São Paulo, lazer completo e segurança com portaria 24h. Nunca invente valor específico.'
        : null,
    ]
      .filter((line): line is string => Boolean(line))
      .join('\n');
    const evoraLlmFirstCompactMode =
      ANA_LLM_FIRST_COMMERCIAL_REPLIES && isEvoraEnterpriseName(ent?.name ?? null);

    const conversationalQwenMode =
      globalNoEnterpriseMode ||
      isKnowledgeGapTurn === true ||
      evoraLlmFirstCompactMode ||
      (
        !(ANA_LLM_FIRST_COMMERCIAL_REPLIES && isEvoraEnterpriseName(ent?.name ?? null)) &&
        isLocalQwenRuntime &&
        (
          isConversationalGenericFollowup(trimmed) ||
          anaDecision.isGenericOpenQuestion === true ||
          (requestedAxisForPolicy == null && !anaDecision.shouldAnswerDirectly)
        )
      );
    const responseFormatJsonForTurn = isKnowledgeGapTurn === true ? false : !conversationalQwenMode;
    const globalNoEnterpriseOperationalContext = globalNoEnterpriseMode
      ? buildGlobalNoEnterpriseOperationalContext({
          enterpriseResolution,
          activeEnterpriseNames: allActiveEnterprises.map((enterprise) => enterprise.name),
          requestedProductType: triageRequestedProductType,
        })
      : null;
    const initialDiscoveryGuidanceContext = buildInitialDiscoveryGuidanceContext({
      isEvora: isEvoraEnterpriseName(ent?.name ?? null),
      state: getLeadQualificationState(flowStateParsed),
      customerName: trustedCustomerName || effectiveConv.customer_name || null,
      nameCapturedThisTurn: Boolean(trustedCustomerName && lastAssistantAskedCustomerNameThisTurn),
      userMessage: trimmed,
      recentAssistantCount: recentAssistantPlainTexts.length,
    });
    if (initialDiscoveryGuidanceContext) {
      console.log('[ANA_INITIAL_DISCOVERY_GUIDANCE_INJECTED]', {
        conversationId,
        nameCapturedThisTurn: Boolean(trustedCustomerName && lastAssistantAskedCustomerNameThisTurn),
        recentAssistantCount: recentAssistantPlainTexts.length,
        purpose: getLeadQualificationState(flowStateParsed).purpose,
        productFit: getLeadQualificationState(flowStateParsed).productFit,
        objectiveCustomerQuestion: isObjectiveCustomerQuestion(trimmed),
      });
    }
    if (isKnowledgeGapTurn) {
      console.log('[ANA_KNOWLEDGE_GAP_TEXT_MODE_FORCED]', {
        conversationId,
        reason: knowledgeGapMeta.reason,
        matchedIntent: knowledgeGapMeta.matchedIntent ?? null,
      });
    }
    const knownTopics = Array.from(
      new Set([
        ...detectCommercialAxes(userMessageForReasoning),
        ...detectCommercialAxes(lastAssistantPlain || ''),
      ])
    );
    console.log('[ANA_LLM_DECISION]', {
      conversationId,
      willCallQwen: true,
      reason: globalNoEnterpriseMode
        ? 'global_no_enterprise_use_llm'
        : conversationalQwenMode
          ? 'no_clear_deterministic_use_qwen_conversational'
          : 'no_deterministic_rule_use_llm_structured',
      deterministicMatched: false,
      deterministicAxis: requestedAxisForPolicy ?? null,
      replySourceBeforeLlm: null,
      provider: aiSettings.provider,
      model,
      baseUrl: aiSettings.openaiBaseUrl,
      responseFormatJson: responseFormatJsonForTurn,
      historyCount: history.length,
      messagesCount: history.length + 2,
      systemPromptLen: systemPrompt.length,
    });
    const messages: ChatMessage[] = [];
    const knowledgeGapRequiresBrokerForPrompt = knowledgeGapMeta.allowedNextActions.includes('offer_broker_handoff');
    const knowledgeGapRequiresVisitForPrompt = knowledgeGapMeta.allowedNextActions.includes('offer_visit_scheduling');
    const knowledgeGapOperationalContext =
      isKnowledgeGapTurn
        ? [
            '[CONTEXTO OPERACIONAL - NAO MOSTRAR AO CLIENTE]',
            'A pergunta do cliente exige uma informacao que nao esta disponivel com seguranca na base autorizada ou depende de validacao humana.',
            'Nao invente resposta.',
            'Nao tente compensar com informacoes genericas.',
            'Nao diga "o que posso te adiantar".',
            'Nao use uma frase padrao empurrando detalhe sem contexto para o corretor.',
            'Nao pergunte "qual ponto voce quer entender primeiro".',
            'Nao diga valores, quantidades, disponibilidade, tabela, simulacao ou condicoes especificas.',
            'Responda naturalmente como Ana.',
            knowledgeGapRequiresBrokerForPrompt && knowledgeGapRequiresVisitForPrompt
              ? 'Ofereca explicitamente duas opcoes para o cliente escolher:'
              : 'Ofereca explicitamente a proxima acao segura para o cliente:',
            knowledgeGapRequiresBrokerForPrompt ? '1. encaminhar para o corretor responsavel;' : null,
            knowledgeGapRequiresVisitForPrompt ? '2. agendar uma visita.' : null,
            'A resposta deve soar humana, curta e consultiva.',
            `Instrucao adicional: ${knowledgeGapMeta.instructionForModel}`,
            '[/CONTEXTO OPERACIONAL]',
          ].filter(Boolean).join('\n')
        : null;
    const pendingResolutionDisambiguationContext = pendingResolutionNeedsDisambiguation
      ? [
          '[CONTEXTO OPERACIONAL - NAO MOSTRAR AO CLIENTE]',
          'A conversa esta aguardando escolha do cliente entre duas opcoes: corretor responsavel ou agendamento de visita.',
          'A resposta do cliente foi ambigua.',
          'Responda de forma natural e curta pedindo que ele escolha explicitamente entre corretor ou visita.',
          'Nao invente dados comerciais.',
          '[/CONTEXTO OPERACIONAL]',
        ].join('\n')
      : null;
    if (conversationalQwenMode) {
      const compactConversationalKnowledge = promptKnowledgeText.trim()
        ? [
            '[BASE AUTORIZADA DO EMPREENDIMENTO - USE SOMENTE COMO FONTE]',
            promptKnowledgeText.slice(0, 3_500),
            '[/BASE AUTORIZADA DO EMPREENDIMENTO]',
          ].join('\n')
        : '';

      let conversationalPrompt = [
        'MODO CONVERSACIONAL DA ANA',
        'Você é Ana, consultora de vendas do Évora. Responda somente ao cliente, em português brasileiro natural.',
        'Não copie instruções internas. Não mencione sistema, RAG, base, regra, prompt, NETIV ou QMAPE.',
        'Use a base autorizada quando houver informação. Se faltar dado específico, ofereça corretor ou visita de forma natural.',
        'Faça no máximo UMA pergunta útil no final, somente se fizer sentido para avançar a conversa.',
        buildConversationalCanonicalContext(currentAxisForRepetition),
        compactConversationalKnowledge,
                initialDiscoveryGuidanceContext,
        policyRuntimeDirectives,
      ]
        .filter((part): part is string => Boolean(part && part.trim()))
        .join('\n\n');
      if (globalNoEnterpriseMode && globalNoEnterpriseOperationalContext) {
        conversationalPrompt = [
          'MODO CONVERSACIONAL DA ANA',
          'Voce e Ana, atendimento comercial global. Responda somente ao cliente, em portugues brasileiro natural.',
          'Nao copie instrucoes internas. Nao mencione sistema, RAG, base, regra, prompt, NETIV ou QMAPE.',
          'Ainda nao ha empreendimento resolvido. Nao use dados especificos de nenhum empreendimento.',
          'Nao mencione Evora nem qualquer nome especifico de empreendimento se o cliente nao tiver citado esse nome.',
          `Para pedidos genericos de informacoes, use esta resposta segura: "${ANA_GLOBAL_NO_ENTERPRISE_SAFE_DISCOVERY_REPLY}"`,
          globalNoEnterpriseOperationalContext,
          initialDiscoveryGuidanceContext,
          policyRuntimeDirectives,
        ]
          .filter((part): part is string => Boolean(part && part.trim()))
          .join('\n\n');
      }
      messages.push({ role: 'system', content: conversationalPrompt });
      if (knowledgeGapOperationalContext) {
        messages.push({ role: 'system', content: knowledgeGapOperationalContext });
        console.log('[ANA_RESOLUTION_OPTIONS_INJECTED]', { conversationId, mode: 'conversational' });
      }
      if (pendingResolutionDisambiguationContext) {
        messages.push({ role: 'system', content: pendingResolutionDisambiguationContext });
      }
      for (const h of history.slice(-6)) messages.push({ role: h.role, content: h.content });
      messages.push({ role: 'user', content: userMessageForReasoning });
      console.log('[ANA_CONVERSATIONAL_QWEN_ATTEMPT]', {
        conversationId,
        lastAxis: currentAxisForRepetition,
        historyCount: Math.min(history.length, 6),
      });
    } else {
      messages.push({ role: 'system', content: systemPrompt });
      if (policyRuntimeDirectives) {
        messages.push({ role: 'system', content: policyRuntimeDirectives });
      }
      if (initialDiscoveryGuidanceContext) {
        messages.push({ role: 'system', content: initialDiscoveryGuidanceContext });
      }
      if (knowledgeGapOperationalContext) {
        messages.push({ role: 'system', content: knowledgeGapOperationalContext });
        console.log('[ANA_RESOLUTION_OPTIONS_INJECTED]', { conversationId, mode: 'structured' });
      }
      if (pendingResolutionDisambiguationContext) {
        messages.push({ role: 'system', content: pendingResolutionDisambiguationContext });
      }
      for (const h of history) {
        messages.push({ role: h.role, content: h.content });
      }
      messages.push({ role: 'user', content: userMessageForReasoning });
    }

    let tokenBudgetDecision = evaluateAnaTokenBudget(messages, anaBudgetConfig);
    const logTokenBudget = (stage: 'initial' | 'shrunk' | 'blocked', decision: typeof tokenBudgetDecision): void => {
      if (!anaBudgetConfig.auditEnabled) return;
      const payload = {
        conversationId,
        provider: aiSettings.provider,
        model,
        purpose: 'ana_main_reply',
        request_type: 'ana_main_reply',
        strategy: conversationalQwenMode ? 'conversational_text' : 'primary_json',
        estimatedInputTokens: decision.estimatedInputTokens,
        level: decision.level,
        ragChunks: ragChunksFound,
        recentMessagesCount: history.length,
        usedJsonMode: responseFormatJsonForTurn,
        messagesCount: messages.length,
        systemPromptLen: systemPrompt.length,
        stage,
      };
      if (decision.shouldWarn) console.warn('[ANA_TOKEN_BUDGET]', payload);
      else console.log('[ANA_TOKEN_BUDGET]', payload);
    };
    logTokenBudget('initial', tokenBudgetDecision);

    if (tokenBudgetDecision.shouldShrink && !conversationalQwenMode) {
      const compactKnowledgeText = knowledgeEvidenceBody
        ? `${evidenceHeader}\n${knowledgeEvidenceBody.slice(0, 2_000)}`
        : '';
      systemPrompt = buildAnaSystemPrompt({
        ...promptOpts,
        knowledgeText: compactKnowledgeText,
      });
      messages.length = 0;
      messages.push({ role: 'system', content: systemPrompt });
      if (policyRuntimeDirectives) {
        messages.push({ role: 'system', content: policyRuntimeDirectives });
      }
      if (knowledgeGapOperationalContext) {
        messages.push({ role: 'system', content: knowledgeGapOperationalContext });
      }
      if (pendingResolutionDisambiguationContext) {
        messages.push({ role: 'system', content: pendingResolutionDisambiguationContext });
      }
      for (const h of history.slice(-4)) {
        messages.push({ role: h.role, content: h.content });
      }
      messages.push({ role: 'user', content: userMessageForReasoning });
      tokenBudgetDecision = evaluateAnaTokenBudget(messages, anaBudgetConfig);
      logTokenBudget('shrunk', tokenBudgetDecision);
      console.log('[ANA_TOKEN_BUDGET_SHRUNK]', {
        conversationId,
        estimatedInputTokens: tokenBudgetDecision.estimatedInputTokens,
        compactKnowledgeChars: compactKnowledgeText.length,
        historyCount: Math.min(history.length, 4),
      });
    }

    if (tokenBudgetDecision.shouldBlock) {
      if (
        isLlmFirstCommercialTurn({
          isEvora: isEvoraEnterpriseName(ent?.name ?? null),
          userMessage: trimmed,
          requestedAxis: currentAxisForRepetition ?? requestedAxisForPolicy,
          requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        })
      ) {
        console.log('[ANA_COMMERCIAL_FALLBACK_BLOCKED_BY_LLM_FIRST]', {
          conversationId,
          fallbackType: 'token_budget_fallback',
          requestedAxis: currentAxisForRepetition ?? requestedAxisForPolicy,
          requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        });
      }
      const budgetFallbackReply = buildCanonicalSafeReplyForMissingRag({
        axis: currentAxisForRepetition,
        isEvora: isEvoraEnterpriseName(ent?.name ?? null),
      });
      logTokenBudget('blocked', tokenBudgetDecision);
      console.log('[ANA_TOKEN_BUDGET_BLOCKED_NO_LLM]', {
        conversationId,
        estimatedInputTokens: tokenBudgetDecision.estimatedInputTokens,
        blockInputTokens: anaBudgetConfig.blockInputTokens,
        ragChunks: ragChunksFound,
        recentMessagesCount: history.length,
      });
      const committedBudgetFallback = commitTurnResponse({
        handler: 'token_budget_fallback',
        reason: 'estimated_input_tokens_blocked',
        parts: [budgetFallbackReply],
        stage: 'token_budget_fallback',
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
        shouldCallQwen: false,
      });
      if (!committedBudgetFallback.committed || !committedBudgetFallback.text.trim()) {
        anaTurnAuditOutcome = 'blocked';
        anaTurnAuditBlockedReason = 'token_budget_fallback_commit_blocked';
        return;
      }
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_token_budget_fallback';
        return;
      }
      const budgetFallbackSend = await sendAnaOutboundMessages({
        conversationId,
        toPhoneNumber,
        text: committedBudgetFallback.text,
        phase: 'token_budget_fallback',
        replyPipelineToken,
      });
      if (!budgetFallbackSend.success || budgetFallbackSend.metaMessageIds.length === 0) {
        anaTurnAuditOutcome = 'send_failed';
        anaTurnAuditBlockedReason = 'token_budget_fallback_send_failed';
        return;
      }
      const committedBudgetFallbackState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedBudgetFallback.parts,
        finalReplyText: committedBudgetFallback.text,
        handler: 'token_budget_fallback',
        currentTopic: anaTurnContextResolved?.currentTopic ?? null,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
      });
      flowStateParsed = committedBudgetFallbackState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
      anaTurnAuditOutcome = 'sent';
      anaTurnAuditBlockedReason = null;
      anaTurnAuditLlmStatus = 'skipped';
      anaTurnAuditModel = 'token_budget_fallback';
      anaTurnAuditRequestType = 'ana_token_budget_fallback';
      anaTurnAuditGuardsApplied.outboundReason = 'token_budget_blocked';
      anaTurnAuditGuardsApplied.tokenBudget = {
        estimatedInputTokens: tokenBudgetDecision.estimatedInputTokens,
        threshold: anaBudgetConfig.blockInputTokens,
        action: 'fallback_no_llm',
      };
      anaTurnDiagnostics.fallbackUsed = true;
      anaTurnDiagnostics.fallbackReason = 'token_budget_blocked';
      anaTurnDiagnostics.finalResponse.replySource = 'token_budget_fallback';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      markAnaTurnStage(anaTurnDiagnostics, 'llm_generation', 'skipped', {
        reason: 'token_budget_blocked',
        estimatedInputTokens: tokenBudgetDecision.estimatedInputTokens,
      });
      markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
        replySource: 'token_budget_fallback',
        outboundStatus: anaTurnAuditOutcome,
      });
      return;
    }

    anaEngineTrace('prompt_build_done', {
      conversationId,
      systemPromptLen: systemPrompt.length,
      messagesCount: messages.length,
    });
    console.log('[ANA_QWEN_REQUEST_CONTEXT]', {
      conversationId,
      model,
      baseUrlMasked: maskBaseUrl(aiSettings.openaiBaseUrl),
      responseFormatJson: responseFormatJsonForTurn,
      historyCount: history.length,
      messagesCount: messages.length,
      systemPromptLen: systemPrompt.length,
      lastUserText: trimmed.slice(0, 400),
      lastAssistantText: (lastAssistantPlain || '').slice(0, 400),
      knownTopics,
      enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
      chunksCount: ragChunksFound,
      contextChars: promptKnowledgeText.length,
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
      maxTokens: anaBudgetConfig.maxOutputTokens,
      responseFormatJson: responseFormatJsonForTurn,
      costTracking: aiSettings.costTrackingEnabled ? {
        ...baseAnaCostTracking,
        purpose: 'ana_main_reply',
        metadata: {
            responseFormatJson: responseFormatJsonForTurn,
            usedJsonMode: responseFormatJsonForTurn,
            attempt: 1,
            strategy: conversationalQwenMode ? 'conversational_text' : 'primary_json',
            estimatedInputTokens: tokenBudgetDecision.estimatedInputTokens,
            tokenBudgetLevel: tokenBudgetDecision.level,
            ragChunks: ragChunksFound,
            recentMessagesCount: history.length,
            fallbackReason: null,
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
        estimatedInputTokens: tokenBudgetDecision.estimatedInputTokens,
        actualInputTokens: result.usage?.inputTokens ?? null,
        actualOutputTokens: result.usage?.outputTokens ?? null,
        actualTotalTokens: result.usage?.totalTokens ?? null,
        ragChunks: ragChunksFound,
        recentMessagesCount: history.length,
        usedJsonMode: responseFormatJsonForTurn,
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
    console.log('[ANA_QWEN_RAW_RESPONSE]', {
      conversationId,
      rawLen: rawContent.length,
      rawPreview: ANA_DEBUG_QWEN_RAW ? rawContent.slice(0, 1200) : rawContent.slice(0, 280),
      finishReason: null,
      usage: result.usage ?? null,
    });
    const parseAttempted = result.success && rawTrimmed.length > 0 && !conversationalQwenMode;
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
    let recoveredTextUsed = false;
    let structured: AnaStructuredReply | null = parseAttempted
      ? parseAnaJson(rawContent, { conversationId, messageId: inboundMetaMessageId })
      : null;
    console.log('[ANA_QWEN_PARSE_RESULT]', {
      conversationId,
      parseOk: structured != null,
      expectedJson: responseFormatJsonForTurn,
      hasStructuredReply: Boolean(structured?.reply?.trim()),
      parseError:
        !result.success ? result.error ?? 'llm_failed' : (!parseAttempted ? null : (structured ? null : 'parse_rejected_or_null')),
      recoveredTextUsed,
    });
    if (conversationalQwenMode && result.success && rawTrimmed.length > 0) {
      const rawNatural = rawTrimmed;
      const blockedUnsupportedPromise =
        hasConversationalUnsupportedPromise(rawNatural) && !authorizedLocationLink && !knowledgeLocationLink;
      const blockedBrokenReply = isBrokenEnumeratedReply(rawNatural);
      const forbiddenByGuardrails =
        rawNatural === '{}' ||
        hasAnaInternalInstructionLeak(rawNatural) ||
        /\bapartamento\b/i.test(rawNatural) ||
        hasUnauthorizedPriceClaimInConversationalReply(rawNatural) ||
        textHasMaterialDeliveryClaim(rawNatural) ||
        blockedUnsupportedPromise ||
        blockedBrokenReply;
      if (!forbiddenByGuardrails) {
        const sanitizedVisit = stripInappropriateVisitOffer(rawNatural);
        const naturalReply = sanitizedVisit.text.trim();
        if (naturalReply.length > 0 && naturalReply !== '{}') {
          console.log('[ANA_QWEN_GUARDRAIL_DECISION]', {
            conversationId,
            accepted: true,
            rejectedReason: null,
            guardName: 'conversational_raw_guard',
            originalRawPreview: rawNatural.slice(0, 300),
            finalReplyPreview: naturalReply.slice(0, 300),
          });
          structured = buildRecoveredReplyStructured(naturalReply, effectiveConv.classification);
          recoveredTextUsed = true;
          console.log('[ANA_CONVERSATIONAL_QWEN_SUCCESS]', {
            conversationId,
            lastAxis: currentAxisForRepetition,
            replyLen: naturalReply.length,
          });
        }
      }
      if (forbiddenByGuardrails) {
        console.log('[ANA_QWEN_GUARDRAIL_DECISION]', {
          conversationId,
          accepted: false,
          rejectedReason: 'conversational_raw_guard_forbidden_content',
          guardName: 'conversational_raw_guard',
          originalRawPreview: rawNatural.slice(0, 300),
          finalReplyPreview: null,
        });
        console.log('[ANA_QWEN_RESPONSE_REPLACED]', {
          conversationId,
          reason: 'conversational_raw_guard_forbidden_content',
          rawPreview: rawNatural.slice(0, 300),
          replacementPreview: globalNoEnterpriseMode
            ? null
            : buildConversationalCanonicalFallback(currentAxisForRepetition).slice(0, 300),
        });
      }
      if (!structured && blockedUnsupportedPromise) {
        console.log('[ANA_CONVERSATIONAL_UNSUPPORTED_PROMISE_BLOCKED]', {
          conversationId,
          lastAxis: currentAxisForRepetition,
        });
      }
      if (!structured && blockedBrokenReply) {
        console.log('[ANA_CONVERSATIONAL_BROKEN_REPLY_BLOCKED]', {
          conversationId,
          lastAxis: currentAxisForRepetition,
        });
      }
      if (!structured) {
        console.log('[ANA_CONVERSATIONAL_QWEN_FAILED]', {
          conversationId,
          lastAxis: currentAxisForRepetition,
          rawLen: rawTrimmed.length,
        });
      }
    }
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
      strategy: conversationalQwenMode ? 'conversational_text' : 'primary_json',
      result,
      parsed: structured != null,
      failureReason: structured != null ? null : computeAnaTechnicalFallbackTraceReason(result, parseAttempted),
      model,
    });
    const sameContextRetryAllowed =
      tokenBudgetDecision.estimatedInputTokens <= anaBudgetConfig.disableSameContextRetryAbove &&
      commercialNoLlmIntent == null;
    if (!structured && !conversationalQwenMode && sameContextRetryAllowed) {
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
        maxTokens: anaBudgetConfig.maxOutputTokens,
        responseFormatJson: true,
        costTracking: aiSettings.costTrackingEnabled ? {
          ...baseAnaCostTracking,
          purpose: 'ana_structured_retry',
          requestType: 'ana_structured_retry',
          metadata: {
            responseFormatJson: true,
            usedJsonMode: true,
            attempt: 2,
            strategy: 'same_context_retry',
            estimatedInputTokens: tokenBudgetDecision.estimatedInputTokens,
            ragChunks: ragChunksFound,
            recentMessagesCount: history.length,
            fallbackReason: null,
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
    } else if (!structured && !conversationalQwenMode) {
      console.log('[ANA_SAME_CONTEXT_RETRY_SKIPPED]', {
        conversationId,
        estimatedInputTokens: tokenBudgetDecision.estimatedInputTokens,
        disableAbove: anaBudgetConfig.disableSameContextRetryAbove,
        commercialNoLlmIntent,
        reason:
          commercialNoLlmIntent != null
            ? 'commercial_specific_intent'
            : 'estimated_input_tokens_above_retry_limit',
      });
      anaTurnAuditGuardsApplied.sameContextRetry = {
        skipped: true,
        estimatedInputTokens: tokenBudgetDecision.estimatedInputTokens,
        disableAbove: anaBudgetConfig.disableSameContextRetryAbove,
        commercialNoLlmIntent,
      };
    }
    if (!structured && !isLocalQwenRuntime && !conversationalQwenMode) {
      const recoveryRaw =
        (retryResult?.success && (retryResult.content || '').trim()
          ? (retryResult.content || '')
          : rawContent) || '';
      const recoveredReply = extractRecoveredReplyFromMalformedJsonLikeRaw(recoveryRaw);
      if (recoveredReply) {
        const quality = validateRecoveredReplyQuality(recoveredReply);
        if (quality.ok) {
          structured = buildRecoveredReplyStructured(recoveredReply, effectiveConv.classification);
          recoveredTextUsed = true;
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
    if (!structured && isLocalQwenRuntime && !conversationalQwenMode) {
      const recoveryRawText =
        (retryResult?.success && (retryResult.content || '').trim()
          ? (retryResult.content || '')
          : rawContent).trim();
      const canAttemptQwenTextRecovery =
        recoveryRawText.length > 0 &&
        ragChunksFound > 0 &&
        enterpriseEvidence.hasUsableKnowledgeChunks === true;
      if (canAttemptQwenTextRecovery) {
        const sanitizedRecoveryReply = sanitizeQwenRecoveryText(recoveryRawText);
        const quality = validateRecoveredReplyQuality(sanitizedRecoveryReply);
        if (quality.ok) {
          const classificationHint = (effectiveConv.classification || '').trim() || 'Qualificado';
          structured = buildRecoveredReplyStructured(sanitizedRecoveryReply, classificationHint);
          recoveredTextUsed = true;
          console.log('[ANA_QWEN_TEXT_RECOVERY]', {
            conversationId,
            model,
            baseUrl: aiSettings.openaiBaseUrl,
            source: retryResult?.success ? 'retry_raw' : 'first_raw',
            replyLen: sanitizedRecoveryReply.length,
          });
        }
      }
    }
    if (!structured && !isLocalQwenRuntime && !conversationalQwenMode) {
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
        recoveredTextUsed = true;
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
    if (!structured && !isLocalQwenRuntime && !conversationalQwenMode) {
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
          maxTokens: anaBudgetConfig.maxOutputTokens,
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
    if (!structured && isLocalQwenRuntime && !conversationalQwenMode && !isKnowledgeGapTurn) {
      const llmFirstCommercialParseFailure = isLlmFirstCommercialTurn({
        isEvora: isEvoraEnterpriseName(ent?.name ?? null),
        userMessage: trimmed,
        requestedAxis: currentAxisForRepetition ?? requestedAxisForPolicy,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
      });
      if (llmFirstCommercialParseFailure) {
        console.log('[ANA_COMMERCIAL_FALLBACK_BLOCKED_BY_LLM_FIRST]', {
          conversationId,
          fallbackType: 'local_qwen_json_repair_failed',
          requestedAxis: currentAxisForRepetition ?? requestedAxisForPolicy,
          requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        });
        console.log('[ANA_LLM_FIRST_TECHNICAL_FALLBACK_USED]', {
          conversationId,
          reason: 'local_qwen_json_repair_failed',
          requestedAxis: currentAxisForRepetition ?? requestedAxisForPolicy,
          requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        });
      }
      const canonicalSafeReply = llmFirstCommercialParseFailure
        ? ANA_LLM_FIRST_TECHNICAL_FALLBACK_REPLY
        : buildCanonicalSafeReplyForMissingRag({
            axis: currentAxisForRepetition,
            isEvora: isEvoraEnterpriseName(ent?.name ?? null),
          });
      structured = buildRecoveredReplyStructured(canonicalSafeReply, effectiveConv.classification);
      recoveredTextUsed = true;
      console.log('[ANA_RAG_CONTEXT_MISSING_BLOCKED_FREEFORM]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
        userMessagePreview: userMessageForReasoning.slice(0, 260),
        chunksCount: ragChunksFound,
        chunkIds: Array.from(ragChunkIds).slice(0, 30),
        contextChars: promptKnowledgeText.length,
        reason: 'local_qwen_json_repair_failed',
      });
    }
    if (!structured && conversationalQwenMode && !isKnowledgeGapTurn && !globalNoEnterpriseMode) {
      const conversationalFallback = buildConversationalCanonicalFallback(currentAxisForRepetition);
      console.log('[ANA_QWEN_RESPONSE_REPLACED]', {
        conversationId,
        reason: 'structured_missing_after_conversational_attempt',
        rawPreview: rawTrimmed.slice(0, 300),
        replacementPreview: conversationalFallback.slice(0, 300),
      });
      structured = buildRecoveredReplyStructured(conversationalFallback, effectiveConv.classification);
      recoveredTextUsed = true;
      console.log('[ANA_CONVERSATIONAL_CANONICAL_FALLBACK]', {
        conversationId,
        lastAxis: currentAxisForRepetition,
        fallbackLen: conversationalFallback.length,
      });
    }
    if (!structured && isKnowledgeGapTurn) {
      console.error('[ANA_KNOWLEDGE_GAP_TEXT_MODE_EMPTY_OR_FAILED]', {
        conversationId,
        reason: knowledgeGapMeta.reason,
        matchedIntent: knowledgeGapMeta.matchedIntent ?? null,
        llmSuccess: result.success,
        rawLen: rawTrimmed.length,
      });
      const safeKnowledgeGapFallback = buildLeadQualificationBridgeReply({
        matchedIntent: knowledgeGapMeta.matchedIntent ?? null,
        locationOverview: buildEvoraLocationOverview({
          addressComplete: authorizedLocationAddress.addressComplete,
          addressNumber: authorizedLocationAddress.addressNumber,
        }),
        locationLink: authorizedLocationLink ?? knowledgeLocationLink,
        addressComplete: authorizedLocationAddress.addressComplete,
        addressNumber: authorizedLocationAddress.addressNumber,
      });
      structured = buildRecoveredReplyStructured(safeKnowledgeGapFallback, effectiveConv.classification);
      recoveredTextUsed = true;
      console.log('[ANA_KNOWLEDGE_GAP_SAFE_OFFER_FALLBACK_USED]', {
        conversationId,
        reason: 'structured_missing_or_llm_failure',
        replyLen: safeKnowledgeGapFallback.length,
      });
    }
    console.log('[ANA_QWEN_PARSE_RESULT]', {
      conversationId,
      parseOk: structured != null,
      expectedJson: responseFormatJsonForTurn,
      hasStructuredReply: Boolean(structured?.reply?.trim()),
      parseError: structured ? null : (result.success ? 'structured_missing_after_recovery' : (result.error ?? 'llm_failed')),
      recoveredTextUsed,
    });
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
          const retryReason = mapRetryReason(retryErrorPayload);
          let deterministicRetryReply: string | null = null;
          let schedulingStateMerged = false;
          const llmFirstCommercialFailure = isLlmFirstCommercialTurn({
            isEvora: isEvoraEnterpriseName(ent?.name ?? null),
            userMessage: trimmed,
            requestedAxis: currentAxisForRepetition ?? requestedAxisForPolicy,
            requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
          });

          const retrySchedulingGuard = applyAnaVisitSchedulingGuard({
            conversationId,
            enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
            isEvora: isEvoraEnterpriseName(ent?.name ?? null),
            userMessage: trimmed,
            customerName: trustedCustomerName || effectiveConv.customer_name || null,
            flowState: flowStateParsed,
            now: lastUserMessageAt,
            currentAnswer: '',
          });
          if (retrySchedulingGuard.handled && retrySchedulingGuard.finalAnswer.trim().length > 0) {
            deterministicRetryReply = retrySchedulingGuard.finalAnswer;
            flowStateParsed = retrySchedulingGuard.nextState;
            await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
            schedulingStateMerged = true;
          } else if (llmFirstCommercialFailure) {
            deterministicRetryReply = ANA_LLM_FIRST_TECHNICAL_FALLBACK_REPLY;
            console.log('[ANA_COMMERCIAL_FALLBACK_BLOCKED_BY_LLM_FIRST]', {
              conversationId,
              fallbackType: 'retryable_failure_safe_reply',
              requestedAxis: currentAxisForRepetition ?? requestedAxisForPolicy,
              requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
            });
            console.log('[ANA_LLM_FIRST_TECHNICAL_FALLBACK_USED]', {
              conversationId,
              reason: retryReason,
              requestedAxis: currentAxisForRepetition ?? requestedAxisForPolicy,
              requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
            });
          } else if (isGratitudeOnlyMessage(trimmed)) {
            deterministicRetryReply =
              'De nada! Se precisar de mais alguma informação sobre o Évora, estou por aqui.';
          } else if (
            isFirstAnaReply &&
            (isGenericFirstGreetingMessage(trimmed) || isFirstContactGeneralInterestMessage(trimmed))
          ) {
            deterministicRetryReply = buildFirstGreetingSafeFallback(trimmed);
          } else if (isGenericInterestFollowup(trimmed)) {
            deterministicRetryReply =
              'Claro. O Évora tem alguns pontos bem importantes: localização em Atibaia, lotes a partir de 360 m², lazer completo, segurança 24 horas e obras avançadas.\n\nVocê quer começar por valores, localização ou formas de pagamento?';
          } else {
            deterministicRetryReply =
              'Posso te ajudar com valores, localização, formas de pagamento, andamento da obra e previsão de entrega. Qual desses pontos você quer ver primeiro?';
          }

          if (isPipelineStale(conversationId, replyPipelineToken)) {
            anaTurnAuditOutcome = 'silent';
            anaTurnAuditBlockedReason = 'pipeline_stale_before_retryable_deterministic_reply';
            anaTurnAuditGuardsApplied.retryScheduled = {
              reason: retryReason,
              retryAfterMs,
              triggerMessageId: lastUserRowForLog?.id ?? null,
              deterministicReplyPlanned: true,
              deterministicReplySent: false,
              schedulingStateMerged,
            };
            return;
          }

          const retrySafeSend = await sendTextMessage({
            conversationId,
            to: toPhoneNumber,
            text: deterministicRetryReply ?? 'Claro. Posso te ajudar com informações do Évora por aqui.',
            phase: 'ana_retryable_failure_safe_reply',
          });
          if (retrySafeSend.success && retrySafeSend.metaMessageId) {
            await insertMessage(conversationId, 'assistant', deterministicRetryReply, retrySafeSend.metaMessageId);
            anaTurnAuditOutcome = 'sent';
            anaTurnAuditBlockedReason = null;
            anaTurnAuditGuardsApplied.retryScheduled = {
              reason: retryReason,
              retryAfterMs,
              triggerMessageId: lastUserRowForLog?.id ?? null,
              deterministicReplyPlanned: true,
              deterministicReplySent: true,
              schedulingStateMerged,
              fallbackPhase: 'ana_retryable_failure_safe_reply',
            };
            anaTurnDiagnostics.finalResponse.replySource = 'deterministic_fallback';
            anaTurnDiagnostics.finalResponse.handoffUsed = false;
            anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
            markAnaTurnStage(anaTurnDiagnostics, 'final_response', 'passed', {
              replySource: 'deterministic_fallback',
              outboundStatus: anaTurnAuditOutcome,
              blockedReason: 'llm_retryable_generation_failure',
              fallbackReason: traceReason,
              usedFallback: true,
            });
            console.log('[ANA_RETRYABLE_FAILURE_SAFE_REPLY_SENT]', {
              conversationId,
              triggerMessageId: lastUserRowForLog?.id ?? null,
              attemptCount: anaTurnDiagnostics.llm.attempts.length,
              reason: retryReason,
              retryAfterMs,
              model,
              error: sanitizeRetryErrorMessage(retryErrorPayload),
              schedulingStateMerged,
            });
            return;
          }

          await scheduleAnaRetry({
            conversationId,
            triggerMessageId: lastUserRowForLog?.id ?? null,
            error: retryErrorPayload,
          });
          anaTurnAuditOutcome = 'silent';
          anaTurnAuditBlockedReason = 'llm_retry_scheduled';
          anaTurnAuditGuardsApplied.retryScheduled = {
            reason: retryReason,
            retryAfterMs,
            triggerMessageId: lastUserRowForLog?.id ?? null,
            deterministicReplyPlanned: true,
            deterministicReplySent: false,
            schedulingStateMerged,
          };
          console.log('[ANA_RETRY] llm_retryable_error', {
            conversationId,
            triggerMessageId: lastUserRowForLog?.id ?? null,
            attemptCount: anaTurnDiagnostics.llm.attempts.length,
            reason: retryReason,
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
        if (await sendGlobalNoEnterpriseFinalSafeReply(anaTurnAuditBlockedReason)) return;
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
    const shouldAttemptDocSend = !globalNoEnterpriseMode && anaDecision.shouldSendMaterial;

    console.log('[ANA_DOC_GATE]', {
      conversationId,
      explicit: userMaterialAsk,
      bareGreeting,
      shouldAttemptDocSend,
      globalNoEnterpriseMode,
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
      if (userMaterialAsk && !globalNoEnterpriseMode) {
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
        reason: userMaterialAsk
          ? globalNoEnterpriseMode
            ? 'global_no_enterprise_material_ask_llm_discovery'
            : 'policy_blocked_material_send'
          : 'no_explicit_request',
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
    let structuredAppointmentRegistration: Awaited<ReturnType<typeof registerAnaAppointmentIfConfirmed>> | null = null;
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
        structuredAppointmentRegistration = apptRes;
        if (apptRes.persisted && apptRes.canonicalLine) {
          replyBody = appendCanonicalToReply(structured.reply, apptRes.canonicalLine);
        }
        if (apptRes.persisted) {
          await cancelAnaVisitFollowupForConversation({
            conversationId,
            reason: 'visit_scheduled',
          });
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

    if (shouldAttemptDocSend && canClaimMaterialWasSent && mediaOutcome?.ok === true) {
      if (isPipelineStale(conversationId, replyPipelineToken)) {
        anaTurnAuditOutcome = 'silent';
        anaTurnAuditBlockedReason = 'pipeline_stale_before_media_post_send_followup';
        return;
      }
      const postMediaFollowup =
        mediaOutcome.messageKind === 'image'
          ? await sendAnaImageMaterialPostSendModelReply({
              enterprise: ent,
              requestedTheme: extractAnaImageFilenameTopic(trimmed),
              sentImages: [mediaOutcome.fileName].filter(Boolean),
              lastUserMessage: trimmed,
              commercialContext: buildAnaImageMaterialCommercialContext({
                enterpriseName: ent?.name ?? null,
                variablesMap: vars,
                knowledgeText: promptKnowledgeText,
                fileInventory,
              }),
              phase: 'ana_doc_image_material_model_followup',
            })
          : await (async () => {
              const rowsAfterMediaSend = await getMessagesByConversationId(conversationId);
              const recentAssistantReplies = rowsAfterMediaSend
                .filter((msg) => msg.role === 'assistant')
                .map((msg) => String(msg.content ?? '').trim())
                .filter((msg) => msg.length > 0)
                .slice(-8);
              return maybeSendAnaMediaPostSendFollowup({
                conversationId,
                toPhoneNumber,
                flowState: flowStateParsed,
                mediaKind: mediaOutcome.messageKind,
                mediaCategory: mediaOutcome.sentCategory,
                mediaFileName: mediaOutcome.fileName,
                recentAssistantReplies,
                replyPipelineToken,
              });
            })();
      if (postMediaFollowup.sent && postMediaFollowup.text) {
        anaEngineTrace('final_send_success', {
          conversationId,
          phase: 'doc_post_send_followup',
          replyLen: postMediaFollowup.text.length,
        });
        const convAfterFollowup = await getConversationById(conversationId);
        const nameConfirmedForCount = (convAfterFollowup?.customer_name || '').trim();
        const deltaFollowup =
          nameConfirmedForCount.length >= 2
            ? countCustomerNameMentionsInText(postMediaFollowup.text, nameConfirmedForCount)
            : 0;
        if (deltaFollowup > 0) await incrementAnaCustomerNameMentions(conversationId, deltaFollowup);
        if (!nameConfirmedForCount && replyExplicitlyAsksCustomerName(postMediaFollowup.text)) {
          await markAnaAskedForCustomerName(conversationId);
        }
        const prevForFlowAck = parseCommercialFlowState(convAfterFollowup?.commercial_flow_state) ?? flowStateParsed;
        const nextFlowAck = computeNextCommercialFlowState(prevForFlowAck, postMediaFollowup.text, {
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
        console.log('[ANA_PIPELINE] engine_send_success', {
          conversationId,
          phase: 'ana_doc_post_send_followup',
          inboundMetaMessageId,
          replyLen: postMediaFollowup.text.length,
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
              lastAssistantMessage: lastAssistantPlain,
              conversationMode: mode,
              isFirstAnaReply,
              enterpriseName: ent?.name ?? null,
              isKnowledgeGapTurn,
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
      console.log('[ANA_UNSUPPORTED_PROMISE_BLOCKED]', {
        conversationId,
        intent: policyDetectedIntent ?? null,
        reason: 'guard_blocked_promise_without_send',
      });
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
            lastAssistantMessage: lastAssistantPlain,
            conversationMode: mode,
            isFirstAnaReply,
            enterpriseName: ent?.name ?? null,
            isKnowledgeGapTurn,
          });
    if (isKnowledgeGapTurn) {
      console.log('[ANA_KNOWLEDGE_GAP_SKIPPED_LEGACY_CTA]', {
        conversationId,
        skipOpenQuestion: true,
        skipLegacyBrokerText: true,
      });
    }
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
        lastAssistantMessage: lastAssistantPlain,
        conversationMode: mode,
        isFirstAnaReply,
        enterpriseName: ent?.name ?? null,
        isKnowledgeGapTurn,
      });
    }
    const preserveListFormatting =
      anaDecision.responseMode === 'structured' ||
      (operationalResolverFired && /\n\s*(?:-|\*)\s+/.test(finalTextGuard));
    const preserveWhatsappParagraphs =
      finalTextGuard.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length > 1;
    const hardLimitedReply = shouldPreserveFullLazerList
      ? finalTextGuard.slice(0, 4000).trim()
      : applyAnaHardLengthGuard({
          text: finalTextGuard,
          enterpriseName: ent?.name ?? null,
          maxChars: preserveListFormatting || preserveWhatsappParagraphs ? 560 : ANA_OUTBOUND_MAX_CHARS,
          preserveLineBreaks: preserveListFormatting || preserveWhatsappParagraphs,
        });
    let finalOutboundEval = evaluateAnaOutboundText({
      reply: hardLimitedReply,
      technicalFallbackText: ANA_TECHNICAL_FALLBACK_NEUTRAL,
      conversationType: effectiveConv.conversation_type ?? 'CLIENT',
      enterpriseName: ent?.name ?? null,
    });
    anaTurnAuditGuardsApplied.outboundReason = finalOutboundEval.reason;
    const appointmentFinalGuardContext =
      !visitFlowSuppressedByConfirmationContext &&
      (directVisitSchedulingIntent ||
        appointmentPreflight.active ||
        anaDecision.resolvedIntent === 'visita_agendamento' ||
        anaDecision.resolvedIntent === 'agendar' ||
        anaDecision.primaryAxis === 'visita_agendamento' ||
        requestedAxisForPolicy === 'visita_agendamento');
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
        customerName: trustedCustomerName || effectiveConv.customer_name || null,
        customerPhone: (effectiveConv.contact_phone || effectiveConv.external_contact_id || '').replace(/\D/g, ''),
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
          extractedPeriod: guardDecision.extractedPeriod,
          extractedTime: guardDecision.extractedTime,
          missingSlot: guardDecision.missingSlot,
        };
        anaTurnDiagnostics.scheduling = {
          enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
          enterpriseSource: enterpriseSourceForAudit,
          resolvedIntent: anaDecision.resolvedIntent,
          primaryAxis: anaDecision.primaryAxis,
          pendingVisitScheduling: guardDecision.pendingVisitScheduling,
          extractedDateLabel: guardDecision.extractedDateLabel,
          extractedPeriod: guardDecision.extractedPeriod,
          extractedTime: guardDecision.extractedTime,
          capturedSlots: guardDecision.capturedSlots,
          missingSlot: guardDecision.missingSlot,
          deterministicSchedulingHandled: true,
          schedulingHandledReason: `final_guard_${guardDecision.reason}`,
        };
        for (const slot of guardDecision.capturedSlots) {
          console.log('[ANA_VISIT_SLOT_CAPTURED]', {
            conversationId,
            slot,
            reason: `final_guard_${guardDecision.reason}`,
          });
        }
        if (guardDecision.missingSlot) {
          console.log('[ANA_VISIT_MISSING_SLOT_REQUESTED]', {
            conversationId,
            missingSlot: guardDecision.missingSlot,
            reason: `final_guard_${guardDecision.reason}`,
          });
        }
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
        if (
          isFirstAnaReply &&
          (finalEmptyFallbackGuard.reason === 'first_reply_missing_greeting' ||
            isFirstContactEnterpriseInterestMessage(trimmed))
        ) {
          const safeFallback = buildEvoraFirstReplySafeFallback();
          console.log('[ANA_FIRST_REPLY_SAFE_FALLBACK_SENT]', {
            conversationId,
            reason: 'first_reply_safe_fallback',
            previousBlockedReason: finalEmptyFallbackGuard.reason,
          });
          const safeSend = await sendAnaOutboundMessages({
            conversationId,
            toPhoneNumber,
            text: safeFallback,
            phase: 'ana_first_reply_safe_fallback',
            replyPipelineToken,
          });
          if (safeSend.success && safeSend.metaMessageIds.length > 0) {
            anaTurnAuditOutcome = 'sent';
            anaTurnAuditBlockedReason = null;
            anaTurnDiagnostics.finalResponse.replySource = 'deterministic_fallback';
            anaTurnDiagnostics.finalResponse.handoffUsed = false;
            anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
            return;
          }
        }
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
          internalErrorOnly: false,
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
            lastAssistantMessage: lastAssistantPlain,
            conversationMode: mode,
            isFirstAnaReply,
            enterpriseName: ent?.name ?? null,
            isKnowledgeGapTurn,
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
    
    const evoraExplicitRegionDeepDiveThisTurn =
      isEvoraEnterpriseName(ent?.name ?? null) &&
      /\b(regiao|regi\u00e3o|bairro|pedreira|rio abaixo|atibaia|entorno|cidade)\b/i.test(normText(trimmed)) &&
      /\b(fala|fale|conte|conta|explica|explique|mais|como e|como eh|detalhe|detalhes)\b/i.test(normText(trimmed));

console.log('[ANA_QWEN_GUARDRAIL_DECISION]', {
      conversationId,
      accepted: true,
      rejectedReason: null,
      guardName: 'final_outbound_eval',
      originalRawPreview: (result.content || '').slice(0, 260),
      finalReplyPreview: replyText.slice(0, 260),
    });
    anaTurnAuditGuardsApplied.outboundReason = finalOutboundEval.reason;
    if (isGenericInterestFollowup(trimmed) && !isRegionDeepDiveResolved && !evoraExplicitRegionDeepDiveThisTurn) {
      if (lastAxisForRepetition === 'lazer') {
        replyText = buildCanonicalLazerFullReply();
      } else if (lastAxisForRepetition === 'localizacao') {
        replyText = `Claro. ${buildEvoraRegionCanonicalReply()}`;
      } else if (lastAxisForRepetition === 'preco') {
        replyText =
          'Claro. O Évora tem lotes a partir de R$279.000,00, com metro quadrado a partir de R$775,00. O valor final depende da unidade e das condições escolhidas.';
      } else if (lastAxisForRepetition === 'financiamento') {
        replyText =
          'Claro.\n\nDe forma geral, o Évora trabalha com planos estendidos em até 120x para parcelas mais baixas, parcelamento sem juros em até 48x e financiamento direto com a construtora, com menos burocracia e mais facilidade.\n\nPara entrada, parcela exata ou simulação personalizada, o corretor consegue montar certinho conforme a unidade disponível.\n\nVocê quer que eu te encaminhe para uma simulação ou prefere entender melhor os tamanhos dos lotes primeiro?';
      } else {
        replyText = 'Claro. Você quer saber mais sobre localização, lazer, valores ou formas de pagamento?';
      }
      console.log('[ANA_CONTEXTUAL_FOLLOWUP_RESOLVED]', {
        conversationId,
        requestedFollowup: trimmed.slice(0, 120),
        lastAxis: lastAxisForRepetition,
      });
    } else if (isGenericInterestFollowup(trimmed) && (isRegionDeepDiveResolved || evoraExplicitRegionDeepDiveThisTurn)) {
      console.log('[ANA_LOCATION_CANONICAL_BLOCKED_BY_REGION_DEEP_DIVE]', {
        conversationId,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        blockedRule: 'generic_followup_location_canonical',
        userMessagePreview: trimmed.slice(0, 180),
      });
      console.log('[ANA_LOCATION_SHORT_CANONICAL_SKIPPED_FOR_REGION_DEEP_DIVE]', {
        conversationId,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        skippedRule: 'generic_followup_location_canonical',
        userMessagePreview: trimmed.slice(0, 180),
      });
    }
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
    if (conversationalQwenMode && lastAxisForRepetition === 'lazer') {
      const lazerListAlreadySent = recentAssistantReplies.some((msg) => /piscina adulto[\s\S]*campo society/i.test(msg));
      if (lazerListAlreadySent && isConversationalGenericFollowup(trimmed)) {
        replyText = buildNoAdditionalLazerReply();
      }
    }
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
      const preservePostPolicyParagraphs =
        postPolicyReply.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).length > 1;
      const limitedPostPolicyReply = preservePostPolicyLines || preservePostPolicyParagraphs
        ? postPolicyReply.slice(0, 4000).trim()
        : applyAnaHardLengthGuard({
            text: postPolicyReply,
            enterpriseName: ent?.name ?? null,
            maxChars: preservePostPolicyLines || preservePostPolicyParagraphs ? 560 : ANA_OUTBOUND_MAX_CHARS,
            preserveLineBreaks: preservePostPolicyLines || preservePostPolicyParagraphs,
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

    if (evoraExplicitRegionDeepDiveThisTurn) {
      const evoraRegionTextHasLocationSignal = (text: string): boolean =>
        /\b(regiao|regi\u00e3o|pedreira|rio abaixo|atibaia|dom pedro|natureza|gastronomia|bragantina|lucas nogueira|cidade|bairro|acesso|tranquila|verde)\b/i.test(
          normText(text || '')
        );

      const evoraReplyLooksLikeLeisureAxis = (text: string): boolean =>
        /^\s*(sobre\s+lazer|o\s+lazer|lazer\b)/i.test(normText(text || '')) ||
        /\b(piscina|playground|beach tennis|academia|campo society|quadra|salao de festas|sal\u00e3o de festas|coworking|fireplace)\b/i.test(
          normText(text || '')
        );

      const currentReplyWrongForRegion =
        evoraReplyLooksLikeLeisureAxis(replyText) ||
        !evoraRegionTextHasLocationSignal(replyText);

      if (currentReplyWrongForRegion) {
        const preservedRegionCandidate = [
          finalAxisGuardText,
          finalEvidenceGuard.text,
          finalTextGuard,
          replyBody,
          structured?.reply ?? '',
        ]
          .map((candidate) => String(candidate || '').trim())
          .find((candidate) =>
            candidate.length > 0 &&
            evoraRegionTextHasLocationSignal(candidate) &&
            !evoraReplyLooksLikeLeisureAxis(candidate)
          );

        if (preservedRegionCandidate) {
          replyText = preservedRegionCandidate;
        } else {
          replyText = buildEvoraRegionCanonicalReply();
        }

        console.log('[ANA_EVORA_REGION_DEEP_DIVE_FINAL_REPLY_PRESERVED]', {
          conversationId,
          requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
          commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition ?? requestedAxisForPolicy ?? null,
          userMessagePreview: trimmed.slice(0, 180),
          finalReplyPreview: replyText.slice(0, 240),
        });
      }

      if (!/\?\s*$/.test(replyText.trim())) {
        replyText = `${replyText.trim()}\n\nQuer que eu te explique também sobre segurança ou os tamanhos dos lotes?`;

        console.log('[ANA_EVORA_FINAL_QUESTION_APPENDED_ONLY]', {
          conversationId,
          requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
          commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition ?? requestedAxisForPolicy ?? null,
          mode: 'append_only_no_rewrite',
        });
      }
    }

    if (isEvoraEnterpriseName(ent?.name ?? null)) {
      const evoraUserNormForConversion = normText(trimmed);
      const evoraReplyNormForConversion = normText(replyText);

      const evoraHistoryForTopic = normText([...recentAssistantPlainTexts, replyText].join('\n'));

      const evoraTopicAnsweredForConversion = (topic: string): boolean => {
        if (topic === 'valores') {
          return /\b(279\.?000|r\$\s*279|775|metro quadrado|m2|m²|entrada|parcelamento|48x|120x|financiamento|pagamento)\b/.test(evoraHistoryForTopic);
        }

        if (topic === 'seguranca') {
          return /\b(seguranca|segurança|portaria|controle de acesso|24h|loteamento fechado)\b/.test(evoraHistoryForTopic);
        }

        if (topic === 'lazer') {
          return /\b(lazer|piscina|academia|playground|beach tennis|campo society|quadra|salao de festas|salão de festas|coworking|espaco zen|espaço zen|fireplace)\b/.test(evoraHistoryForTopic);
        }

        if (topic === 'localizacao') {
          return /\b(atibaia|pedreira|rio abaixo|dom pedro|estrada dos pires|endereco|endereço|maps|localizacao|localização)\b/.test(evoraHistoryForTopic);
        }

        if (topic === 'lotes') {
          return /\b(lotes|lote|360|725|metragem|m²|m2|400m|400 m)\b/.test(evoraHistoryForTopic);
        }

        return false;
      };

      const evoraPickConcreteNextQuestion = (): string => {
        const options = [
          { key: 'lotes', question: 'Quer que eu te explique melhor os tamanhos dos lotes ou prefere falar com o corretor sobre disponibilidade?' },
          { key: 'valores', question: 'Quer que eu te explique as formas de pagamento ou prefere que eu te encaminhe para o corretor?' },
          { key: 'localizacao', question: 'Quer que eu te explique melhor o acesso até o Évora ou prefere agendar uma visita?' },
          { key: 'seguranca', question: 'Quer que eu te explique a segurança com mais detalhes ou prefere conhecer isso em uma visita?' },
          { key: 'lazer', question: 'Quer que eu te fale dos espaços de lazer ou prefere agendar uma visita para conhecer de perto?' },
        ];

        const next = options.find((option) => !evoraTopicAnsweredForConversion(option.key));
        return next?.question ?? 'Posso te encaminhar para o corretor responsável ou te ajudar a agendar uma visita?';
      };

      const evoraReplaceOrAppendFinalQuestion = (text: string, question: string): string => {
        const clean = String(text || '').trim();

        if (!clean) return question;

        if (/\?\s*$/.test(clean)) {
          return clean.replace(/(?:\n\n)?[^.!?\n]*\?\s*$/s, `\n\n${question}`).trim();
        }

        return `${clean}\n\n${question}`;
      };

      const evoraStrongPurchaseIntent =
        /\b(quero comprar|ja quero comprar|já quero comprar|quero fechar|vou comprar|comprar esse lote|comprar um lote|como faz para comprar|como faco para comprar|como faço para comprar|como faz pra comprar|como faco pra comprar|como faço pra comprar)\b/.test(
          evoraUserNormForConversion
        );

      const evoraNextStepIntent =
        /\b(proximo passo|próximo passo|e agora|agora o que|qual o proximo|qual o próximo|o que eu faco agora|o que eu faço agora|gostei|curti|faz sentido|quero avancar|quero avançar|ja quero|já quero)\b/.test(
          evoraUserNormForConversion
        );

      const evoraDoubtIntent =
        /\b(tenho duvida|tenho dúvida|tenho duvidas|tenho dúvidas|estou com duvida|estou com dúvida|tenho uma pergunta|queria tirar uma duvida|queria tirar uma dúvida)\b/.test(
          evoraUserNormForConversion
        );

      const evoraRepeatsPurposeQuestion =
        /\b(morar,? investir|morar ou investir|morar, investir ou|propósito agora|proposito agora|qual dessas opcoes|qual dessas opções|tipo de espaço quer chamar de lar|tipo de espaco quer chamar de lar)\b/.test(
          evoraReplyNormForConversion
        );

      const evoraLifestyleClosingQuestion =
        /\b(voce ja imaginou|você já imaginou|e se esse|e se esse espaço|e se esse espaco|como seria seu dia|como esse ambiente|silencio e a luz natural|silêncio e a luz natural|muda seu ritmo|rotina da sua familia|rotina de sua familia|estilo de vida que busca|o que mais te chama atencao|o que mais te chama atenção)\b[^?]*\?\s*$/i.test(
          replyText
        );

      const evoraFinalQuestionMatch = replyText.match(/([^?\n]*\?)\s*$/);
      const evoraFinalQuestionNorm = normText(evoraFinalQuestionMatch?.[1] ?? '');

      const evoraFinalQuestionRepeatsAnsweredTopic =
        (evoraFinalQuestionNorm.includes('segur') && evoraTopicAnsweredForConversion('seguranca')) ||
        (evoraFinalQuestionNorm.includes('lazer') && evoraTopicAnsweredForConversion('lazer')) ||
        ((evoraFinalQuestionNorm.includes('localizacao') || evoraFinalQuestionNorm.includes('localização') || evoraFinalQuestionNorm.includes('acesso')) &&
          evoraTopicAnsweredForConversion('localizacao')) ||
        ((evoraFinalQuestionNorm.includes('valor') || evoraFinalQuestionNorm.includes('pagamento') || evoraFinalQuestionNorm.includes('parcelamento')) &&
          evoraTopicAnsweredForConversion('valores')) ||
        ((evoraFinalQuestionNorm.includes('lote') || evoraFinalQuestionNorm.includes('metragem') || evoraFinalQuestionNorm.includes('tamanho')) &&
          evoraTopicAnsweredForConversion('lotes'));

      if (/\b(120x\s+sem\s+juros|ate\s+120x\s+sem\s+juros|até\s+120x\s+sem\s+juros)\b/i.test(replyText)) {
        replyText = replyText
          .replace(/\bate\s+120x\s+sem\s+juros\b/gi, 'planos estendidos em até 120x com juros')
          .replace(/\baté\s+120x\s+sem\s+juros\b/gi, 'planos estendidos em até 120x com juros')
          .replace(/\b120x\s+sem\s+juros\b/gi, '120x com juros');

        console.log('[ANA_EVORA_PAYMENT_TERMS_OUTPUT_CORRECTED]', {
          conversationId,
          reason: '120x_sem_juros_not_allowed',
          userMessagePreview: trimmed.slice(0, 180),
          replyPreview: replyText.slice(0, 240),
        });
      }

      if (evoraStrongPurchaseIntent || evoraNextStepIntent) {
        replyText =
          'Perfeito. O próximo passo é falar com o corretor responsável para confirmar disponibilidade, unidade e condição atual, ou agendar uma visita para você conhecer o Évora de perto.\n\nVocê prefere que eu te encaminhe para o corretor ou quer agendar uma visita?';

        console.log('[ANA_EVORA_CONVERSION_NEXT_STEP_GUARD]', {
          conversationId,
          reason: evoraStrongPurchaseIntent ? 'strong_purchase_intent' : 'next_step_intent',
          userMessagePreview: trimmed.slice(0, 180),
        });
      } else if (evoraDoubtIntent) {
        replyText =
          'Claro. Pode me mandar sua dúvida por aqui. Se for algo de disponibilidade, unidade, simulação ou condição específica, o corretor responsável te passa tudo certinho.\n\nVocê quer me dizer sua dúvida agora ou prefere que eu te encaminhe para o corretor?';

        console.log('[ANA_EVORA_DOUBT_TO_BROKER_OR_VISIT_GUARD]', {
          conversationId,
          userMessagePreview: trimmed.slice(0, 180),
        });
      } else if (evoraRepeatsPurposeQuestion || evoraLifestyleClosingQuestion || evoraFinalQuestionRepeatsAnsweredTopic) {
        const nextQuestion = evoraPickConcreteNextQuestion();
        replyText = evoraReplaceOrAppendFinalQuestion(replyText, nextQuestion);

        console.log('[ANA_EVORA_CONCRETE_NEXT_TOPIC_GUARD]', {
          conversationId,
          repeatsPurposeQuestion: evoraRepeatsPurposeQuestion,
          lifestyleClosingQuestion: evoraLifestyleClosingQuestion,
          repeatsAnsweredTopic: evoraFinalQuestionRepeatsAnsweredTopic,
          nextQuestion,
          userMessagePreview: trimmed.slice(0, 180),
          replyPreview: replyText.slice(0, 240),
        });
      }
    }

    if (isEvoraEnterpriseName(ent?.name ?? null)) {
      const evoraShortChoiceUserNorm = normText(trimmed);
      const evoraLastAssistantChoiceNorm = normText(lastAssistantPlain ?? '');

      const evoraShortAmbiguousChoice =
        /^(quero|quero sim|sim|sim quero|pode|pode sim|claro|isso|isso sim|ok|pode ser)$/.test(
          evoraShortChoiceUserNorm
        );

      const evoraLastOfferedSecurityAndLocation =
        evoraShortAmbiguousChoice &&
        /\b(seguranca|segurança)\b/.test(evoraLastAssistantChoiceNorm) &&
        /\b(localizacao|localização|endereco|endereço|acesso)\b/.test(evoraLastAssistantChoiceNorm) &&
        /\bou\b/.test(evoraLastAssistantChoiceNorm);

      const evoraLastOfferedPaymentOrVisit =
        evoraShortAmbiguousChoice &&
        /\b(valor|valores|pagamento|formas de pagamento|parcelamento|entrada)\b/.test(evoraLastAssistantChoiceNorm) &&
        /\b(visita|agendar|agenda)\b/.test(evoraLastAssistantChoiceNorm) &&
        /\bou\b/.test(evoraLastAssistantChoiceNorm);

      const evoraLastOfferedLeisureSubtopics =
        evoraShortAmbiguousChoice &&
        /\b(familia|família|esporte|esportes|convivencia|convivência)\b/.test(evoraLastAssistantChoiceNorm) &&
        /\bou\b/.test(evoraLastAssistantChoiceNorm);

      if (evoraLastOfferedSecurityAndLocation) {
        replyText = 'Claro. Você prefere que eu te explique sobre segurança ou sobre localização?';

        console.log('[ANA_EVORA_SHORT_CHOICE_DISAMBIGUATION_GUARD]', {
          conversationId,
          reason: 'security_or_location_ambiguous_short_confirmation',
          userMessagePreview: trimmed.slice(0, 120),
          lastAssistantPreview: (lastAssistantPlain ?? '').slice(0, 220),
        });
      } else if (evoraLastOfferedPaymentOrVisit) {
        replyText = 'Claro. Você prefere que eu te explique as formas de pagamento ou quer agendar uma visita?';

        console.log('[ANA_EVORA_SHORT_CHOICE_DISAMBIGUATION_GUARD]', {
          conversationId,
          reason: 'payment_or_visit_ambiguous_short_confirmation',
          userMessagePreview: trimmed.slice(0, 120),
          lastAssistantPreview: (lastAssistantPlain ?? '').slice(0, 220),
        });
      } else if (evoraLastOfferedLeisureSubtopics) {
        replyText = 'Claro. Você prefere que eu fale dos espaços para família, esportes ou convivência?';

        console.log('[ANA_EVORA_SHORT_CHOICE_DISAMBIGUATION_GUARD]', {
          conversationId,
          reason: 'leisure_subtopic_ambiguous_short_confirmation',
          userMessagePreview: trimmed.slice(0, 120),
          lastAssistantPreview: (lastAssistantPlain ?? '').slice(0, 220),
        });
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
      console.log('[ANA_BAD_GENERIC_FALLBACK_USED]', {
        conversationId,
        reason: 'technical_fallback_phrase_detected',
        replyPreview: replyText.slice(0, 260),
      });
      if (isMultiTopicCommercialMessage(trimmed)) {
        const replacement = buildSafeCommercialPartialReply({
          userMessage: trimmed,
          enterpriseName: ent?.name ?? null,
          enterpriseCity: ent?.city ?? null,
        });
        console.log('[ANA_QWEN_RESPONSE_REPLACED]', {
          conversationId,
          reason: 'technical_fallback_phrase_guard_multi_topic',
          rawPreview: replyText.slice(0, 260),
          replacementPreview: replacement.slice(0, 260),
        });
        console.log('[ANA_QWEN_GUARDRAIL_DECISION]', {
          conversationId,
          accepted: false,
          rejectedReason: 'technical_fallback_phrase_guard',
          guardName: 'technical_fallback_phrase_guard',
          originalRawPreview: replyText.slice(0, 260),
          finalReplyPreview: replacement.slice(0, 260),
        });
        replyText = replacement;
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
      console.log('[ANA_QWEN_RESPONSE_REPLACED]', {
        conversationId,
        reason: 'technical_fallback_phrase_guard_blocked',
        rawPreview: (result.content || '').slice(0, 260),
        replacementPreview: replyText.slice(0, 260),
      });
      console.log('[ANA_QWEN_GUARDRAIL_DECISION]', {
        conversationId,
        accepted: false,
        rejectedReason: 'technical_fallback_phrase_guard',
        guardName: 'technical_fallback_phrase_guard',
        originalRawPreview: (result.content || '').slice(0, 260),
        finalReplyPreview: replyText.slice(0, 260),
      });
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
      pendingVisitDay: flowStateParsed.pendingVisitDay ?? null,
      pendingVisitDate: flowStateParsed.pendingVisitDate ?? null,
      pendingVisitTime: flowStateParsed.pendingVisitTime ?? null,
      pendingVisitPeriod: flowStateParsed.pendingVisitPeriod ?? null,
      pendingVisitInvalidTime: flowStateParsed.pendingVisitInvalidTime ?? null,
      pendingVisitMissingSlot: flowStateParsed.pendingVisitMissingSlot ?? null,
      pendingVisitCustomerName: flowStateParsed.pendingVisitCustomerName ?? null,
      pendingVisitConfirmationAsked: flowStateParsed.pendingVisitConfirmationAsked ?? false,
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
      if (extractedDate) {
        console.log('[ANA_VISIT_SLOT_CAPTURED]', {
          conversationId,
          slot: 'dia',
          reason: evoraVisitSchedulingGuardResult.reason,
        });
      }
      if (extractedTime) {
        console.log('[ANA_VISIT_SLOT_CAPTURED]', {
          conversationId,
          slot: 'horario',
          reason: evoraVisitSchedulingGuardResult.reason,
        });
      }
      if (evoraVisitSchedulingGuardResult.nextMissingField) {
        console.log('[ANA_VISIT_MISSING_SLOT_REQUESTED]', {
          conversationId,
          missingSlot: evoraVisitSchedulingGuardResult.nextMissingField,
          reason: evoraVisitSchedulingGuardResult.reason,
        });
      }
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
    if (isEvoraEnterpriseName(ent?.name ?? null) && /\bapartamento\b/i.test(replyText)) {
      replyText = replyText.replace(/\bapartamentos?\b/gi, 'lotes');
      console.log('[ANA_HARD_GUARD_EVORA_APARTAMENTO_BLOCKED]', {
        conversationId,
        enterpriseId: ent?.id ?? effectiveConv.enterprise_id ?? null,
      });
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
        !visitFlowSuppressedByConfirmationContext &&
        (schedulingGuardHandled || appointmentPreflight.active || flowStateParsed.pendingVisitScheduling === true),
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
      console.log('[ANA_REPEAT_SUPPRESSED]', {
        conversationId,
        reason: noRepeatGuardResult.reason,
        phase: 'final_no_repeat_guard',
      });
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
      if (recentHasVisitCta) {
        console.log('[ANA_CTA_REPEAT_SUPPRESSED]', {
          conversationId,
          ctaType: 'visit_offer',
          reason: aggressiveBlockFinal.reason,
          phase: 'final_legacy_visit_cta_guard',
        });
      }
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
    const blockedByRepeatGuard = recentAssistantRepliesForOutbound.some(
      (prev) =>
        prev === replyText.trim() ||
        repliesSemanticallySimilar(prev, replyText) ||
        (isVisitSchedulingLoopFallbackReply(prev) && isVisitSchedulingLoopFallbackReply(replyText))
    );
    if (blockedByRepeatGuard) {
      if (evoraKnowledgeDrivenMode) {
        console.log('[ANA_NO_REPEAT_MESSAGE_GUARD]', {
          conversationId,
          reason: 'outbound_repeat_detected_no_rewrite',
          originalAnswer: replyText,
          finalAnswer: replyText,
        });
      } else {
      const schedulingAlreadyScheduled = flowStateParsed.visitScheduling?.status === 'scheduled';
      const alternativeReply = userIrritatedNow
        ? 'Desculpa, você tem razão. Sem agendar visita agora. Vou te passar os detalhes por aqui.'
        : userRefusedScheduling
          ? 'Claro, sem problema. Te passo os detalhes por aqui.'
          : schedulingAlreadyScheduled
            ? 'Perfeito. Visita agendada. Se quiser, também posso te ajudar com valores, pagamento ou localização.'
            : 'Desculpa, me perdi aqui. Me diz só qual ponto você quer ver primeiro: lotes, valores, pagamento ou localização?';
      const alternativeAlreadyRepeated = recentAssistantRepliesForOutbound.some(
        (prev) => prev === alternativeReply || repliesSemanticallySimilar(prev, alternativeReply)
      );
      console.warn('[ANA_REPEATED_RESPONSE_BLOCKED]', {
        conversationId,
        blockedReply: replyText,
        alternativeAlreadyRepeated,
      });
      console.log('[ANA_REPEAT_SUPPRESSED]', {
        conversationId,
        reason: 'outbound_repeat_guard',
        alternativeAlreadyRepeated,
      });
      if (!alternativeAlreadyRepeated) {
        replyText = alternativeReply;
      } else {
        if (schedulingAlreadyScheduled) {
          replyText = 'Perfeito. Se quiser, posso te ajudar com valores, pagamento, localização ou detalhes dos lotes.';
        } else {
          replyText =
            'Posso te ajudar com esse ponto de forma objetiva. Você quer ver valores, entrada, pagamento, localização ou visita?';
        }
      }
      }
    }
    appendedVisitOfferMessagesForFinalSend = dedupeMessageParts(appendedVisitOfferMessagesForFinalSend, {
      conversationId,
      stage: 'final_visit_offer_messages',
    });
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

    const internalSanitized = sanitizeInternalInstructionLeakText(replyText);
    if (internalSanitized.changed) {
      replyText = internalSanitized.text;
      console.log('[ANA_INTERNAL_INSTRUCTION_SANITIZED]', {
        conversationId,
        intent: policyDetectedIntent,
      });
    }
    if (!replyText.trim()) {
      const fallbackAxis = currentAxisForRepetition ?? requestedAxisForPolicy;
      replyText =
        buildSpecificMissingAxisReply(fallbackAxis) ??
        'Claro. Você quer saber mais sobre localização, lazer, valores ou formas de pagamento?';
    }

    if (hasAnaInternalInstructionLeak(replyText)) {
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

    const finalPolicyResult = applyAnaConversationPolicy({
      conversationId,
      userMessage: trimmed,
      replyText,
      isFirstAnaReply,
      flowState: flowStateParsed,
      recentMessages: rowsBeforeSend.map((m) => ({
        role: m.role === 'assistant' ? 'assistant' : 'user',
        content: m.content,
      })),
      knownCustomerName: trustedCustomerName || effectiveConv.customer_name || null,
      probableCustomerName:
        !(trustedCustomerName || effectiveConv.customer_name || '').trim()
          ? linkedContact?.first_name ?? linkedContact?.full_name ?? null
          : null,
      now: lastUserMessageAt,
      disableFollowupQuestion:
        shouldAttemptDocSend ||
        (!visitFlowSuppressedByConfirmationContext &&
          (appointmentPreflight.active ||
            flowStateParsed.pendingVisitScheduling === true ||
            directVisitSchedulingIntent)),
      visitFlowActive:
        !visitFlowSuppressedByConfirmationContext &&
        (schedulingGuardHandled ||
          appointmentPreflight.active ||
          flowStateParsed.pendingVisitScheduling === true ||
          flowStateParsed.visitScheduling?.active === true ||
          directVisitSchedulingIntent),
      shortConfirmationContext: shortConfirmationContext.isShortConfirmation
        ? {
            kind: shortConfirmationContext.kind,
            lastAssistantQuestionType: shortConfirmationContext.lastAssistantQuestionType,
            lastAssistantQuestionText: shortConfirmationContext.lastAssistantQuestionText,
            lastOfferedTopics: shortConfirmationContext.lastOfferedTopics,
          }
        : undefined,
      safeTopicAvailability: safeTopicAvailabilityForPolicy,
      knowledgeDrivenMode: evoraKnowledgeDrivenMode,
      isKnowledgeGapTurn,
    });
    replyText = finalPolicyResult.text;
    if (finalPolicyResult.changed) {
      flowStateParsed = finalPolicyResult.flowState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
    }
    if (isKnowledgeGapTurn && deterministicKnowledgeGapBridgeReply && deterministicKnowledgeGapBridgeReply.trim()) {
      replyText = deterministicKnowledgeGapBridgeReply.trim();
      console.log('[ANA_KNOWLEDGE_GAP_BRIDGE_APPLIED]', {
        conversationId,
        matchedIntent: knowledgeGapMeta.matchedIntent ?? null,
      });
    }

    if (isKnowledgeGapTurn) {
      const knowledgeGapOfferValidation = validateKnowledgeGapResolutionOffer(
        replyText,
        knowledgeGapMeta.allowedNextActions
      );
      knowledgeGapOfferValidationResult = knowledgeGapOfferValidation;
      if (!knowledgeGapOfferValidation.ok) {
        console.log('[ANA_KNOWLEDGE_GAP_RESPONSE_MISSING_REQUIRED_OPTIONS]', {
          conversationId,
          hasBrokerOption: knowledgeGapOfferValidation.hasBrokerOption,
          hasVisitOption: knowledgeGapOfferValidation.hasVisitOption,
          missing: knowledgeGapOfferValidation.missing,
        });
        console.log('[ANA_KNOWLEDGE_GAP_RETRY_GENERATION]', {
          conversationId,
          missing: knowledgeGapOfferValidation.missing,
        });
        const knowledgeGapRequiresBroker = knowledgeGapMeta.allowedNextActions.includes('offer_broker_handoff');
        const knowledgeGapRequiresVisit = knowledgeGapMeta.allowedNextActions.includes('offer_visit_scheduling');
        const knowledgeGapRequiredOptionLines = [
          knowledgeGapRequiresBroker ? '1. encaminhar para o corretor responsavel;' : null,
          knowledgeGapRequiresVisit ? '2. agendar uma visita;' : null,
        ].filter(Boolean) as string[];
        const knowledgeGapRetryInstruction = [
          '[CONTEXTO OPERACIONAL - NAO MOSTRAR AO CLIENTE]',
          'A resposta anterior nao cumpriu a regra obrigatoria.',
          knowledgeGapRequiresBroker && knowledgeGapRequiresVisit
            ? 'Ela precisa oferecer explicitamente as DUAS opcoes ao cliente:'
            : 'Ela precisa oferecer explicitamente a proxima acao obrigatoria ao cliente:',
          ...knowledgeGapRequiredOptionLines,
          knowledgeGapRequiresBroker && knowledgeGapRequiresVisit ? 'Nao escolha apenas uma.' : null,
          'Nao invente dados.',
          'Nao diga valores, quantidades, disponibilidade, tabela, simulacao ou condicoes especificas.',
          'Reescreva a resposta de forma natural, curta e consultiva como Ana.',
          '[/CONTEXTO OPERACIONAL]',
        ].filter(Boolean).join('\n');
        const knowledgeGapRetryMessages: ChatMessage[] = [
          { role: 'system', content: knowledgeGapRetryInstruction },
          { role: 'user', content: `Mensagem original do cliente: "${trimmed}"` },
          { role: 'assistant', content: replyText },
          {
            role: 'user',
            content:
              knowledgeGapRequiresBroker && knowledgeGapRequiresVisit
                ? 'Reescreva a resposta mantendo tom humano e consultivo, cumprindo exatamente a regra de oferecer as duas opcoes.'
                : 'Reescreva a resposta mantendo tom humano e consultivo, cumprindo exatamente a regra de oferecer o corretor para confirmar.',
          },
        ];
        const knowledgeGapRetryResult = await generateChatCompletion({
          apiKey: aiApiKey,
          baseUrl: aiSettings.openaiBaseUrl,
          model,
          messages: knowledgeGapRetryMessages,
          temperature: Math.min(aiSettings.temperature, 0.65),
          maxTokens: Math.max(aiSettings.maxTokens, 700),
          responseFormatJson: false,
          costTracking: aiSettings.costTrackingEnabled
            ? {
                ...baseAnaCostTracking,
                purpose: 'ana_knowledge_gap_options_retry',
                requestType: 'ana_knowledge_gap_options_retry',
                metadata: {
                  responseFormatJson: false,
                  strategy: 'knowledge_gap_required_options_retry',
                },
              }
            : undefined,
        });
        captureLlmAudit(knowledgeGapRetryResult, 'ana_knowledge_gap_options_retry');
        const knowledgeGapRetryRaw = (knowledgeGapRetryResult.content || '').trim();
        if (knowledgeGapRetryResult.success && knowledgeGapRetryRaw) {
          replyText = finalizeAnaReplyText(knowledgeGapRetryRaw, {
            userMessage: trimmed,
            lastAssistantMessage: lastAssistantPlain,
            conversationMode: mode,
            isFirstAnaReply,
            enterpriseName: ent?.name ?? null,
            isKnowledgeGapTurn: true,
          }).slice(0, 4000);
          const retryValidation = validateKnowledgeGapResolutionOffer(replyText, knowledgeGapMeta.allowedNextActions);
          knowledgeGapOfferValidationResult = retryValidation;
          if (retryValidation.ok) {
            console.log('[ANA_KNOWLEDGE_GAP_RETRY_ACCEPTED]', {
              conversationId,
              hasBrokerOption: retryValidation.hasBrokerOption,
              hasVisitOption: retryValidation.hasVisitOption,
            });
          } else {
            console.log('[ANA_KNOWLEDGE_GAP_RETRY_STILL_INVALID]', {
              conversationId,
              hasBrokerOption: retryValidation.hasBrokerOption,
              hasVisitOption: retryValidation.hasVisitOption,
              missing: retryValidation.missing,
            });
            console.error('[ANA_PENDING_RESOLUTION_STATE_NOT_SET_INVALID_OFFER]', {
              conversationId,
              reason: 'knowledge_gap_retry_still_invalid',
              hasBrokerOption: retryValidation.hasBrokerOption,
              hasVisitOption: retryValidation.hasVisitOption,
              missing: retryValidation.missing,
            });
          }
        } else {
          console.log('[ANA_KNOWLEDGE_GAP_RETRY_STILL_INVALID]', {
            conversationId,
            reason: 'retry_generation_failed_or_empty',
            hasBrokerOption: knowledgeGapOfferValidation.hasBrokerOption,
            hasVisitOption: knowledgeGapOfferValidation.hasVisitOption,
            missing: knowledgeGapOfferValidation.missing,
          });
          console.error('[ANA_PENDING_RESOLUTION_STATE_NOT_SET_INVALID_OFFER]', {
            conversationId,
            reason: 'knowledge_gap_retry_generation_failed_or_empty',
            hasBrokerOption: knowledgeGapOfferValidation.hasBrokerOption,
            hasVisitOption: knowledgeGapOfferValidation.hasVisitOption,
            missing: knowledgeGapOfferValidation.missing,
          });
        }
      }
      if (!knowledgeGapOfferValidationResult?.ok) {
        console.error('[ANA_KNOWLEDGE_GAP_TEXT_MODE_EMPTY_OR_FAILED]', {
          conversationId,
          reason: 'knowledge_gap_offer_invalid_after_retry',
          hasBrokerOption: knowledgeGapOfferValidationResult?.hasBrokerOption ?? false,
          hasVisitOption: knowledgeGapOfferValidationResult?.hasVisitOption ?? false,
          missing: knowledgeGapOfferValidationResult?.missing ?? ['broker', 'visit'],
        });
        const safeKnowledgeGapFallback = buildLeadQualificationBridgeReply({
          matchedIntent: knowledgeGapMeta.matchedIntent ?? null,
          locationOverview: buildEvoraLocationOverview({
            addressComplete: authorizedLocationAddress.addressComplete,
            addressNumber: authorizedLocationAddress.addressNumber,
          }),
          locationLink: authorizedLocationLink ?? knowledgeLocationLink,
          addressComplete: authorizedLocationAddress.addressComplete,
          addressNumber: authorizedLocationAddress.addressNumber,
        });
        const safeFallbackValidation = validateKnowledgeGapResolutionOffer(
          safeKnowledgeGapFallback,
          knowledgeGapMeta.allowedNextActions
        );
        if (safeFallbackValidation.ok) {
          replyText = safeKnowledgeGapFallback;
          knowledgeGapOfferValidationResult = safeFallbackValidation;
          console.log('[ANA_KNOWLEDGE_GAP_SAFE_OFFER_FALLBACK_USED]', {
            conversationId,
            reason: 'knowledge_gap_offer_invalid_after_retry',
            replyLen: safeKnowledgeGapFallback.length,
          });
        }
      }
      if (knowledgeGapOfferValidationResult) {
        console.log('[ANA_KNOWLEDGE_GAP_FINAL_OFFER_READY]', {
          conversationId,
          hasBrokerOption: knowledgeGapOfferValidationResult.hasBrokerOption,
          hasVisitOption: knowledgeGapOfferValidationResult.hasVisitOption,
          replyLen: replyText.trim().length,
        });
      }
    }

    const finalQuestionHistory = collectRecentAssistantQuestionsForFinalCheck({
      flowState: flowStateParsed,
      recentMessages: rowsBeforeSend.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    });
    const originalReplyBeforeFinalQuestionRetry = replyText;
    let finalQuestionCheck = evaluateFinalQuestionCheck({
      replyText,
      recentQuestions: finalQuestionHistory,
    });
    console.log('[ANA_FINAL_QUESTION_CHECK]', {
      conversationId,
      hasFinalQuestion: finalQuestionCheck.hasFinalQuestion,
      repeatedQuestion: finalQuestionCheck.repeatedQuestion,
      forbiddenQuestion: finalQuestionCheck.forbiddenQuestion,
      lastAssistantQuestionText: finalQuestionCheck.lastAssistantQuestionText,
    });
    if (
      !finalQuestionCheck.hasFinalQuestion ||
      finalQuestionCheck.repeatedQuestion ||
      finalQuestionCheck.forbiddenQuestion
    ) {
      const retryReason =
        finalQuestionCheck.reasons.length > 0 ? finalQuestionCheck.reasons.join(',') : 'invalid_final_question';
      console.log('[ANA_FINAL_QUESTION_RETRY_GENERATION]', {
        conversationId,
        reason: retryReason,
      });

      const finalQuestionRetryInstruction = [
        '[CONTEXTO OPERACIONAL - NAO MOSTRAR AO CLIENTE]',
        'Mantenha o conteudo principal da resposta anterior, sem inventar dados novos.',
        'Ajuste apenas o fechamento final para terminar com UMA pergunta curta e contextual ao ultimo assunto do cliente.',
        'A pergunta final nao pode repetir perguntas recentes da conversa.',
        'Nao use perguntas finais genericas fixas nem menu fixo.',
        'Evite formulacoes de triagem repetitivas sem contexto do turno.',
        'Evite formula de desambiguacao robotica em tom de erro.',
        'Nao use menu fixo generico.',
        'A resposta final precisa terminar com uma pergunta real.',
        '[/CONTEXTO OPERACIONAL]',
      ].join('\n');
      const finalQuestionRetryMessages: ChatMessage[] = [
        { role: 'system', content: finalQuestionRetryInstruction },
        { role: 'user', content: `Mensagem do cliente: "${trimmed}"` },
        {
          role: 'assistant',
          content: `Resposta atual: "${originalReplyBeforeFinalQuestionRetry}"`,
        },
        {
          role: 'user',
          content: `Perguntas recentes da Ana (evitar repeticao): ${finalQuestionHistory.join(' | ') || 'nenhuma'}`,
        },
        {
          role: 'user',
          content: 'Reescreva a resposta final preservando o conteudo e ajustando apenas o fechamento final.',
        },
      ];

      const finalQuestionRetryResult = await generateChatCompletion({
        apiKey: aiApiKey,
        baseUrl: aiSettings.openaiBaseUrl,
        model,
        messages: finalQuestionRetryMessages,
        temperature: Math.min(aiSettings.temperature, 0.65),
        maxTokens: Math.max(aiSettings.maxTokens, 700),
        responseFormatJson: false,
      });
      captureLlmAudit(finalQuestionRetryResult, 'ana_final_question_retry');
      const finalQuestionRetryRaw = (finalQuestionRetryResult.content || '').trim();
      if (finalQuestionRetryResult.success && finalQuestionRetryRaw) {
        const retryCandidate = finalizeAnaReplyText(finalQuestionRetryRaw, {
          userMessage: trimmed,
          lastAssistantMessage: lastAssistantPlain,
          conversationMode: mode,
          isFirstAnaReply,
          enterpriseName: ent?.name ?? null,
          isKnowledgeGapTurn,
        }).slice(0, 4000);
        const retryCheck = evaluateFinalQuestionCheck({
          replyText: retryCandidate,
          recentQuestions: finalQuestionHistory,
        });
        const retryKnowledgeGapValidation = isKnowledgeGapTurn
          ? validateKnowledgeGapResolutionOffer(retryCandidate, knowledgeGapMeta.allowedNextActions)
          : null;
        const retryHasValidKnowledgeGapOffer = retryKnowledgeGapValidation?.ok ?? true;
        if (
          retryCheck.hasFinalQuestion &&
          !retryCheck.repeatedQuestion &&
          !retryCheck.forbiddenQuestion &&
          retryHasValidKnowledgeGapOffer
        ) {
          replyText = retryCandidate;
          finalQuestionCheck = retryCheck;
          if (retryKnowledgeGapValidation) {
            knowledgeGapOfferValidationResult = retryKnowledgeGapValidation;
          }
          console.log('[ANA_FINAL_QUESTION_RETRY_ACCEPTED]', {
            conversationId,
            finalQuestion: retryCheck.lastAssistantQuestionText,
          });
        } else {
          console.error('[ANA_FINAL_QUESTION_RETRY_FAILED]', {
            conversationId,
            reason:
              !retryHasValidKnowledgeGapOffer
                ? 'knowledge_gap_offer_invalid_after_final_question_retry'
                : (retryCheck.reasons.join(',') || 'retry_generated_invalid_question'),
          });
        }
      } else {
        console.error('[ANA_FINAL_QUESTION_RETRY_FAILED]', {
          conversationId,
          reason: finalQuestionRetryResult.error || 'retry_generation_failed_or_empty',
        });
      }
    }

    const globalNoEnterpriseMentionGuard = applyGlobalNoEnterpriseUnsupportedEnterpriseMentionGuard({
      globalNoEnterpriseMode,
      replyText,
      userMessage: trimmed,
      activeEnterprises: allActiveEnterprises,
    });
    if (globalNoEnterpriseMentionGuard.changed) {
      console.log('[ANA_GLOBAL_NO_ENTERPRISE_UNSUPPORTED_ENTERPRISE_MENTION]', {
        conversationId,
        enterpriseName: globalNoEnterpriseMentionGuard.enterpriseName,
        originalReplyPreview: replyText.slice(0, 260),
      });
      replyText = globalNoEnterpriseMentionGuard.text;
      appendedVisitOfferMessagesForFinalSend = [];
      anaTurnAuditGuardsApplied.globalNoEnterpriseUnsupportedEnterpriseMention = {
        changed: true,
        enterpriseName: globalNoEnterpriseMentionGuard.enterpriseName,
      };
    }

    if (containsForbiddenMissingDetailFallbackText(replyText)) {
      console.log('[ANA_FORBIDDEN_MISSING_DETAIL_FALLBACK_BLOCKED]', {
        conversationId,
        reason: 'final_reply_contains_forbidden_missing_detail_fallback',
        userMessagePreview: trimmed.slice(0, 160),
        replacementPreview: ANA_LLM_FIRST_MISSING_INFO_REPLY.slice(0, 160),
      });
      replyText = ANA_LLM_FIRST_MISSING_INFO_REPLY;
      anaTurnAuditGuardsApplied.forbiddenMissingDetailFallback = {
        blocked: true,
        replacement: 'contextual_missing_info',
      };
    }

    const finalReplyParts = [replyText];
    const committedFinalReply = commitTurnResponse({
      handler: openAiCalled ? 'qwen_or_llm_final' : 'deterministic_final',
      reason: 'main_reply',
      parts: [...finalReplyParts, ...appendedVisitOfferMessagesForFinalSend],
      stage: 'final_reply_commit',
      requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
      commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
      shouldCallQwen: openAiCalled,
    });
    if (!committedFinalReply.committed || !committedFinalReply.text.trim()) {
      anaTurnAuditOutcome = 'blocked';
      anaTurnAuditBlockedReason = 'final_reply_commit_blocked';
      anaTurnDiagnostics.finalResponse.outboundStatus = anaTurnAuditOutcome;
      if (await sendGlobalNoEnterpriseFinalSafeReply(anaTurnAuditBlockedReason)) return;
      return;
    }
    replyText = committedFinalReply.text;
    appendedVisitOfferMessagesForFinalSend = [];

    anaEngineTrace('final_send_start', {
      conversationId,
      phase: 'ana_main_reply',
      replyLen: replyText.length,
    });
    if (isKnowledgeGapTurn) {
      console.log('[ANA_KNOWLEDGE_GAP_SEND_STARTED]', {
        conversationId,
        replyLen: replyText.length,
      });
    }
    const sendResult = await sendAnaOutboundMessages({
      conversationId,
      toPhoneNumber,
      text: replyText,
      phase: 'ana_main_reply',
      replyPipelineToken,
    });
    if (sendResult.success && sendResult.metaMessageIds.length > 0) {
      if (isKnowledgeGapTurn) {
        console.log('[ANA_KNOWLEDGE_GAP_SEND_SUCCESS]', {
          conversationId,
          outboundMetaMessageId: sendResult.metaMessageIds[sendResult.metaMessageIds.length - 1] ?? null,
        });
      }
      const committedFinalState = updateConversationStateFromCommittedReply({
        conversationId,
        flowState: flowStateParsed,
        finalReplyParts: committedFinalReply.parts,
        finalReplyText: replyText,
        handler: openAiCalled ? 'qwen_or_llm_final' : 'deterministic_final',
        currentTopic: anaTurnContextResolved?.currentTopic ?? null,
        requestedTopic: anaTurnContextResolved?.requestedTopic ?? null,
        commercialAxis: anaTurnContextResolved?.commercialAxis ?? currentAxisForRepetition,
      });
      flowStateParsed = committedFinalState.nextState;
      await mergeConversationCommercialFlowState(conversationId, flowStateParsed);
      console.log('[ANA_COMMITTED_REPLY_STATE_SAVED]', {
        conversationId,
        savedFields: [
          'lastAssistantQuestionText',
          'lastAssistantQuestionType',
          'recentQuestions',
          'lastOfferedTopics',
          'lastAnsweredTopic',
          'topicsAlreadyAnswered',
          'lastCommittedHandler',
          'lastCommittedAt',
        ],
      });
      if (isKnowledgeGapTurn) {
        if (knowledgeGapOfferValidationResult?.ok === true) {
          await setConversationPendingResolutionState(conversationId, {
            reason: knowledgeGapMeta.reason,
            intent: knowledgeGapMeta.matchedIntent ?? null,
            payload: {
              allowedNextActions: knowledgeGapMeta.allowedNextActions,
            },
          });
          console.log('[ANA_PENDING_RESOLUTION_STATE_SET_AFTER_VALID_OFFER]', {
            conversationId,
            reason: knowledgeGapMeta.reason,
            matchedIntent: knowledgeGapMeta.matchedIntent ?? null,
            hasBrokerOption: knowledgeGapOfferValidationResult.hasBrokerOption,
            hasVisitOption: knowledgeGapOfferValidationResult.hasVisitOption,
          });
        } else {
          console.error('[ANA_PENDING_RESOLUTION_STATE_NOT_SET_INVALID_OFFER]', {
            conversationId,
            reason: knowledgeGapMeta.reason,
            matchedIntent: knowledgeGapMeta.matchedIntent ?? null,
            hasBrokerOption: knowledgeGapOfferValidationResult?.hasBrokerOption ?? null,
            hasVisitOption: knowledgeGapOfferValidationResult?.hasVisitOption ?? null,
            missing: knowledgeGapOfferValidationResult?.missing ?? ['broker', 'visit'],
          });
        }
      }
      anaEngineTrace('final_send_success', {
        conversationId,
        phase: 'ana_main_reply',
        outboundMetaMessageId: sendResult.metaMessageIds[sendResult.metaMessageIds.length - 1] ?? null,
      });
      console.log('[ANA_PIPELINE] engine_send_success', {
        conversationId,
        phase: 'ana_main_reply',
        inboundMetaMessageId,
        outboundMetaMessageId: sendResult.metaMessageIds[sendResult.metaMessageIds.length - 1] ?? null,
        replyLen: replyText.length,
      });
      if (globalNoEnterpriseMode) {
        console.log('[ANA_GLOBAL_NO_ENTERPRISE_REPLY_SENT]', {
          conversationId,
          enterpriseResolutionSource: enterpriseResolution.source,
          reasonWhenNoEnterprise: enterpriseResolution.reasonWhenNoEnterprise,
          outboundStatus: 'sent',
          outboundMetaMessageId: sendResult.metaMessageIds[sendResult.metaMessageIds.length - 1] ?? null,
          replyLen: replyText.length,
        });
      }
      console.log('[ANA DEBUG] WhatsApp reply sent', {
        metaMessageId: sendResult.metaMessageIds[sendResult.metaMessageIds.length - 1] ?? null,
        partsSent: sendResult.metaMessageIds.length,
      });
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
      if (structuredAppointmentRegistration?.persisted) {
        await cancelAnaVisitFollowupForConversation({
          conversationId,
          reason: 'visit_scheduled',
        });
      } else {
        await startAnaVisitFollowupIfEligible({
          conversationId,
          flowState: nextFlow,
          replyText,
          anchorAssistantMessageId: sendResult.messageIds[sendResult.messageIds.length - 1] ?? null,
          missingSlot: nextFlow.pendingVisitMissingSlot ?? null,
        });
      }
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
      await notifyBrokerAppointmentConfirmedAfterAnaSend(
        structuredAppointmentRegistration,
        ent?.name ?? null
      );
    } else {
      if (isKnowledgeGapTurn) {
        console.error('[ANA_KNOWLEDGE_GAP_SEND_FAILED]', {
          conversationId,
          error: sendResult.error ?? null,
          code: sendResult.code ?? null,
        });
      }
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
      if (globalNoEnterpriseMode) {
        console.warn('[ANA_GLOBAL_NO_ENTERPRISE_REPLY_SEND_FAILED]', {
          conversationId,
          enterpriseResolutionSource: enterpriseResolution.source,
          reasonWhenNoEnterprise: enterpriseResolution.reasonWhenNoEnterprise,
          outboundStatus: 'send_failed',
          error: sendResult.error ?? null,
          code: sendResult.code ?? null,
        });
      }
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
    if (
      anaGlobalNoEnterpriseModeForTurn &&
      (anaTurnAuditOutcome === 'silent' || anaTurnAuditOutcome === 'blocked') &&
      !isHardBlockedSilentExitReason(anaTurnAuditBlockedReason)
    ) {
      await sendGlobalNoEnterpriseFinalSafeReply(anaTurnAuditBlockedReason);
    }
    if (anaTurnAuditOutcome === 'silent' || anaTurnAuditOutcome === 'blocked') {
      console.log('[ANA_SILENT_EXIT_BLOCKED]', {
        conversationId,
        outcome: anaTurnAuditOutcome,
        reason: anaTurnAuditBlockedReason ?? 'unknown_silent_exit',
        replyPipelineToken: replyPipelineToken ?? null,
        enterpriseResolutionSource: anaEnterpriseResolutionForAudit.source,
        resolvedEnterpriseId: anaEnterpriseResolutionForAudit.enterpriseId,
        reasonWhenNoEnterprise: anaEnterpriseResolutionForAudit.reasonWhenNoEnterprise,
      });
    }
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








function normalizeAnaLocalTextForRules(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function isGratitudeOnlyMessage(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text).replace(/[.!?]+$/g, '').trim();
  return /^(obrigado|obrigada|muito obrigado|muito obrigada|ok obrigado|ok obrigada|valeu|vlw|agradeco|agradeço)$/.test(n);
}

function isGenericFirstGreetingMessage(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text).replace(/[.!?]+$/g, '').trim();
  return /^(oi|ola|olá|bom dia|boa tarde|boa noite|oi tudo bem|ola tudo bem|olá tudo bem|tudo bem|td bem)$/.test(n);
}

function isFirstContactGeneralInterestMessage(text: string): boolean {
  return isFirstContactEnterpriseInterestMessage(text);
}

function isFirstContactEnterpriseInterestMessage(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text);
  const asksCommercialInfo =
    /\b(tenho interesse|gostaria de saber mais|quero saber mais|queria saber mais|me fala mais|me fale mais|quero entender melhor|vi o anuncio|vi o anúncio|me passa mais detalhes|me manda mais informacoes|me manda mais informações|gostaria de informacoes|gostaria de informações|quero informacoes|quero informações|queria informacoes|queria informações|informacoes sobre|informações sobre)\b/.test(
      n
    );
  const mentionsEnterprise = /\b(evora|empreendimento|projeto|loteamento|lote|lotes|atibaia)\b/.test(n);
  return asksCommercialInfo && mentionsEnterprise;
}

function hasEnterprisePresentationContent(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text);
  if (!n) return false;
  return /\b(evora|empreendimento|projeto|loteamento|lote|lotes|atibaia|pedreira|rodovia dom pedro|dom pedro|seguranca|portaria|lazer|infraestrutura|obras|financiamento|pagamento)\b/.test(
    n
  );
}

function isFirstReplyGreetingOnlyMessage(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) return true;
  const words = n.split(' ').filter(Boolean);
  if (words.length === 0) return true;
  if (words.length > 16) return false;
  const allowed = new Set([
    'oi',
    'ola',
    'bom',
    'boa',
    'dia',
    'tarde',
    'noite',
    'tudo',
    'bem',
    'td',
    'como',
    'vai',
    'voce',
    'esta',
    'claro',
    'sim',
    'ok',
    'opa',
    'e',
    'ai',
    'te',
    'ajudo',
    'ajudar',
    'posso',
  ]);
  if (words.every((word) => allowed.has(word))) return true;
  return /^(oi|ola|bom dia|boa tarde|boa noite)(\s+(tudo bem|como vai|claro|sim|ok))*$/.test(n);
}

function buildFirstGreetingSafeFallback(text: string): string {
  void text;
  return buildLeadQualificationNameQuestion();
}

function isGenericInterestFollowup(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text);
  return /\b(queria saber mais|quero saber mais|me fala mais|me passa mais detalhes|tem mais informacoes|tem mais informações|quero entender melhor|gostaria de saber mais|saber mais sobre o evora|mais sobre o evora)\b/.test(n);
}

function isConversationalGenericFollowup(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text);
  if (!n) return false;
  return (
    n === 'que mais' ||
    n === 'que mais?' ||
    n === 'show' ||
    n === 'legal' ||
    n === 'e ai' ||
    n === 'e aí' ||
    n === 'tem mais' ||
    n === 'o que mais' ||
    /\b(me fala mais|quero saber mais|que mais|tem mais|o que mais)\b/.test(n)
  );
}

function buildConversationalCanonicalContext(lastAxis: string | null): string {
  return [
    'CONTEXTO CANÔNICO AUTORIZADO',
    '- Évora: empreendimento em Atibaia.',
    '- Quantidade total de lotes: 145.',
    '- Lotes na faixa de 360 m² a 725 m².',
    '- Valor inicial a partir de R$279.000,00.',
    '- Metro quadrado a partir de R$775,00.',
    '- Região da Pedreira / bairro Rio Abaixo.',
    '- Acesso pela Rodovia Dom Pedro I, cerca de 50 minutos de São Paulo, com qualidade de vida e contato com a natureza.',
    '- Lazer: Piscina adulto, Academia, Salão de festas, Playground, Coworking, Espaço zen, Fireplace, Quadra de beach tennis, Campo society, Estação para carros elétricos.',
    '- Portaria 24h com controle de acesso.',
    '- Formas de pagamento: planos estendidos em até 120x, parcelamento sem juros em até 48x, financiamento direto com a construtora, menos burocracia e mais facilidade.',
    `- Último eixo da conversa: ${lastAxis ?? 'indefinido'}.`,
    'Responda com tom natural e útil, sem inventar fatos fora desse contexto.',
  ].join('\n');
}

function hasUnauthorizedPriceClaimInConversationalReply(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text);
  if (!/\br\$\s*\d/.test(n) && !/\b\d+\s*(?:mil|milhao|milhões|milhao)\b/.test(n)) return false;
  const allowsMainPrice = /\br\$\s*279[\.\s]*000(?:,\s*00)?\b/.test(n) || /\b279[\.\s]*000\b/.test(n);
  const allowsM2 = /\br\$\s*775(?:,\s*00)?\b/.test(n) || /\b775\b/.test(n);
  if (allowsMainPrice || allowsM2) return false;
  return true;
}

function buildConversationalCanonicalFallback(lastAxis: string | null): string {
  if (lastAxis === 'lazer' || lastAxis === 'areas_lazer') return buildCanonicalLazerFullReply();
  if (lastAxis === 'localizacao' || lastAxis === 'localizacao_endereco') {
    return 'O Évora fica em Atibaia, na região da Pedreira/Rio Abaixo, com acesso pela Rodovia Dom Pedro I, a cerca de 50 minutos de São Paulo, em uma região com qualidade de vida e contato com a natureza.';
  }
  if (lastAxis === 'preco' || lastAxis === 'preco_valor_lote') {
    return 'O Évora tem lotes a partir de R$279.000,00, com metro quadrado a partir de R$775,00. O valor final depende da unidade e das condições escolhidas.';
  }
  if (lastAxis === 'financiamento' || lastAxis === 'formas_pagamento') {
    return 'De forma geral, o Évora trabalha com planos estendidos em até 120x para parcelas mais baixas, parcelamento sem juros em até 48x e financiamento direto com a construtora, com menos burocracia e mais facilidade.';
  }
  return 'Posso te ajudar de forma objetiva com as informações do empreendimento.';
}



