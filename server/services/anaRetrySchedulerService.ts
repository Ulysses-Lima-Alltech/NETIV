import { upsertAnaRetryJob } from '../repositories/anaRetryJobRepository.js';
import {
  computeRetryDelayMs,
  extractRetryAfterMs,
  mapRetryReason,
  sanitizeRetryErrorMessage,
} from '../utils/llmRetry.js';

export async function scheduleAnaRetry(params: {
  conversationId: number;
  triggerMessageId: number | null;
  error: unknown;
  attemptCount?: number;
  reasonOverride?: string;
}): Promise<void> {
  const retryAfterMsRaw = extractRetryAfterMs(params.error);
  const retryAfterMs = computeRetryDelayMs({
    attemptCount: params.attemptCount ?? 0,
    hasExplicitRetryAfter: retryAfterMsRaw != null,
    retryAfterMs: retryAfterMsRaw,
    error: params.error,
  });
  const nextRunAt = new Date(Date.now() + retryAfterMs + 500);
  const reason = params.reasonOverride ?? mapRetryReason(params.error);

  await upsertAnaRetryJob({
    conversationId: params.conversationId,
    triggerMessageId: params.triggerMessageId,
    reason,
    nextRunAt,
    lastError: sanitizeRetryErrorMessage(params.error),
    lastErrorCode: null,
  });

  console.log('[ANA_RETRY] scheduled', {
    conversationId: params.conversationId,
    triggerMessageId: params.triggerMessageId,
    reason,
    retryAfterMs,
    nextRunAt: nextRunAt.toISOString(),
  });
}
