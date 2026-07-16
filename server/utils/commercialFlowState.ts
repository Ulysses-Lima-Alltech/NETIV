import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';
import type { FileCategory } from '../repositories/enterpriseRepository.js';
import type { RequestedProductType } from './anaRequestedProductType.js';
import {
  extractCatalogEnterpriseNamesFromAssistantReply,
  tryMatchEnterpriseFromUserCorpus,
} from '../repositories/enterpriseMatch.js';
import {
  inferResolvedPurchaseIntent,
  isPurchaseIntentAxisQuestion,
  type PurchaseIntent,
} from './anaCommercialAxisGuard.js';

export interface PendingAppointmentCandidate {
  date: string;
  time: string;
  datetime: string;
  sourceMessage: string;
  confidence: number;
  offeredAt: string;
}
export type MaterialPendingAction = 'send_material';
export type MaterialSendStatus =
  | 'sent'
  | 'not_found'
  | 'send_failed'
  | 'enterprise_not_resolved'
  | 'material_type_not_resolved';

export type LeadQualificationPurpose = 'moradia' | 'investimento' | 'construcao' | 'familia' | 'pesquisa';
export type LeadQualificationProductFit = 'loteamento' | 'casa' | 'apartamento' | 'indefinido';

export interface LeadQualificationState {
  name: string | null;
  nameAsked: boolean;
  nameCollected: boolean;
  customerName: string | null;
  purpose: LeadQualificationPurpose | null;
  productFit: LeadQualificationProductFit | null;
  knowsAtibaia: boolean | null;
  currentCity: string | null;
  buyingTimeline: string | null;
  budgetRangeKnown: boolean | null;
  budgetRangeText: string | null;
  visitInterest: boolean | null;
  materialOffered: boolean;
  lastQualificationQuestion: string | null;
  askedQualificationKeys: string[];
}

/** Estado persistido em `conversations.commercial_flow_state` (JSON). */
export interface CommercialFlowState {
  stage?: string;
  productTypeHint?: RequestedProductType | string;
  lastCatalogOfferedNames?: string[];
  /** Quando a última resposta da Ana listou exatamente um 📍 — ID resolvido no backend. */
  lastSingleCatalogEnterpriseId?: number | null;
  /** Último empreendimento inferido do texto da assistente ou já focado na conversa. */
  lastInferredEnterpriseId?: number | null;
  lastAssistantSnippet?: string;
  /** Eixo morar x investir resolvido pelo cliente. */
  purchaseIntent?: PurchaseIntent | null;
  purchaseIntentUpdatedAt?: string;
  /** Se a ultima resposta da Ana perguntou explicitamente morar x investir. */
  lastAssistantAskedPurchaseIntent?: boolean;
  updatedAt?: string;
  /** Marca último reset de escopo comercial (saída de foco / catálogo). */
  clearedAt?: string;
  /** Ação pendente para continuidade determinística de envio de material. */
  pending_action?: MaterialPendingAction | null;
  /** Categoria pendente de envio (book/unidades/tabela_comercial/outro). */
  pending_material_type?: FileCategory | null;
  /** Empreendimento pendente para envio de material. */
  pending_enterprise_id?: number | null;
  /** Último tipo de material solicitado pelo cliente. */
  last_requested_material_type?: FileCategory | null;
  /** Timestamp ISO da última solicitação de material. */
  last_material_request_at?: string;
  /** Último arquivo efetivamente enviado. */
  last_material_sent_id?: number | null;
  /** Último status de envio de material no fluxo determinístico. */
  last_material_send_status?: MaterialSendStatus | null;
  /** Fluxo determinístico de visita aguardando complemento do cliente. */
  pendingVisitScheduling?: boolean;
  /** Rótulo humano da data pendente (ex.: "hoje", "amanhã"). */
  pendingVisitDateLabel?: string | null;
  /** Data pendente normalizada em America/Sao_Paulo (YYYY-MM-DD). */
  pendingVisitDate?: string | null;
  /** Alias legivel do dia pendente (compat com logs/diagnostico). */
  pendingVisitDay?: string | null;
  /** Horário pendente normalizado (HH:MM), quando já capturado no fluxo determinístico. */
  pendingVisitTime?: string | null;
  /** Período pendente informado pelo cliente (manhã/tarde/noite), antes de horário exato. */
  pendingVisitPeriod?: string | null;
  /** Empreendimento usado no fluxo pendente de visita. */
  pendingVisitEnterpriseId?: number | null;
  /** Ultimo horario rejeitado por janela de visita (ex.: "20h"), aguardando ajuste do cliente. */
  pendingVisitInvalidTime?: string | null;
  /** Slot faltante no fluxo transacional de visita. */
  pendingVisitMissingSlot?: 'nome' | 'dia' | 'periodo_ou_horario' | 'valid_time' | null;
  /** Nome capturado no fluxo de visita (quando ainda nao foi confirmado no cadastro principal). */
  pendingVisitCustomerName?: string | null;
  /** Marca quando a Ana já perguntou confirmacao final da visita e aguarda resposta curta. */
  pendingVisitConfirmationAsked?: boolean;
  suggestedVisitStartAt?: string | null;
  suggestedVisitEndAt?: string | null;
  suggestedVisitBrokerId?: number | null;
  suggestedVisitSlotLabel?: string | null;
  suggestedVisitTimezone?: string | null;
  suggestedVisitStatus?: 'awaiting_confirmation' | 'accepted' | 'declined' | 'expired' | null;
  awaitingAlternativeSlotInterest?: boolean | null;
  suggestedVisitDeclinedStartAt?: string | null;
  suggestedVisitDeclinedEndAt?: string | null;
  suggestedVisitDeclinedBrokerId?: number | null;
  suggestedVisitDeclinedSlotLabel?: string | null;
  suggestedVisitDeclinedTimezone?: string | null;
  /** Estado estruturado do fluxo de agendamento de visita. */
  visitScheduling?: {
    active: boolean;
    offered: boolean;
    accepted: boolean;
    requestedDateText: string | null;
    requestedTimeText: string | null;
    normalizedDate: string | null;
    normalizedTime: string | null;
    requestedPeriodText?: string | null;
    nameCollected: boolean;
    customerName: string | null;
    status:
      | 'none'
      | 'collecting_date'
      | 'collecting_time'
      | 'collecting_name'
      | 'ready_to_confirm'
      | 'awaiting_slot_confirmation'
      | 'scheduled';
  };
  /** Memória leve de orquestração comportamental global da Ana (reaproveitável entre empreendimentos). */
  dialoguePolicy?: {
    greetedAt?: string | null;
    lastFollowupQuestion?: string | null;
    recentlyDiscussedTopics?: string[];
    recentlyAskedTopics?: string[];
    lastBrokerHandoffAskedAt?: string | null;
    brokerHandoffAcceptedAt?: string | null;
    nameUncertainAt?: string | null;
    lastAssistantQuestionType?: string | null;
    lastAssistantQuestionText?: string | null;
    recentQuestions?: string[];
    lastOfferedTopics?: string[];
    lastAnsweredTopic?: string | null;
    topicsAlreadyAnswered?: string[];
    lastCommittedHandler?: string | null;
    lastCommittedAt?: string | null;
    leadQualification?: LeadQualificationState;
  };
}

/** Zera shortlist e hints de foco ao sair do escopo ou trocar empreendimento por menção explícita. */
export function resetCommercialScopeHints(prev: CommercialFlowState | null): CommercialFlowState {
  const next: CommercialFlowState = { ...(prev || {}) };
  delete next.lastCatalogOfferedNames;
  delete next.lastSingleCatalogEnterpriseId;
  delete next.lastInferredEnterpriseId;
  delete next.lastAssistantSnippet;
  delete next.productTypeHint;
  delete next.stage;
  delete next.pending_action;
  delete next.pending_material_type;
  delete next.pending_enterprise_id;
  delete next.last_requested_material_type;
  delete next.last_material_request_at;
  delete next.last_material_sent_id;
  delete next.last_material_send_status;
  delete next.pendingVisitScheduling;
  delete next.pendingVisitDateLabel;
  delete next.pendingVisitDate;
  delete next.pendingVisitDay;
  delete next.pendingVisitTime;
  delete next.pendingVisitPeriod;
  delete next.pendingVisitEnterpriseId;
  delete next.pendingVisitInvalidTime;
  delete next.pendingVisitMissingSlot;
  delete next.pendingVisitCustomerName;
  delete next.pendingVisitConfirmationAsked;
  delete next.suggestedVisitStartAt;
  delete next.suggestedVisitEndAt;
  delete next.suggestedVisitBrokerId;
  delete next.suggestedVisitSlotLabel;
  delete next.suggestedVisitTimezone;
  delete next.suggestedVisitStatus;
  delete next.awaitingAlternativeSlotInterest;
  delete next.suggestedVisitDeclinedStartAt;
  delete next.suggestedVisitDeclinedEndAt;
  delete next.suggestedVisitDeclinedBrokerId;
  delete next.suggestedVisitDeclinedSlotLabel;
  delete next.suggestedVisitDeclinedTimezone;
  delete next.visitScheduling;
  delete next.dialoguePolicy;
  next.clearedAt = new Date().toISOString();
  next.updatedAt = new Date().toISOString();
  return next;
}

export function parseCommercialFlowState(raw: unknown): CommercialFlowState | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    try {
      const o = JSON.parse(raw) as unknown;
      return typeof o === 'object' && o !== null && !Array.isArray(o) ? (o as CommercialFlowState) : null;
    } catch {
      return null;
    }
  }
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw as CommercialFlowState;
  return null;
}

/** Chaves só de metadado — não indicam escopo comercial ativo (ex.: após `resetCommercialScopeHints`). */
const COMMERCIAL_FLOW_META_KEYS = new Set(['updatedAt', 'clearedAt']);

/**
 * `commercial_flow_state` no banco é NOT NULL e o reset grava `'{}'::jsonb`.
 * Trata objeto vazio ou só com metadados como ausência de estado comercial persistido.
 */
export function isEmptyCommercialFlowState(raw: unknown): boolean {
  const st = parseCommercialFlowState(raw);
  if (st == null) return true;
  for (const key of Object.keys(st)) {
    if (COMMERCIAL_FLOW_META_KEYS.has(key)) continue;
    const v = (st as Record<string, unknown>)[key];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v) && v.length === 0) continue;
    if (typeof v === 'string' && (v as string).trim() === '') continue;
    return false;
  }
  return true;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Mensagens curtas típicas de continuação (atributo, confirmação) — não devem reabrir triagem.
 * `explicitSwitch` = frases tipo "me fale sobre o X" (outro handler já trata).
 */
export function isShortCommercialContinuation(trimmed: string, explicitSwitch: boolean): boolean {
  if (explicitSwitch) return false;
  const t = trimmed.trim();
  if (!t || t.length > 96) return false;
  const words = t.split(/\s+/).length;
  if (words > 6) return false;
  const n = norm(t);

  if (
    /\b(quero\s+um\s+loteamento|quero\s+apartamento|quais\s+opcoes|quais\s+empreendimentos|me\s+fale\s+do|me\s+fale\s+sobre|me\s+fala\s+do|me\s+fala\s+sobre|gostaria\s+de\s+saber|tenho\s+interesse)\b/.test(
      n
    )
  ) {
    return false;
  }

  if (
    /\b(lazer|localizacao|localização|seguranca|segurança|metragem|valor|valores|condicoes|condições|condicao|condição|financiamento|parcelamento|infraestrutura|area\s+verde|vagas|quero\s+saber\s+mais|tabela|plantas?)\b/.test(
      n
    )
  ) {
    return true;
  }

  if (words <= 2 && t.length <= 32) {
    if (/^(sim|nao|não|ok|isso|beleza|perfeito|legal|aham|uhum)$/i.test(t.trim())) return true;
  }

  return false;
}

export interface RecoverEnterpriseResult {
  enterpriseId: number;
  source: string;
}

/**
 * Recupera foco de empreendimento antes do match por mensagem atual quando:
 * - ainda não há `enterprise_id` na conversa, mas
 * - o cliente respondeu algo curto (ex.: "lazer") e
 * - há contexto forte na última assistente ou estado persistido.
 */
export function tryRecoverEnterpriseIdFromFlowState(args: {
  trimmedUser: string;
  enterpriseIdInDb: number | null;
  lastAssistantText: string;
  flowState: CommercialFlowState | null;
  explicitSwitch: boolean;
  matchPool: EnterpriseRow[];
  allEnterprises: EnterpriseRow[];
}): RecoverEnterpriseResult | null {
  if (args.enterpriseIdInDb != null) return null;
  if (!isShortCommercialContinuation(args.trimmedUser, args.explicitSwitch)) return null;

  const st = args.flowState;
  if (st != null && !isEmptyCommercialFlowState(st)) {
    if (st.lastSingleCatalogEnterpriseId != null && Number.isFinite(st.lastSingleCatalogEnterpriseId)) {
      return { enterpriseId: st.lastSingleCatalogEnterpriseId, source: 'persisted_last_single_catalog' };
    }
    if (st.lastInferredEnterpriseId != null && Number.isFinite(st.lastInferredEnterpriseId)) {
      return { enterpriseId: st.lastInferredEnterpriseId, source: 'persisted_last_inferred' };
    }
  }

  const listed = extractCatalogEnterpriseNamesFromAssistantReply(args.lastAssistantText);
  if (listed.length === 1) {
    const id = tryMatchEnterpriseFromUserCorpus(listed[0]!, args.matchPool);
    if (id != null) return { enterpriseId: id, source: 'assistant_single_catalog_emoji' };
  }

  const fromBody = tryMatchEnterpriseFromUserCorpus(args.lastAssistantText, args.allEnterprises);
  if (fromBody != null) return { enterpriseId: fromBody, source: 'assistant_text_unique_mention' };

  return null;
}

export function computeNextCommercialFlowState(
  prev: CommercialFlowState | null,
  assistantReply: string,
  opts: {
    conversationPhase: string;
    enterpriseIdResolved: number | null;
    enterprises: EnterpriseRow[];
    productTypeHint: RequestedProductType | undefined;
    userMessage?: string | null;
  }
): CommercialFlowState {
  const nowIso = new Date().toISOString();
  const catalogNames = extractCatalogEnterpriseNamesFromAssistantReply(assistantReply);
  let lastSingleCatalogEnterpriseId: number | null = null;
  if (catalogNames.length === 1) {
    const id = tryMatchEnterpriseFromUserCorpus(catalogNames[0]!, opts.enterprises);
    if (id != null) lastSingleCatalogEnterpriseId = id;
  }

  let lastInferred: number | null = opts.enterpriseIdResolved;
  if (lastInferred == null) {
    const inf = tryMatchEnterpriseFromUserCorpus(assistantReply, opts.enterprises);
    if (inf != null) lastInferred = inf;
  }
  if (lastInferred == null) {
    lastInferred = prev?.lastInferredEnterpriseId ?? null;
  }

  const userResolvedPurchaseIntent = inferResolvedPurchaseIntent(opts.userMessage ?? null);
  const purchaseIntent = userResolvedPurchaseIntent ?? prev?.purchaseIntent ?? null;
  const purchaseIntentUpdatedAt =
    userResolvedPurchaseIntent != null
      ? nowIso
      : (purchaseIntent != null ? prev?.purchaseIntentUpdatedAt ?? nowIso : undefined);

  return {
    ...prev,
    stage: opts.conversationPhase,
    productTypeHint: opts.productTypeHint ?? prev?.productTypeHint,
    lastCatalogOfferedNames: catalogNames.length > 0 ? catalogNames : prev?.lastCatalogOfferedNames,
    lastSingleCatalogEnterpriseId,
    lastInferredEnterpriseId: lastInferred,
    lastAssistantSnippet: assistantReply.slice(0, 480),
    purchaseIntent,
    purchaseIntentUpdatedAt,
    lastAssistantAskedPurchaseIntent: isPurchaseIntentAxisQuestion(assistantReply),
    updatedAt: nowIso,
  };
}
