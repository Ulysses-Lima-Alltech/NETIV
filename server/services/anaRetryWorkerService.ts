
import { getConversationById } from '../repositories/conversationRepository.js';
import {
  getLastUserMessageRow,
  hasAssistantMessageAfterMessageId,
} from '../repositories/messageRepository.js';
import {
  markAnaRetryJobCompleted,
  markAnaRetryJobFailedNonRetryable,
  pickNextAnaRetryJob,
  rescheduleAnaRetryJob,
  type AnaRetryJobRow,
} from '../repositories/anaRetryJobRepository.js';
import { reprocessLastUserMessage } from './conversationEngine.js';
import {
  computeRetryDelayMs,
  extractRetryAfterMs,
  isRetryableLlmError,
  mapRetryReason,
  sanitizeRetryErrorMessage,
} from '../utils/llmRetry.js';
import { getAnaAutomationPauseReason } from '../utils/anaAutomationKillSwitch.js';
import {
  isAnaAutomationBlockedByHandoff,
  logAnaAutomationBlockedByHandoff,
} from '../utils/anaAutomationEligibility.js';

const WORKER_ID = `ana-retry-${process.pid}`;
let workerRunning = false;

function automationBlockedReason(conv: Awaited<ReturnType<typeof getConversationById>>): string | null {
  if (!conv) return 'conversation_not_found';
  if (isAnaAutomationBlockedByHandoff(conv)) return 'handoff';
  if (conv.classification === 'Carteira') return 'carteira';
  if (conv.manual_closed_at != null) return 'manual_closed';
  return null;
}

function sameDbId(a: unknown, b: unknown): boolean {
  if (a == null || b == null) return false;
  return String(a) === String(b);
}

function logRetryKillSwitchSkip(reason: string, conversationId: number | null = null): void {
  if (reason === 'ana_emergency_handoff_active') {
    console.log('[ANA_RETRY_SKIP]', { reason: 'ana_emergency_handoff_active', conversationId });
    return;
  }
  if (reason === 'ana_automation_disabled') {
    console.log('[ANA_AUTOMATION_SKIP]', {
      reason: 'ana_automation_disabled',
      source: 'ana_retry_worker',
      conversationId,
    });
    console.log('[ANA_RETRY_SKIP]', { reason, conversationId });
    return;
  }
  if (reason === 'ana_outbound_disabled') {
    console.log('[ANA_OUTBOUND_BLOCKED]', {
      reason: 'ana_outbound_disabled',
      source: 'ana_retry_worker',
      conversationId,
    });
    console.log('[ANA_RETRY_SKIP]', { reason, conversationId });
  }
}

async function shouldSkipJob(job: AnaRetryJobRow): Promise<{ skip: boolean; stale: boolean }> {
  if (job.trigger_message_id == null) return { skip: false, stale: false };
  const lastInbound = await getLastUserMessageRow(job.conversation_id);
  if (!lastInbound) return { skip: true, stale: true };
  if (!sameDbId(lastInbound.id, job.trigger_message_id)) return { skip: true, stale: true };
  const alreadyAnswered = await hasAssistantMessageAfterMessageId(job.conversation_id, lastInbound.id);
  if (alreadyAnswered) return { skip: true, stale: false };
  return { skip: false, stale: false };
}

async function processOneJob(job: AnaRetryJobRow): Promise<void> {
  const conv = await getConversationById(job.conversation_id);
  if (!conv) {
    await markAnaRetryJobFailedNonRetryable({
      jobId: job.id,
      errorMessage: 'conversation_not_found',
      errorCode: 'conversation_not_found',
    });
    return;
  }

  const blockedReason = automationBlockedReason(conv);
  if (blockedReason) {
    if (blockedReason === 'handoff') {
      logAnaAutomationBlockedByHandoff(conv, {
        conversationId: job.conversation_id,
        automationType: 'retry',
        blockedAt: 'worker_start',
        source: 'ana_retry_worker_start',
        jobId: job.id,
      });
    }
    console.log('[ANA_RETRY] skipped_automation_blocked', {
      jobId: job.id,
      conversationId: job.conversation_id,
      triggerMessageId: job.trigger_message_id,
      reason: blockedReason,
    });
    await markAnaRetryJobFailedNonRetryable({
      jobId: job.id,
      errorMessage: blockedReason,
      errorCode: blockedReason,
    });
    return;
  }

  const skipState = await shouldSkipJob(job);
  if (skipState.skip) {
    console.log('[ANA_RETRY] skipped_already_answered', {
      conversationId: job.conversation_id,
      triggerMessageId: job.trigger_message_id,
      stale: skipState.stale,
    });
    await markAnaRetryJobCompleted(job.id);
    return;
  }

  console.log('[ANA_RETRY] processing', {
    jobId: job.id,
    conversationId: job.conversation_id,
    triggerMessageId: job.trigger_message_id,
    attemptCount: job.attempt_count,
    reason: job.reason,
  });

  try {
    await reprocessLastUserMessage(job.conversation_id);
    await markAnaRetryJobCompleted(job.id);
    console.log('[ANA_RETRY] completed', {
      jobId: job.id,
      conversationId: job.conversation_id,
    });
  } catch (error) {
    if (isRetryableLlmError(error)) {
      const latestConversation = await getConversationById(job.conversation_id);
      if (isAnaAutomationBlockedByHandoff(latestConversation)) {
        logAnaAutomationBlockedByHandoff(latestConversation!, {
          conversationId: job.conversation_id,
          automationType: 'retry',
          blockedAt: 'before_reschedule',
          source: 'ana_retry_worker_reschedule_guard',
          jobId: job.id,
        });
        await markAnaRetryJobFailedNonRetryable({
          jobId: job.id,
          errorMessage: 'handoff',
          errorCode: 'handoff',
        });
        return;
      }
      const retryAfterMsRaw = extractRetryAfterMs(error);
      const retryAfterMs = computeRetryDelayMs({
        attemptCount: job.attempt_count,
        hasExplicitRetryAfter: retryAfterMsRaw != null,
        retryAfterMs: retryAfterMsRaw,
        error,
      });
      const nextRunAt = new Date(Date.now() + retryAfterMs + 500);
      const reason = mapRetryReason(error);
      await rescheduleAnaRetryJob({
        jobId: job.id,
        nextRunAt,
        reason,
        errorMessage: sanitizeRetryErrorMessage(error),
        errorCode: null,
      });
      console.log('[ANA_RETRY] rescheduled', {
        jobId: job.id,
        conversationId: job.conversation_id,
        triggerMessageId: job.trigger_message_id,
        attemptCount: job.attempt_count + 1,
        reason,
        retryAfterMs,
        nextRunAt: nextRunAt.toISOString(),
      });
      return;
    }

    await markAnaRetryJobFailedNonRetryable({
      jobId: job.id,
      errorMessage: sanitizeRetryErrorMessage(error),
      errorCode: 'non_retryable_error',
    });
    console.log('[ANA_RETRY] failed_non_retryable', {
      jobId: job.id,
      conversationId: job.conversation_id,
      triggerMessageId: job.trigger_message_id,
      error: sanitizeRetryErrorMessage(error),
    });
  }
}

export async function processAnaRetryJobsTick(): Promise<void> {
  const killSwitchReason = getAnaAutomationPauseReason();
  if (killSwitchReason) {
    logRetryKillSwitchSkip(killSwitchReason);
    return;
  }

  if (workerRunning) return;
  workerRunning = true;
  try {
    console.log('[ANA_RETRY] worker_started', { workerId: WORKER_ID });
    for (;;) {
      const job = await pickNextAnaRetryJob(WORKER_ID);
      if (!job) break;
      console.log('[ANA_RETRY] picked', {
        jobId: job.id,
        conversationId: job.conversation_id,
        triggerMessageId: job.trigger_message_id,
        attemptCount: job.attempt_count,
      });
      await processOneJob(job);
    }
  } finally {
    workerRunning = false;
  }
}

