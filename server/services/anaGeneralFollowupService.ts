import { query } from '../db/pg.js';
import {
  getConversationById,
  type ConversationRow,
} from '../repositories/conversationRepository.js';
import {
  computeAnaFollowupAtUtc,
  getAnaFollowupDelayMinutes,
  isAnaFollowupForbiddenNightWindowSp,
} from '../utils/anaFollowupCadence.js';
import {
  parseCommercialFlowState,
  type CommercialFlowState,
} from '../utils/commercialFlowState.js';
import {
  isAnaAutomationBlockedByHandoff,
  logAnaAutomationBlockedByHandoff,
} from '../utils/anaAutomationEligibility.js';

export function getAnaGeneralFollowupCutoverAtFromEnv(): Date | null {
  const raw = String(process.env.ANA_GENERAL_FOLLOWUP_CUTOVER_AT ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    console.warn('[ANA_GENERAL_FOLLOWUP] invalid_cutover_env', { value: raw });
    return null;
  }
  return parsed;
}
export function isAnaGeneralFollowupBeforeCutover(params: {
  assistantCreatedAt: Date;
  cutoverAt?: Date | null;
}): boolean {
  const cutoverAt = params.cutoverAt === undefined ? getAnaGeneralFollowupCutoverAtFromEnv() : params.cutoverAt;
  if (!cutoverAt) return false;
  return params.assistantCreatedAt.getTime() < cutoverAt.getTime();
}

export interface AnaGeneralFollowupStartParams {
  conversationId: number;
  enterpriseId: number | null;
  assistantMessageId: number | null;
  assistantCreatedAt: Date;
  lastUserMessageId: number | null;
  finalReplyText: string;
  commercialFlowState: unknown;
  sourcePhase?: string | null;
  conversation?: Pick<
    ConversationRow,
    | 'id'
    | 'channel'
    | 'conversation_type'
    | 'handoff'
    | 'classification'
    | 'manual_closed_at'
    | 'assigned_broker_id'
  > | null;
}

export type AnaGeneralFollowupStartDecision =
  | {
      eligible: true;
      nextFollowupAt: Date;
      rawFirstAttemptAt: Date;
      quietHoursAdjusted: boolean;
      reason: 'awaiting_customer_reply';
    }
  | {
      eligible: false;
      reason: string;
      cancelExisting: boolean;
      cancelReason?: string;
    };

function normalizeText(text: string): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isInternalConversationType(value: unknown): boolean {
  const normalized = String(value ?? 'CLIENT').trim().toUpperCase();
  return normalized === 'CORRETOR' || normalized === 'ADMIN';
}

function sourcePhaseBlocksGeneralFollowup(sourcePhase: string | null | undefined): boolean {
  const phase = normalizeText(sourcePhase || '');
  if (!phase) return false;
  return (
    phase.includes('media') ||
    phase.includes('material') ||
    phase.includes('doc_post_send') ||
    phase.includes('diagnostic') ||
    phase.includes('emergency') ||
    phase.includes('safe_reply') ||
    phase.includes('safe_fallback') ||
    phase.includes('retryable_failure') ||
    phase.includes('technical') ||
    phase.includes('enterprise_ai_blocked') ||
    phase.includes('rag_missing_fallback') ||
    phase.includes('token_budget_fallback')
  );
}

function replyLooksLikeMediaPostSend(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return (
    /\b(enviei|mandei|anexei|segue|esta aqui|esta ai)\b/.test(normalized) &&
    /\b(material|arquivo|documento|book|foto|imagem|imagens|video|videos|link)\b/.test(normalized)
  );
}

function replyAwaitsCustomerResponse(text: string): boolean {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (!/\?\s*$/.test(raw)) return false;
  const normalized = normalizeText(raw);
  if (/\b(visita|agendamento)\b/.test(normalized) && /\b(confirmad[ao]|agendad[ao]|marcad[ao])\b/.test(normalized)) {
    return false;
  }
  if (replyLooksLikeMediaPostSend(raw)) return false;
  return true;
}

function hasConfirmedVisit(flowState: CommercialFlowState | null): boolean {
  return flowState?.visitScheduling?.status === 'scheduled';
}

function hasActiveVisitFlow(flowState: CommercialFlowState | null): boolean {
  return flowState?.pendingVisitScheduling === true || flowState?.visitScheduling?.active === true;
}

export function resolveAnaGeneralFollowupStartDecision(
  params: AnaGeneralFollowupStartParams
): AnaGeneralFollowupStartDecision {
  const conversation = params.conversation ?? null;
  const flowState = parseCommercialFlowState(params.commercialFlowState);
  const classification = String(conversation?.classification ?? '').trim();

  if (!conversation) {
    return { eligible: false, reason: 'conversation_not_found', cancelExisting: false };
  }
  if (String(conversation.channel ?? '').trim().toLowerCase() !== 'whatsapp') {
    return { eligible: false, reason: 'non_whatsapp_conversation', cancelExisting: false };
  }
  if (isInternalConversationType(conversation.conversation_type)) {
    return { eligible: false, reason: 'internal_conversation', cancelExisting: true, cancelReason: 'internal_conversation' };
  }
  if (isAnaAutomationBlockedByHandoff(conversation)) {
    return { eligible: false, reason: 'handoff', cancelExisting: true, cancelReason: 'handoff' };
  }
  if (classification === 'Carteira') {
    return { eligible: false, reason: 'carteira', cancelExisting: true, cancelReason: 'carteira' };
  }
  if (conversation.manual_closed_at != null) {
    return { eligible: false, reason: 'manual_closed', cancelExisting: true, cancelReason: 'manual_closed' };
  }
  if (conversation.assigned_broker_id != null) {
    return { eligible: false, reason: 'assigned_broker', cancelExisting: true, cancelReason: 'assigned_broker' };
  }
  if (hasConfirmedVisit(flowState)) {
    return { eligible: false, reason: 'visit_scheduled', cancelExisting: true, cancelReason: 'visit_scheduled' };
  }
  if (hasActiveVisitFlow(flowState)) {
    return { eligible: false, reason: 'visit_flow_active', cancelExisting: false };
  }
  if (flowState?.pending_action === 'send_material') {
    return { eligible: false, reason: 'material_flow_pending', cancelExisting: false };
  }
  if (sourcePhaseBlocksGeneralFollowup(params.sourcePhase)) {
    return { eligible: false, reason: 'source_phase_not_eligible', cancelExisting: false };
  }
  if (params.assistantMessageId == null) {
    return { eligible: false, reason: 'missing_assistant_message_id', cancelExisting: false };
  }
  if (params.lastUserMessageId == null) {
    return { eligible: false, reason: 'missing_last_user_message_id', cancelExisting: false };
  }
  const anchorMs = params.assistantCreatedAt.getTime();
  if (Number.isNaN(anchorMs)) {
    return { eligible: false, reason: 'invalid_assistant_created_at', cancelExisting: false };
  }
  if (isAnaGeneralFollowupBeforeCutover({ assistantCreatedAt: params.assistantCreatedAt })) {
    return { eligible: false, reason: 'before_cutover', cancelExisting: false };
  }
  if (!replyAwaitsCustomerResponse(params.finalReplyText)) {
    return { eligible: false, reason: 'reply_not_waiting_customer', cancelExisting: false };
  }

  const rawFirstAttemptAt = new Date(anchorMs + getAnaFollowupDelayMinutes(1) * 60_000);
  const nextFollowupAt = computeAnaFollowupAtUtc({
    anchor: params.assistantCreatedAt,
    attemptIndex: 1,
  });
  return {
    eligible: true,
    nextFollowupAt,
    rawFirstAttemptAt,
    quietHoursAdjusted:
      nextFollowupAt.getTime() > rawFirstAttemptAt.getTime() &&
      isAnaFollowupForbiddenNightWindowSp(rawFirstAttemptAt.getTime()),
    reason: 'awaiting_customer_reply',
  };
}

export async function cancelAnaGeneralFollowupForConversation(params: {
  conversationId: number;
  reason: string;
  source?: string | null;
}): Promise<void> {
  await query(
    `UPDATE conversations
        SET ana_followup_status = 'cancelled',
            ana_followup_next_at = NULL,
            ana_followup_cancel_reason = $2,
            updated_at = NOW()
      WHERE id = $1`,
    [params.conversationId, params.reason]
  );
  console.log('[ANA_GENERAL_FOLLOWUP] cancelled', {
    conversationId: params.conversationId,
    reason: params.reason,
    source: params.source ?? null,
  });
}

export async function startAnaGeneralFollowupIfEligible(
  params: AnaGeneralFollowupStartParams
): Promise<AnaGeneralFollowupStartDecision> {
  const conversation = params.conversation ?? (await getConversationById(params.conversationId));
  const decision = resolveAnaGeneralFollowupStartDecision({
    ...params,
    conversation,
  });

  if (!decision.eligible) {
    if (decision.reason === 'handoff' && conversation) {
      logAnaAutomationBlockedByHandoff(conversation, {
        conversationId: params.conversationId,
        automationType: 'general_followup',
        blockedAt: 'before_enqueue',
        source: params.sourcePhase ?? 'ana_general_followup_start',
      });
    }
    console.log('[ANA_GENERAL_FOLLOWUP] not_eligible', {
      conversationId: params.conversationId,
      enterpriseId: params.enterpriseId ?? null,
      assistantMessageId: params.assistantMessageId ?? null,
      lastUserMessageId: params.lastUserMessageId ?? null,
      reason: decision.reason,
      sourcePhase: params.sourcePhase ?? null,
    });
    if (decision.cancelExisting) {
      await cancelAnaGeneralFollowupForConversation({
        conversationId: params.conversationId,
        reason: decision.cancelReason ?? decision.reason,
        source: params.sourcePhase ?? 'start_not_eligible',
      });
    }
    return decision;
  }

  const result = await query(
    `UPDATE conversations
        SET ana_followup_status = 'active',
            ana_followup_anchor_assistant_message_id = $2,
            ana_followup_anchor_assistant_created_at = $3,
            ana_followup_for_user_message_id = $4::bigint,
            ana_followup_attempt_count = 0,
            ana_followup_last_attempt_at = NULL,
            ana_followup_last_sent_message_id = NULL,
            ana_followup_cancel_reason = NULL,
            ana_followup_next_at = $5,
            updated_at = NOW()
      WHERE id = $1
        AND COALESCE(handoff, false) = false
        AND lower(trim(COALESCE(classification, ''))) NOT IN ('handoff', 'carteira')
        AND manual_closed_at IS NULL`,
    [
      params.conversationId,
      params.assistantMessageId,
      params.assistantCreatedAt,
      params.lastUserMessageId,
      decision.nextFollowupAt,
    ]
  );

  if ((result.rowCount ?? 0) === 0) {
    console.log('[ANA_GENERAL_FOLLOWUP] not_eligible', {
      conversationId: params.conversationId,
      enterpriseId: params.enterpriseId ?? null,
      assistantMessageId: params.assistantMessageId,
      lastUserMessageId: params.lastUserMessageId,
      reason: 'state_changed_before_start',
      sourcePhase: params.sourcePhase ?? null,
    });
    return { eligible: false, reason: 'state_changed_before_start', cancelExisting: false };
  }

  if (decision.quietHoursAdjusted) {
    console.log('[ANA_GENERAL_FOLLOWUP] blocked_quiet_hours', {
      conversationId: params.conversationId,
      enterpriseId: params.enterpriseId ?? null,
      assistantMessageId: params.assistantMessageId,
      attemptIndex: 1,
      rawNextAt: decision.rawFirstAttemptAt.toISOString(),
      nextFollowupAt: decision.nextFollowupAt.toISOString(),
      source: 'start',
    });
  }

  console.log('[ANA_GENERAL_FOLLOWUP] started_or_kept_active', {
    conversationId: params.conversationId,
    enterpriseId: params.enterpriseId ?? null,
    assistantMessageId: params.assistantMessageId,
    assistantCreatedAt: params.assistantCreatedAt.toISOString(),
    lastUserMessageId: params.lastUserMessageId,
    attemptCount: 0,
    nextFollowupAt: decision.nextFollowupAt.toISOString(),
    sourcePhase: params.sourcePhase ?? null,
  });

  return decision;
}
