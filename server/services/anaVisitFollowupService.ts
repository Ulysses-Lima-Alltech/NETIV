import { getConversationById } from '../repositories/conversationRepository.js';
import { insertMessage } from '../repositories/messageRepository.js';
import {
  advanceAnaVisitFollowupJob,
  cancelActiveAnaVisitFollowupJobs,
  claimAnaVisitFollowupAttempt,
  hasOpenAppointmentForAnaVisitFollowup,
  hasUserMessageAfterAnaVisitFollowupAnchor,
  markAnaVisitFollowupAttemptFailed,
  markAnaVisitFollowupAttemptSent,
  markAnaVisitFollowupAttemptSkipped,
  markAnaVisitFollowupJobCancelled,
  markAnaVisitFollowupJobFailed,
  pickDueAnaVisitFollowupJob,
  revalidateAnaVisitFollowupJobForSend,
  upsertActiveAnaVisitFollowupJob,
  withAnaVisitFollowupConversationLock,
  type AnaVisitFollowupAttemptRow,
  type AnaVisitFollowupJobRow,
} from '../repositories/anaVisitFollowupJobRepository.js';
import { getMessageCreatedAtById } from '../repositories/messageRepository.js';
import { parseCommercialFlowState, type CommercialFlowState } from '../utils/commercialFlowState.js';
import {
  ANA_VISIT_FOLLOWUP_MIN_GAP_AFTER_SEND_MS,
  computeAnaVisitFollowupNextRunAt,
  getAnaVisitFollowupMessage,
  shouldStartAnaVisitFollowup,
} from '../utils/anaVisitFollowupCadence.js';
import { sendAnaTextMessageWithQuota } from './anaOutboundQuotaService.js';
import { getAnaAutomationPauseReason } from '../utils/anaAutomationKillSwitch.js';
import {
  isAnaAutomationBlockedByHandoff,
  logAnaAutomationBlockedByHandoff,
} from '../utils/anaAutomationEligibility.js';

const WORKER_ID = `ana-visit-followup-${process.pid}`;
let visitFollowupWorkerRunning = false;

function phoneForConversation(conv: Awaited<ReturnType<typeof getConversationById>>): string | null {
  const raw = (conv?.contact_phone || conv?.external_contact_id || '').trim();
  const digits = raw.replace(/\D/g, '');
  return digits.length >= 10 ? raw : null;
}

function automationBlockedReason(conv: Awaited<ReturnType<typeof getConversationById>>): string | null {
  if (!conv) return 'conversation_not_found';
  if (isAnaAutomationBlockedByHandoff(conv)) return 'handoff';
  if (conv.classification === 'Carteira') return 'carteira';
  if (conv.manual_closed_at != null) return 'manual_closed';
  if ((conv.conversation_type ?? 'CLIENT') !== 'CLIENT') return 'non_client_conversation';
  return null;
}

function logVisitFollowupKillSwitchSkip(reason: string, conversationId: number | null = null): void {
  if (reason === 'ana_automation_disabled') {
    console.log('[ANA_AUTOMATION_SKIP]', {
      reason: 'ana_automation_disabled',
      source: 'ana_visit_followup',
      conversationId,
    });
    return;
  }
  if (reason === 'ana_outbound_disabled') {
    console.log('[ANA_OUTBOUND_BLOCKED]', {
      reason: 'ana_outbound_disabled',
      source: 'ana_visit_followup',
      conversationId,
    });
    return;
  }
  console.log('[ANA_VISIT_FOLLOWUP] skipped_kill_switch', {
    reason,
    conversationId,
  });
}

function visitStateAllowsFollowup(flowState: CommercialFlowState | null): boolean {
  if (!flowState) return false;
  if (flowState.visitScheduling?.status === 'scheduled') return false;
  return flowState.pendingVisitScheduling === true || flowState.visitScheduling?.active === true;
}

function parseOptionalDate(value: string | null | undefined): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export async function startAnaVisitFollowupIfEligible(params: {
  conversationId: number;
  flowState: CommercialFlowState | null | undefined;
  replyText: string;
  anchorAssistantMessageId: number | null;
  missingSlot?: string | null;
  now?: Date;
}): Promise<void> {
  const killSwitchReason = getAnaAutomationPauseReason();
  if (killSwitchReason) {
    logVisitFollowupKillSwitchSkip(killSwitchReason, params.conversationId);
    return;
  }

  const conversation = await getConversationById(params.conversationId);
  if (isAnaAutomationBlockedByHandoff(conversation)) {
    logAnaAutomationBlockedByHandoff(conversation!, {
      conversationId: params.conversationId,
      automationType: 'visit_followup',
      blockedAt: 'before_enqueue',
      source: 'ana_visit_followup_start',
    });
    return;
  }

  if (
    !shouldStartAnaVisitFollowup({
      flowState: params.flowState,
      replyText: params.replyText,
      missingSlot: params.missingSlot ?? null,
    })
  ) {
    return;
  }
  const anchorCreatedAt =
    params.now == null && params.anchorAssistantMessageId != null
      ? await getMessageCreatedAtById(params.anchorAssistantMessageId)
      : null;
  const startedAt = params.now ?? anchorCreatedAt ?? new Date();
  const nextRunAt = computeAnaVisitFollowupNextRunAt({
    anchor: startedAt,
    nextAttemptIndex: 1,
  });
  if (!nextRunAt) return;

  const job = await upsertActiveAnaVisitFollowupJob({
    conversationId: params.conversationId,
    startedAt,
    nextRunAt,
    anchorAssistantMessageId: params.anchorAssistantMessageId,
    suggestedVisitStartAt: parseOptionalDate(params.flowState?.suggestedVisitStartAt ?? null),
    suggestedVisitEndAt: parseOptionalDate(params.flowState?.suggestedVisitEndAt ?? null),
    suggestedBrokerId: params.flowState?.suggestedVisitBrokerId ?? null,
    suggestedSlotLabel: params.flowState?.suggestedVisitSlotLabel ?? null,
    timezone: params.flowState?.suggestedVisitTimezone ?? null,
    suggestionStatus: params.flowState?.suggestedVisitStatus ?? null,
  });
  if (!job) {
    const latestConversation = await getConversationById(params.conversationId);
    if (isAnaAutomationBlockedByHandoff(latestConversation)) {
      logAnaAutomationBlockedByHandoff(latestConversation!, {
        conversationId: params.conversationId,
        automationType: 'visit_followup',
        blockedAt: 'before_enqueue',
        source: 'ana_visit_followup_atomic_guard',
      });
    }
    return;
  }
  console.log('[ANA_VISIT_FOLLOWUP] started_or_kept_active', {
    conversationId: params.conversationId,
    jobId: job.id,
    nextRunAt: job.next_run_at.toISOString(),
    nextAttemptIndex: job.next_attempt_index,
    anchorAssistantMessageId: job.anchor_assistant_message_id,
  });
}

export async function cancelAnaVisitFollowupForConversation(params: {
  conversationId: number;
  reason: string;
}): Promise<void> {
  const cancelled = await cancelActiveAnaVisitFollowupJobs(params);
  if (cancelled > 0) {
    console.log('[ANA_VISIT_FOLLOWUP] cancelled', {
      conversationId: params.conversationId,
      reason: params.reason,
      cancelled,
    });
  }
}

async function cancelJob(job: AnaVisitFollowupJobRow, reason: string): Promise<void> {
  const cancelled = await markAnaVisitFollowupJobCancelled({ jobId: job.id, reason });
  if (!cancelled) {
    console.log('[ANA_VISIT_FOLLOWUP] job_cancel_skipped', {
      jobId: job.id,
      conversationId: job.conversation_id,
      reason,
    });
    return;
  }
  console.log('[ANA_VISIT_FOLLOWUP] job_cancelled', {
    jobId: job.id,
    conversationId: job.conversation_id,
    reason,
  });
}

async function advanceAfterClaimedDuplicate(
  job: AnaVisitFollowupJobRow,
  attempt: AnaVisitFollowupAttemptRow
): Promise<void> {
  if (attempt.status === 'claimed') {
    await markAnaVisitFollowupAttemptSkipped({
      attemptId: attempt.id,
      reason: 'stale_claim_reclaimed_without_resend',
    });
  }
  if (attempt.status === 'failed') {
    await markAnaVisitFollowupJobFailed({
      jobId: job.id,
      error: attempt.error || 'attempt_failed',
      workerId: WORKER_ID,
    });
    return;
  }

  const nextAttemptIndex = job.next_attempt_index + 1;
  const notBefore = new Date(Date.now() + ANA_VISIT_FOLLOWUP_MIN_GAP_AFTER_SEND_MS);
  const nextRunAt = computeAnaVisitFollowupNextRunAt({
    anchor: job.started_at,
    nextAttemptIndex,
    notBefore,
  });
  const advanced = await advanceAnaVisitFollowupJob({
    jobId: job.id,
    workerId: WORKER_ID,
    sentAttemptIndex: job.next_attempt_index,
    lastSentMessageId: attempt.assistant_message_id ?? null,
    nextRunAt,
  });
  if (!advanced) {
    console.log('[ANA_VISIT_FOLLOWUP] stale_duplicate_advance_skipped', {
      jobId: job.id,
      conversationId: job.conversation_id,
      attemptIndex: job.next_attempt_index,
    });
  }
}

async function processOneAnaVisitFollowupJob(job: AnaVisitFollowupJobRow): Promise<void> {
  const killSwitchReason = getAnaAutomationPauseReason();
  if (killSwitchReason) {
    logVisitFollowupKillSwitchSkip(killSwitchReason, job.conversation_id);
    await cancelJob(job, killSwitchReason);
    return;
  }

  const conv = await getConversationById(job.conversation_id);
  const blockedReason = automationBlockedReason(conv);
  if (blockedReason) {
    if (blockedReason === 'handoff' && conv) {
      logAnaAutomationBlockedByHandoff(conv, {
        conversationId: job.conversation_id,
        automationType: 'visit_followup',
        blockedAt: 'worker_start',
        source: 'ana_visit_followup_worker',
      });
    }
    await cancelJob(job, blockedReason);
    return;
  }

  const flowState = parseCommercialFlowState(conv?.commercial_flow_state) ?? null;
  if (!visitStateAllowsFollowup(flowState)) {
    await cancelJob(job, flowState?.visitScheduling?.status === 'scheduled' ? 'visit_scheduled' : 'visit_flow_inactive');
    return;
  }

  if (await hasOpenAppointmentForAnaVisitFollowup(job.conversation_id)) {
    await cancelJob(job, 'appointment_exists');
    return;
  }

  if (await hasUserMessageAfterAnaVisitFollowupAnchor(job)) {
    await cancelJob(job, 'customer_replied');
    return;
  }

  const to = phoneForConversation(conv);
  if (!to) {
    await cancelJob(job, 'missing_customer_phone');
    return;
  }

  const attemptIndex = job.next_attempt_index;
  const suggestedSlotLabel = job.suggested_slot_label ?? flowState?.suggestedVisitSlotLabel ?? null;
  const messageText = getAnaVisitFollowupMessage(attemptIndex, suggestedSlotLabel);
  if (!messageText) {
    await cancelJob(job, 'followup_cycle_exhausted');
    return;
  }

  const claim = await claimAnaVisitFollowupAttempt({
    jobId: job.id,
    conversationId: job.conversation_id,
    attemptIndex,
    messageText,
  });
  if (!claim.claimed) {
    if (claim.attempt) {
      await advanceAfterClaimedDuplicate(job, claim.attempt);
      return;
    }
    await markAnaVisitFollowupJobFailed({
      jobId: job.id,
      error: 'attempt_claim_conflict_without_row',
      workerId: WORKER_ID,
    });
    return;
  }

  try {
    await withAnaVisitFollowupConversationLock(job.conversation_id, async () => {
      const readiness = await revalidateAnaVisitFollowupJobForSend({
        jobId: job.id,
        conversationId: job.conversation_id,
        workerId: WORKER_ID,
        attemptIndex,
      });
      if (!readiness.ok) {
        await markAnaVisitFollowupAttemptSkipped({
          attemptId: claim.attempt.id,
          reason: `final_revalidation_${readiness.reason}`,
        });
        if (
          ![
            'job_not_found',
            'job_not_processing',
            'job_lock_lost',
            'conversation_mismatch',
            'attempt_index_changed',
          ].includes(readiness.reason)
        ) {
          await cancelJob(job, readiness.reason);
        }
        console.log('[ANA_VISIT_FOLLOWUP] final_revalidation_blocked_send', {
          jobId: job.id,
          conversationId: job.conversation_id,
          attemptIndex,
          reason: readiness.reason,
        });
        return;
      }

      const finalKillSwitchReason = getAnaAutomationPauseReason();
      if (finalKillSwitchReason) {
        logVisitFollowupKillSwitchSkip(finalKillSwitchReason, job.conversation_id);
        await markAnaVisitFollowupAttemptSkipped({
          attemptId: claim.attempt.id,
          reason: finalKillSwitchReason,
        });
        await cancelJob(job, finalKillSwitchReason);
        return;
      }

      const send = await sendAnaTextMessageWithQuota({
        conversationId: job.conversation_id,
        to,
        text: messageText,
        phase: 'ana_visit_scheduling_followup',
      });
      if (!send.success || !send.metaMessageId) {
        await markAnaVisitFollowupAttemptFailed({
          attemptId: claim.attempt.id,
          error: send.error ?? 'send_failed',
        });
        await markAnaVisitFollowupJobFailed({
          jobId: job.id,
          error: send.error ?? 'send_failed',
          workerId: WORKER_ID,
        });
        return;
      }

      const inserted = await insertMessage(job.conversation_id, 'assistant', messageText, send.metaMessageId);
      await markAnaVisitFollowupAttemptSent({
        attemptId: claim.attempt.id,
        metaMessageId: send.metaMessageId,
        assistantMessageId: inserted.id,
      });

      const nextAttemptIndex = attemptIndex + 1;
      const notBefore = new Date(Date.now() + ANA_VISIT_FOLLOWUP_MIN_GAP_AFTER_SEND_MS);
      const nextRunAt = computeAnaVisitFollowupNextRunAt({
        anchor: readiness.job.started_at,
        nextAttemptIndex,
        notBefore,
      });
      const advanced = await advanceAnaVisitFollowupJob({
        jobId: job.id,
        workerId: WORKER_ID,
        sentAttemptIndex: attemptIndex,
        lastSentMessageId: inserted.id,
        nextRunAt,
      });

      if (!advanced) {
        console.log('[ANA_VISIT_FOLLOWUP] advance_skipped_after_send', {
          jobId: job.id,
          conversationId: job.conversation_id,
          attemptIndex,
        });
        return;
      }

      console.log('[ANA_VISIT_FOLLOWUP] sent', {
        jobId: job.id,
        conversationId: job.conversation_id,
        attemptIndex,
        nextRunAt: nextRunAt?.toISOString() ?? null,
      });
    });
  } catch (error) {
    await markAnaVisitFollowupAttemptFailed({
      attemptId: claim.attempt.id,
      error,
    });
    await markAnaVisitFollowupJobFailed({
      jobId: job.id,
      error,
      workerId: WORKER_ID,
    });
  }
}

export async function processAnaVisitFollowupTick(): Promise<void> {
  const killSwitchReason = getAnaAutomationPauseReason();
  if (killSwitchReason) {
    logVisitFollowupKillSwitchSkip(killSwitchReason);
    return;
  }

  if (visitFollowupWorkerRunning) return;
  visitFollowupWorkerRunning = true;
  try {
    for (;;) {
      const job = await pickDueAnaVisitFollowupJob(WORKER_ID);
      if (!job) break;
      await processOneAnaVisitFollowupJob(job);
    }
  } finally {
    visitFollowupWorkerRunning = false;
  }
}
