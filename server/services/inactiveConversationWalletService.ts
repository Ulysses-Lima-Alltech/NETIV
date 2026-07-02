import type { PoolClient } from 'pg';
import { getPool } from '../db/pg.js';

export const AUTO_WALLET_INACTIVE_REASON = 'auto_wallet_after_5_days_inactive';
export const DEFAULT_AUTO_WALLET_INACTIVE_DAYS = 5;
export const DEFAULT_AUTO_WALLET_BATCH_LIMIT = 1000;
export const AUTO_WALLET_MIN_INTERVAL_MS = 60 * 60 * 1000;

const AUTO_WALLET_LOCK_KEY = 50050120260701;

type Queryable = Pick<PoolClient, 'query'>;

export interface AutoWalletEligibilityInput {
  classification?: string | null;
  deletedAt?: Date | null;
  lastMessageAt?: Date | null;
  updatedAt?: Date | null;
  createdAt?: Date | null;
  now: Date;
  inactiveDays?: number;
}

export interface AutoWalletDryRunResult {
  totalEligible: number;
  byBucket: Array<{
    channel: string | null;
    conversationType: string | null;
    classification: string | null;
    total: number;
  }>;
  sample: Array<{
    id: number;
    channel: string | null;
    conversationType: string | null;
    classification: string | null;
    lastActivityAt: Date | null;
    updatedAt: Date | null;
  }>;
}

export interface AutoWalletApplyResult {
  updatedCount: number;
  cancelledVisitFollowupJobs: number;
  cancelledRetryJobs: number;
  skippedReason: 'none' | 'local_in_progress' | 'db_lock_busy';
}

let autoWalletRunInProgress = false;

function normalizePositiveInt(value: number | null | undefined, fallback: number, max?: number): number {
  if (!Number.isFinite(value ?? NaN)) return fallback;
  const n = Math.floor(Number(value));
  if (n <= 0) return fallback;
  return max != null ? Math.min(n, max) : n;
}

export function isConversationEligibleForAutoWallet(input: AutoWalletEligibilityInput): boolean {
  if ((input.classification ?? '').trim() === 'Carteira') return false;
  if (input.deletedAt != null) return false;

  const lastActivityAt = input.lastMessageAt ?? input.updatedAt ?? input.createdAt ?? null;
  if (!lastActivityAt || Number.isNaN(lastActivityAt.getTime())) return false;

  const inactiveDays = normalizePositiveInt(input.inactiveDays, DEFAULT_AUTO_WALLET_INACTIVE_DAYS, 3650);
  const cutoffMs = input.now.getTime() - inactiveDays * 24 * 60 * 60 * 1000;
  return lastActivityAt.getTime() < cutoffMs;
}

function inactiveWalletEligibilityJoin(): string {
  return `
    WITH last_activity AS (
      SELECT
        c.id,
        COALESCE(MAX(m.created_at), c.updated_at, c.created_at) AS last_activity_at
      FROM conversations c
      LEFT JOIN messages m
        ON m.conversation_id = c.id
       AND m.deleted_at IS NULL
      GROUP BY c.id, c.updated_at, c.created_at
    )
  `;
}

async function getInactiveWalletEligibleIds(
  client: Queryable,
  params: {
    inactiveDays: number;
    limit: number | null;
  }
): Promise<number[]> {
  const { rows } = await client.query<{ id: number }>(
    `${inactiveWalletEligibilityJoin()}
     SELECT c.id
     FROM conversations c
     JOIN last_activity la ON la.id = c.id
     WHERE COALESCE(c.classification, '') <> 'Carteira'
       AND la.last_activity_at < NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY la.last_activity_at ASC, c.id ASC
     LIMIT $2`,
    [params.inactiveDays, params.limit]
  );
  return rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id));
}

export async function getInactiveWalletDryRun(options?: {
  inactiveDays?: number;
}): Promise<AutoWalletDryRunResult> {
  const inactiveDays = normalizePositiveInt(options?.inactiveDays, DEFAULT_AUTO_WALLET_INACTIVE_DAYS, 3650);
  const pool = getPool();
  const total = await pool.query<{ total: string }>(
    `${inactiveWalletEligibilityJoin()}
     SELECT COUNT(*)::text AS total
     FROM conversations c
     JOIN last_activity la ON la.id = c.id
     WHERE COALESCE(c.classification, '') <> 'Carteira'
       AND la.last_activity_at < NOW() - ($1::int * INTERVAL '1 day')`,
    [inactiveDays]
  );
  const byBucket = await pool.query<{
    channel: string | null;
    conversation_type: string | null;
    classification: string | null;
    total: string;
  }>(
    `${inactiveWalletEligibilityJoin()}
     SELECT
       c.channel,
       COALESCE(c.conversation_type, 'CLIENT') AS conversation_type,
       c.classification,
       COUNT(*)::text AS total
     FROM conversations c
     JOIN last_activity la ON la.id = c.id
     WHERE COALESCE(c.classification, '') <> 'Carteira'
       AND la.last_activity_at < NOW() - ($1::int * INTERVAL '1 day')
     GROUP BY c.channel, COALESCE(c.conversation_type, 'CLIENT'), c.classification
     ORDER BY COUNT(*) DESC, c.channel ASC, conversation_type ASC, c.classification ASC`,
    [inactiveDays]
  );
  const sample = await pool.query<{
    id: number;
    channel: string | null;
    conversation_type: string | null;
    classification: string | null;
    last_activity_at: Date | null;
    updated_at: Date | null;
  }>(
    `${inactiveWalletEligibilityJoin()}
     SELECT
       c.id,
       c.channel,
       COALESCE(c.conversation_type, 'CLIENT') AS conversation_type,
       c.classification,
       la.last_activity_at,
       c.updated_at
     FROM conversations c
     JOIN last_activity la ON la.id = c.id
     WHERE COALESCE(c.classification, '') <> 'Carteira'
       AND la.last_activity_at < NOW() - ($1::int * INTERVAL '1 day')
     ORDER BY la.last_activity_at ASC, c.id ASC
     LIMIT 20`,
    [inactiveDays]
  );

  return {
    totalEligible: parseInt(total.rows[0]?.total ?? '0', 10) || 0,
    byBucket: byBucket.rows.map((row) => ({
      channel: row.channel,
      conversationType: row.conversation_type,
      classification: row.classification,
      total: parseInt(row.total, 10) || 0,
    })),
    sample: sample.rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      conversationType: row.conversation_type,
      classification: row.classification,
      lastActivityAt: row.last_activity_at,
      updatedAt: row.updated_at,
    })),
  };
}

export async function applyInactiveWallet(options?: {
  inactiveDays?: number;
  limit?: number | null;
}): Promise<AutoWalletApplyResult> {
  const inactiveDays = normalizePositiveInt(options?.inactiveDays, DEFAULT_AUTO_WALLET_INACTIVE_DAYS, 3650);
  const limit =
    options?.limit == null
      ? null
      : normalizePositiveInt(options.limit, DEFAULT_AUTO_WALLET_BATCH_LIMIT, 50_000);
  const client = await getPool().connect();
  let transactionOpen = false;
  try {
    await client.query('BEGIN');
    transactionOpen = true;
    const lock = await client.query<{ locked: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1::bigint) AS locked`,
      [AUTO_WALLET_LOCK_KEY]
    );
    if (lock.rows[0]?.locked !== true) {
      await client.query('COMMIT');
      transactionOpen = false;
      return {
        updatedCount: 0,
        cancelledVisitFollowupJobs: 0,
        cancelledRetryJobs: 0,
        skippedReason: 'db_lock_busy',
      };
    }

    const ids = await getInactiveWalletEligibleIds(client, { inactiveDays, limit });
    if (ids.length === 0) {
      await client.query('COMMIT');
      transactionOpen = false;
      return {
        updatedCount: 0,
        cancelledVisitFollowupJobs: 0,
        cancelledRetryJobs: 0,
        skippedReason: 'none',
      };
    }

    const updated = await client.query<{ id: number }>(
      `UPDATE conversations c
          SET classification = 'Carteira',
              handoff = false,
              classification_before_handoff = NULL,
              handoff_deferred_until = NULL,
              handoff_deferred_broker_id = NULL,
              manual_closed_at = COALESCE(c.manual_closed_at, NOW()),
              manual_closed_reason = COALESCE(NULLIF(c.manual_closed_reason, ''), $2),
              ana_followup_status = 'cancelled',
              ana_followup_next_at = NULL,
              ana_followup_cancel_reason = $2,
              updated_at = NOW()
        WHERE c.id = ANY($1::int[])
          AND COALESCE(c.classification, '') <> 'Carteira'
        RETURNING c.id`,
      [ids, AUTO_WALLET_INACTIVE_REASON]
    );
    const updatedIds = updated.rows.map((row) => row.id);
    let cancelledVisitFollowupJobs = 0;
    let cancelledRetryJobs = 0;

    if (updatedIds.length > 0) {
      const visitJobs = await client.query(
        `UPDATE ana_visit_followup_jobs
            SET status = 'cancelled',
                cancel_reason = $2,
                completed_at = NOW(),
                locked_at = NULL,
                locked_by = NULL,
                updated_at = NOW()
          WHERE conversation_id = ANY($1::bigint[])
            AND status IN ('active', 'processing')`,
        [updatedIds, AUTO_WALLET_INACTIVE_REASON]
      );
      cancelledVisitFollowupJobs = visitJobs.rowCount ?? 0;

      const retryJobs = await client.query(
        `UPDATE ana_retry_jobs
            SET status = 'failed_non_retryable',
                last_error = $2,
                last_error_code = $2,
                locked_at = NULL,
                locked_by = NULL,
                updated_at = NOW()
          WHERE conversation_id = ANY($1::bigint[])
            AND status IN ('pending', 'processing')`,
        [updatedIds, AUTO_WALLET_INACTIVE_REASON]
      );
      cancelledRetryJobs = retryJobs.rowCount ?? 0;
    }

    await client.query('COMMIT');
    transactionOpen = false;
    return {
      updatedCount: updatedIds.length,
      cancelledVisitFollowupJobs,
      cancelledRetryJobs,
      skippedReason: 'none',
    };
  } catch (error) {
    if (transactionOpen) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function processInactiveConversationsToWalletOnce(options?: {
  inactiveDays?: number;
  batchLimit?: number;
}): Promise<AutoWalletApplyResult> {
  if (autoWalletRunInProgress) {
    return {
      updatedCount: 0,
      cancelledVisitFollowupJobs: 0,
      cancelledRetryJobs: 0,
      skippedReason: 'local_in_progress',
    };
  }

  autoWalletRunInProgress = true;
  try {
    const result = await applyInactiveWallet({
      inactiveDays: options?.inactiveDays,
      limit: normalizePositiveInt(options?.batchLimit, DEFAULT_AUTO_WALLET_BATCH_LIMIT, 10_000),
    });
    if (result.updatedCount > 0 || result.skippedReason !== 'none') {
      console.log('[AUTO_WALLET_INACTIVE_RUN]', {
        ...result,
        inactiveDays: options?.inactiveDays ?? DEFAULT_AUTO_WALLET_INACTIVE_DAYS,
      });
    }
    return result;
  } finally {
    autoWalletRunInProgress = false;
  }
}
