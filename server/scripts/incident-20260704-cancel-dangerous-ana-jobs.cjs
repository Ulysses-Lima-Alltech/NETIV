#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config();

const APPLY = process.argv.includes('--apply');
const REASON = 'incident_20260704_cancelled';

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return rows[0]?.exists === true;
}

async function countRows(client, sql, params = []) {
  const { rows } = await client.query(sql, params);
  return Number(rows[0]?.count ?? 0);
}

async function collectBefore(client) {
  const out = {};
  out.dueConversationFollowups = await countRows(
    client,
    `SELECT COUNT(*)::int AS count
       FROM conversations
      WHERE ana_followup_status = 'active'
        AND ana_followup_next_at <= NOW()`
  );

  if (await tableExists(client, 'ana_retry_jobs')) {
    out.pendingRetryJobs = await countRows(
      client,
      `SELECT COUNT(*)::int AS count
         FROM ana_retry_jobs
        WHERE status IN ('pending', 'processing')`
    );
  } else {
    out.pendingRetryJobs = 0;
  }

  if (await tableExists(client, 'ana_visit_followup_jobs')) {
    out.pendingVisitFollowupJobs = await countRows(
      client,
      `SELECT COUNT(*)::int AS count
         FROM ana_visit_followup_jobs
        WHERE status IN ('active', 'processing')`
    );
  } else {
    out.pendingVisitFollowupJobs = 0;
  }

  return out;
}

async function listSamples(client) {
  const samples = {};
  const { rows: conversations } = await client.query(
    `SELECT id, customer_name, classification, handoff, assigned_broker_id,
            ana_followup_status, ana_followup_attempt_count, ana_followup_next_at
       FROM conversations
      WHERE ana_followup_status = 'active'
        AND ana_followup_next_at <= NOW()
      ORDER BY ana_followup_next_at ASC, id ASC
      LIMIT 50`
  );
  samples.dueConversationFollowups = conversations;

  if (await tableExists(client, 'ana_retry_jobs')) {
    const { rows } = await client.query(
      `SELECT id, conversation_id, trigger_message_id, status, reason,
              attempt_count, next_run_at, locked_at, locked_by
         FROM ana_retry_jobs
        WHERE status IN ('pending', 'processing')
        ORDER BY next_run_at ASC, id ASC
        LIMIT 50`
    );
    samples.pendingRetryJobs = rows;
  }

  if (await tableExists(client, 'ana_visit_followup_jobs')) {
    const { rows } = await client.query(
      `SELECT id, conversation_id, status, next_run_at, next_attempt_index,
              last_attempt_index, locked_at, locked_by, cancel_reason
         FROM ana_visit_followup_jobs
        WHERE status IN ('active', 'processing')
        ORDER BY next_run_at ASC, id ASC
        LIMIT 50`
    );
    samples.pendingVisitFollowupJobs = rows;
  }

  return samples;
}

async function applyCancellation(client) {
  await client.query('BEGIN');
  try {
    await client.query(
      `UPDATE conversations
          SET ana_followup_status = 'cancelled',
              ana_followup_cancel_reason = $1,
              ana_followup_next_at = NULL,
              updated_at = NOW()
        WHERE ana_followup_status = 'active'
          AND ana_followup_next_at <= NOW()`,
      [REASON]
    );

    if (await tableExists(client, 'ana_retry_jobs')) {
      await client.query(
        `UPDATE ana_retry_jobs
            SET status = 'failed_non_retryable',
                last_error = $1,
                last_error_code = $1,
                locked_at = NULL,
                locked_by = NULL,
                updated_at = NOW()
          WHERE status IN ('pending', 'processing')`,
        [REASON]
      );
    }

    if (await tableExists(client, 'ana_visit_followup_jobs')) {
      await client.query(
        `UPDATE ana_visit_followup_jobs
            SET status = 'cancelled',
                cancel_reason = $1,
                completed_at = NOW(),
                locked_at = NULL,
                locked_by = NULL,
                updated_at = NOW()
          WHERE status IN ('active', 'processing')`,
        [REASON]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/netiv';
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const client = await pool.connect();
  try {
    const before = await collectBefore(client);
    const samples = await listSamples(client);
    console.log('[incident-20260704-cancel-dangerous-ana-jobs]');
    console.log(`mode: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
    console.log('before:', before);
    console.log('samples:', JSON.stringify(samples, null, 2));

    if (!APPLY) {
      console.log('No changes made. Re-run with --apply to cancel the listed Ana automation state.');
      return;
    }

    await applyCancellation(client);
    const after = await collectBefore(client);
    console.log('after:', after);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[incident-20260704-cancel-dangerous-ana-jobs] failed', error);
  process.exitCode = 1;
});
