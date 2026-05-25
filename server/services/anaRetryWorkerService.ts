
function isAnaEmergencyRetryReengagementDisabled(): boolean {
  return process.env.ANA_DISABLE_RETRY_REENGAGEMENT !== 'false';
}
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

const WORKER_ID = `ana-retry-${process.pid}`;
let workerRunning = false;

async function shouldSkipJob(job: AnaRetryJobRow): Promise<{ skip: boolean; stale: boolean }> {
  if (job.trigger_message_id == null) return { skip: false, stale: false };
  const lastInbound = await getLastUserMessageRow(job.conversation_id);
  if (!lastInbound) return { skip: true, stale: true };
  if (lastInbound.id !== job.trigger_message_id) return { skip: true, stale: true };
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

