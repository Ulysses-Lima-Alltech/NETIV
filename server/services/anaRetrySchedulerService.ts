
import { upsertAnaRetryJob } from '../repositories/anaRetryJobRepository.js';
import {
  computeRetryDelayMs,
  extractRetryAfterMs,
  mapRetryReason,
  sanitizeRetryErrorMessage,
} from '../utils/llmRetry.js';
import { getAnaAutomationPauseReason } from '../utils/anaAutomationKillSwitch.js';
import { getConversationById } from '../repositories/conversationRepository.js';
import {
  isAnaAutomationBlockedByHandoff,
  logAnaAutomationBlockedByHandoff,
} from '../utils/anaHandoffPolicy.js';

export async function scheduleAnaRetry(params: {
  conversationId: number;
  triggerMessageId: number | null;
  error: unknown;
  attemptCount?: number;
  reasonOverride?: string;
}): Promise<void> {
  const conversation = await getConversationById(params.conversationId);
  if (isAnaAutomationBlockedByHandoff(conversation)) {
    logAnaAutomationBlockedByHandoff(conversation!, {
      conversationId: params.conversationId,
      automationType: 'retry',
      blockedAt: 'before_enqueue',
      source: 'ana_retry_scheduler',
    });
    return;
  }
  const killSwitchReason = getAnaAutomationPauseReason();
  if (killSwitchReason) {
    if (killSwitchReason === 'ana_emergency_handoff_active') {
      console.log('[ANA_RETRY_SKIP]', {
        reason: 'ana_emergency_handoff_active',
        conversationId: params.conversationId,
        triggerMessageId: params.triggerMessageId,
      });
    } else if (killSwitchReason === 'ana_automation_disabled') {
      console.log('[ANA_AUTOMATION_SKIP]', {
        reason: 'ana_automation_disabled',
        source: 'ana_retry_scheduler',
        conversationId: params.conversationId,
      });
    } else {
      console.log('[ANA_OUTBOUND_BLOCKED]', {
        reason: 'ana_outbound_disabled',
        source: 'ana_retry_scheduler',
        conversationId: params.conversationId,
      });
    }
    return;
  }

  const retryAfterMsRaw = extractRetryAfterMs(params.error);
  const retryAfterMs = computeRetryDelayMs({
    attemptCount: params.attemptCount ?? 0,
    hasExplicitRetryAfter: retryAfterMsRaw != null,
    retryAfterMs: retryAfterMsRaw,
    error: params.error,
  });
  const nextRunAt = new Date(Date.now() + retryAfterMs + 500);
  const reason = params.reasonOverride ?? mapRetryReason(params.error);

  const job = await upsertAnaRetryJob({
    conversationId: params.conversationId,
    triggerMessageId: params.triggerMessageId,
    reason,
    nextRunAt,
    lastError: sanitizeRetryErrorMessage(params.error),
    lastErrorCode: null,
  });

  if (!job) {
    const latestConversation = await getConversationById(params.conversationId);
    if (isAnaAutomationBlockedByHandoff(latestConversation)) {
      logAnaAutomationBlockedByHandoff(latestConversation!, {
        conversationId: params.conversationId,
        automationType: 'retry',
        blockedAt: 'before_enqueue',
        source: 'ana_retry_scheduler_atomic_guard',
      });
    }
    return;
  }

  console.log('[ANA_RETRY] scheduled', {
    conversationId: params.conversationId,
    triggerMessageId: params.triggerMessageId,
    reason,
    retryAfterMs,
    nextRunAt: nextRunAt.toISOString(),
  });
}

