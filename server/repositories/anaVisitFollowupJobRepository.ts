import { getPool, query } from '../db/pg.js';

export type AnaVisitFollowupJobStatus = 'active' | 'processing' | 'completed' | 'cancelled' | 'failed';
export type AnaVisitFollowupAttemptStatus = 'claimed' | 'sent' | 'failed' | 'skipped';

export interface AnaVisitFollowupJobRow {
  id: number;
  conversation_id: number;
  status: AnaVisitFollowupJobStatus;
  started_at: Date;
  next_run_at: Date;
  next_attempt_index: number;
  last_attempt_index: number;
  anchor_assistant_message_id: number | null;
  last_sent_message_id: number | null;
  cancel_reason: string | null;
  completed_at: Date | null;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AnaVisitFollowupAttemptRow {
  id: number;
  job_id: number;
  conversation_id: number;
  attempt_index: number;
  message_text: string;
  status: AnaVisitFollowupAttemptStatus;
  meta_message_id: string | null;
  assistant_message_id: number | null;
  error: string | null;
  claimed_at: Date;
  sent_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export type AnaVisitFollowupSendReadiness =
  | { ok: true; job: AnaVisitFollowupJobRow }
  | { ok: false; reason: string; job: AnaVisitFollowupJobRow | null };

const ANA_VISIT_FOLLOWUP_LOCK_NAMESPACE = 7_165_000_000_000n;

function anaVisitFollowupConversationLockKey(conversationId: number): string {
  return (ANA_VISIT_FOLLOWUP_LOCK_NAMESPACE + BigInt(Math.trunc(conversationId))).toString();
}

export async function withAnaVisitFollowupConversationLock<T>(
  conversationId: number,
  fn: () => Promise<T>
): Promise<T> {
  const lockKey = anaVisitFollowupConversationLockKey(conversationId);
  const client = await getPool().connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);
    const result = await fn();
    await client.query('COMMIT');
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query('ROLLBACK');
        transactionOpen = false;
      } catch (rollbackError) {
        console.error('[ANA_VISIT_FOLLOWUP] advisory_lock_rollback_failed', {
          conversationId,
          error: errorToMessage(rollbackError),
        });
      }
    }
    throw error;
  } finally {
    client.release();
  }
}

function errorToMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function upsertActiveAnaVisitFollowupJob(params: {
  conversationId: number;
  startedAt: Date;
  nextRunAt: Date;
  anchorAssistantMessageId: number | null;
}): Promise<AnaVisitFollowupJobRow> {
  const { rows } = await query<AnaVisitFollowupJobRow>(
    `INSERT INTO ana_visit_followup_jobs (
       conversation_id,
       status,
       started_at,
       next_run_at,
       next_attempt_index,
       last_attempt_index,
       anchor_assistant_message_id,
       updated_at
     )
     VALUES ($1, 'active', $2, $3, 1, 0, $4, NOW())
     ON CONFLICT (conversation_id)
       WHERE status IN ('active', 'processing')
     DO UPDATE SET
       updated_at = NOW()
     RETURNING *`,
    [params.conversationId, params.startedAt, params.nextRunAt, params.anchorAssistantMessageId]
  );
  return rows[0]!;
}

export async function cancelActiveAnaVisitFollowupJobs(params: {
  conversationId: number;
  reason: string;
}): Promise<number> {
  const result = await query(
    `UPDATE ana_visit_followup_jobs
        SET status = 'cancelled',
            cancel_reason = $2,
            completed_at = NOW(),
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
      WHERE conversation_id = $1
        AND status IN ('active', 'processing')`,
    [params.conversationId, params.reason]
  );
  return result.rowCount ?? 0;
}

export async function pickDueAnaVisitFollowupJob(workerId: string): Promise<AnaVisitFollowupJobRow | null> {
  const { rows } = await query<AnaVisitFollowupJobRow>(
    `WITH candidate AS (
       SELECT id
       FROM ana_visit_followup_jobs
       WHERE (
          status = 'active'
          AND next_run_at <= NOW()
        )
        OR (
          status = 'processing'
          AND locked_at < NOW() - INTERVAL '10 minutes'
        )
       ORDER BY next_run_at ASC, id ASC
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     UPDATE ana_visit_followup_jobs j
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

export async function claimAnaVisitFollowupAttempt(params: {
  jobId: number;
  conversationId: number;
  attemptIndex: number;
  messageText: string;
}): Promise<{ claimed: true; attempt: AnaVisitFollowupAttemptRow } | { claimed: false; attempt: AnaVisitFollowupAttemptRow | null }> {
  try {
    const { rows } = await query<AnaVisitFollowupAttemptRow>(
      `INSERT INTO ana_visit_followup_attempts (
         job_id, conversation_id, attempt_index, message_text, status, updated_at
       )
       VALUES ($1, $2, $3, $4, 'claimed', NOW())
       RETURNING *`,
      [params.jobId, params.conversationId, params.attemptIndex, params.messageText]
    );
    return { claimed: true, attempt: rows[0]! };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : '';
    if (code !== '23505') throw error;
    const existing = await getAnaVisitFollowupAttempt(params.jobId, params.attemptIndex);
    return { claimed: false, attempt: existing };
  }
}

export async function getAnaVisitFollowupAttempt(
  jobId: number,
  attemptIndex: number
): Promise<AnaVisitFollowupAttemptRow | null> {
  const { rows } = await query<AnaVisitFollowupAttemptRow>(
    `SELECT *
       FROM ana_visit_followup_attempts
      WHERE job_id = $1
        AND attempt_index = $2
      LIMIT 1`,
    [jobId, attemptIndex]
  );
  return rows[0] ?? null;
}

export async function markAnaVisitFollowupAttemptSent(params: {
  attemptId: number;
  metaMessageId: string;
  assistantMessageId: number;
}): Promise<void> {
  await query(
    `UPDATE ana_visit_followup_attempts
        SET status = 'sent',
            meta_message_id = $2,
            assistant_message_id = $3,
            sent_at = NOW(),
            updated_at = NOW()
      WHERE id = $1`,
    [params.attemptId, params.metaMessageId, params.assistantMessageId]
  );
}

export async function markAnaVisitFollowupAttemptFailed(params: {
  attemptId: number;
  error: unknown;
}): Promise<void> {
  await query(
    `UPDATE ana_visit_followup_attempts
        SET status = 'failed',
            error = $2,
            updated_at = NOW()
      WHERE id = $1`,
    [params.attemptId, errorToMessage(params.error).slice(0, 1000)]
  );
}

export async function markAnaVisitFollowupAttemptSkipped(params: {
  attemptId: number;
  reason: string;
}): Promise<void> {
  await query(
    `UPDATE ana_visit_followup_attempts
        SET status = 'skipped',
            error = $2,
            updated_at = NOW()
      WHERE id = $1
        AND status = 'claimed'`,
    [params.attemptId, params.reason]
  );
}

export async function advanceAnaVisitFollowupJob(params: {
  jobId: number;
  workerId: string;
  sentAttemptIndex: number;
  lastSentMessageId: number | null;
  nextRunAt: Date | null;
}): Promise<boolean> {
  if (params.nextRunAt == null) {
    const result = await query(
      `UPDATE ana_visit_followup_jobs
          SET status = 'completed',
              last_attempt_index = GREATEST(last_attempt_index, $2),
              next_attempt_index = 11,
              last_sent_message_id = COALESCE($3, last_sent_message_id),
              completed_at = NOW(),
              locked_at = NULL,
              locked_by = NULL,
              updated_at = NOW()
        WHERE id = $1
          AND status = 'processing'
          AND next_attempt_index = $2
          AND locked_by = $4`,
      [params.jobId, params.sentAttemptIndex, params.lastSentMessageId, params.workerId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  const result = await query(
    `UPDATE ana_visit_followup_jobs
        SET status = 'active',
            last_attempt_index = GREATEST(last_attempt_index, $2),
            next_attempt_index = $3,
            next_run_at = $4,
            last_sent_message_id = COALESCE($5, last_sent_message_id),
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND status = 'processing'
        AND next_attempt_index = $2
        AND locked_by = $6`,
    [
      params.jobId,
      params.sentAttemptIndex,
      params.sentAttemptIndex + 1,
      params.nextRunAt,
      params.lastSentMessageId,
      params.workerId,
    ]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markAnaVisitFollowupJobCancelled(params: {
  jobId: number;
  reason: string;
}): Promise<boolean> {
  const result = await query(
    `UPDATE ana_visit_followup_jobs
        SET status = 'cancelled',
            cancel_reason = $2,
            completed_at = NOW(),
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND status IN ('active', 'processing')`,
    [params.jobId, params.reason]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markAnaVisitFollowupJobFailed(params: {
  jobId: number;
  error: unknown;
  workerId?: string;
}): Promise<boolean> {
  const result = await query(
    `UPDATE ana_visit_followup_jobs
        SET status = 'failed',
            last_error = $2,
            completed_at = NOW(),
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND status = 'processing'
        AND ($3::text IS NULL OR locked_by = $3)`,
    [params.jobId, errorToMessage(params.error).slice(0, 1000), params.workerId ?? null]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function revalidateAnaVisitFollowupJobForSend(params: {
  jobId: number;
  conversationId: number;
  workerId: string;
  attemptIndex: number;
}): Promise<AnaVisitFollowupSendReadiness> {
  const { rows } = await query<
    AnaVisitFollowupJobRow & {
      blocked_reason: string | null;
    }
  >(
    `WITH locked_job AS (
       SELECT
         j.*,
         c.id AS conv_id,
         c.handoff AS conv_handoff,
         c.classification AS conv_classification,
         c.manual_closed_at AS conv_manual_closed_at,
         c.conversation_type AS conv_conversation_type,
         c.commercial_flow_state AS conv_commercial_flow_state,
         EXISTS (
           SELECT 1
             FROM messages m
            WHERE m.conversation_id = j.conversation_id
              AND m.role = 'user'
              AND m.deleted_at IS NULL
              AND (
                (j.anchor_assistant_message_id IS NOT NULL AND m.id > j.anchor_assistant_message_id)
                OR (j.anchor_assistant_message_id IS NULL AND m.created_at > j.started_at)
              )
         ) AS has_user_after_anchor,
         EXISTS (
           SELECT 1
             FROM appointments a
            WHERE a.conversation_id = j.conversation_id
              AND a.status IN ('PENDENTE_CONFIRMACAO', 'CONFIRMADO')
         ) AS has_open_appointment
       FROM ana_visit_followup_jobs j
       LEFT JOIN conversations c ON c.id = j.conversation_id
       WHERE j.id = $1
       FOR UPDATE OF j
     )
     SELECT *,
       CASE
         WHEN status <> 'processing' THEN 'job_not_processing'
         WHEN locked_by IS DISTINCT FROM $2 THEN 'job_lock_lost'
         WHEN conversation_id <> $3 THEN 'conversation_mismatch'
         WHEN next_attempt_index <> $4 THEN 'attempt_index_changed'
         WHEN conv_id IS NULL THEN 'conversation_not_found'
         WHEN COALESCE(conv_handoff, false) = true OR conv_classification = 'Handoff' THEN 'handoff'
         WHEN conv_manual_closed_at IS NOT NULL THEN 'manual_closed'
         WHEN COALESCE(conv_conversation_type, 'CLIENT') <> 'CLIENT' THEN 'non_client_conversation'
         WHEN COALESCE(conv_commercial_flow_state #>> '{visitScheduling,status}', '') = 'scheduled' THEN 'visit_scheduled'
         WHEN NOT (
           COALESCE(conv_commercial_flow_state ->> 'pendingVisitScheduling', 'false') = 'true'
           OR COALESCE(conv_commercial_flow_state #>> '{visitScheduling,active}', 'false') = 'true'
         ) THEN 'visit_flow_inactive'
         WHEN has_open_appointment THEN 'appointment_exists'
         WHEN has_user_after_anchor THEN 'customer_replied'
         ELSE NULL
       END AS blocked_reason
     FROM locked_job`,
    [params.jobId, params.workerId, params.conversationId, params.attemptIndex]
  );
  const row = rows[0] ?? null;
  if (!row) return { ok: false, reason: 'job_not_found', job: null };
  const blockedReason = row.blocked_reason;
  if (blockedReason) return { ok: false, reason: blockedReason, job: row };
  return { ok: true, job: row };
}

export async function hasUserMessageAfterAnaVisitFollowupAnchor(job: AnaVisitFollowupJobRow): Promise<boolean> {
  if (job.anchor_assistant_message_id != null) {
    const { rows } = await query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1
           FROM messages
          WHERE conversation_id = $1
            AND role = 'user'
            AND deleted_at IS NULL
            AND id > $2
       ) AS exists`,
      [job.conversation_id, job.anchor_assistant_message_id]
    );
    return rows[0]?.exists === true;
  }

  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM messages
        WHERE conversation_id = $1
          AND role = 'user'
          AND deleted_at IS NULL
          AND created_at > $2
     ) AS exists`,
    [job.conversation_id, job.started_at]
  );
  return rows[0]?.exists === true;
}

export async function hasOpenAppointmentForAnaVisitFollowup(conversationId: number): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
         FROM appointments
        WHERE conversation_id = $1
          AND status IN ('PENDENTE_CONFIRMACAO', 'CONFIRMADO')
     ) AS exists`,
    [conversationId]
  );
  return rows[0]?.exists === true;
}
