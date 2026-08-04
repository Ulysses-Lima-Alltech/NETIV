import { query } from '../db/pg.js';

export type AnaRetryJobStatus = 'pending' | 'processing' | 'completed' | 'failed_non_retryable';

export interface AnaRetryJobRow {
  id: number;
  conversation_id: number;
  trigger_message_id: number | null;
  status: AnaRetryJobStatus;
  reason: string | null;
  attempt_count: number;
  next_run_at: Date;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  last_error_code: string | null;
  created_at: Date;
  updated_at: Date;
}

export async function upsertAnaRetryJob(params: {
  conversationId: number;
  triggerMessageId: number | null;
  reason: string;
  nextRunAt: Date;
  lastError?: string | null;
  lastErrorCode?: string | null;
}): Promise<AnaRetryJobRow | null> {
  if (params.triggerMessageId != null) {
    const { rows } = await query<AnaRetryJobRow>(
      `INSERT INTO ana_retry_jobs (
         conversation_id, trigger_message_id, status, reason, next_run_at, last_error, last_error_code, updated_at
       )
       SELECT $1, $2, 'pending', $3, $4, $5, $6, NOW()
       FROM conversations c
       WHERE c.id = $1
         AND COALESCE(c.handoff, false) = false
         AND lower(trim(COALESCE(c.classification, ''))) <> 'handoff'
       ON CONFLICT (conversation_id, trigger_message_id)
         WHERE trigger_message_id IS NOT NULL AND status IN ('pending', 'processing')
       DO UPDATE SET
         reason = EXCLUDED.reason,
         next_run_at = LEAST(ana_retry_jobs.next_run_at, EXCLUDED.next_run_at),
         last_error = EXCLUDED.last_error,
         last_error_code = EXCLUDED.last_error_code,
         updated_at = NOW()
       RETURNING *`,
      [
        params.conversationId,
        params.triggerMessageId,
        params.reason,
        params.nextRunAt,
        params.lastError ?? null,
        params.lastErrorCode ?? null,
      ]
    );
    return rows[0] ?? null;
  }

  const { rows } = await query<AnaRetryJobRow>(
    `INSERT INTO ana_retry_jobs (
       conversation_id, trigger_message_id, status, reason, next_run_at, last_error, last_error_code, updated_at
     )
     SELECT $1, NULL, 'pending', $2, $3, $4, $5, NOW()
     FROM conversations c
     WHERE c.id = $1
       AND COALESCE(c.handoff, false) = false
       AND lower(trim(COALESCE(c.classification, ''))) <> 'handoff'
     RETURNING *`,
    [params.conversationId, params.reason, params.nextRunAt, params.lastError ?? null, params.lastErrorCode ?? null]
  );
  return rows[0] ?? null;
}

export async function pickNextAnaRetryJob(workerId: string): Promise<AnaRetryJobRow | null> {
  const { rows } = await query<AnaRetryJobRow>(
    `WITH candidate AS (
       SELECT id
       FROM ana_retry_jobs
     WHERE status = 'pending'
       AND next_run_at <= NOW()
       AND NOT EXISTS (
         SELECT 1
         FROM ana_retry_jobs j2
         WHERE j2.conversation_id = ana_retry_jobs.conversation_id
           AND j2.status = 'processing'
           AND j2.id <> ana_retry_jobs.id
       )
      ORDER BY next_run_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE ana_retry_jobs j
     SET status = 'processing',
         locked_at = NOW(),
         locked_by = $1,
         updated_at = NOW()
     FROM candidate
     WHERE j.id = candidate.id
     RETURNING j.*`,
    [workerId]
  );
  return rows[0] ?? null;
}

export async function markAnaRetryJobCompleted(jobId: number): Promise<void> {
  await query(
    `UPDATE ana_retry_jobs
     SET status = 'completed', updated_at = NOW(), locked_at = NULL, locked_by = NULL
     WHERE id = $1`,
    [jobId]
  );
}

export async function markAnaRetryJobFailedNonRetryable(params: {
  jobId: number;
  errorMessage: string | null;
  errorCode: string | null;
}): Promise<void> {
  await query(
    `UPDATE ana_retry_jobs
     SET status = 'failed_non_retryable',
         updated_at = NOW(),
         locked_at = NULL,
         locked_by = NULL,
         last_error = $2,
         last_error_code = $3
     WHERE id = $1`,
    [params.jobId, params.errorMessage, params.errorCode]
  );
}

export async function rescheduleAnaRetryJob(params: {
  jobId: number;
  nextRunAt: Date;
  reason: string;
  errorMessage: string | null;
  errorCode: string | null;
}): Promise<void> {
  await query(
    `UPDATE ana_retry_jobs
     SET status = 'pending',
         attempt_count = attempt_count + 1,
         reason = $2,
         next_run_at = $3,
         last_error = $4,
         last_error_code = $5,
         locked_at = NULL,
         locked_by = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [params.jobId, params.reason, params.nextRunAt, params.errorMessage, params.errorCode]
  );
}
