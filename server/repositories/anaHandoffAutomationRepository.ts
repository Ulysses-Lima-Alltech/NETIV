import type { PoolClient, QueryResultRow } from 'pg';
import { query } from '../db/pg.js';

async function executeQuery<T extends QueryResultRow = QueryResultRow>(
  client: PoolClient | null | undefined,
  text: string,
  values?: unknown[]
): Promise<{ rows: T[]; rowCount: number | null }> {
  if (client) {
    const result = await client.query<T>({ text, values });
    return {
      rows: result.rows,
      rowCount: result.rowCount,
    };
  }
  const result = await query<T>(text, values);
  return {
    rows: result.rows,
    rowCount: result.rowCount,
  };
}

export async function cancelAnaPendingAutomationForHandoff(params: {
  conversationId: number;
  source: string;
  client?: PoolClient | null;
}): Promise<{
  conversationUpdated: number;
  retryJobsCancelled: number;
  visitFollowupJobsCancelled: number;
}> {
  const conversation = await executeQuery(
    params.client,
    `UPDATE conversations
        SET reengagement_sent_at = NULL,
            reengagement_for_user_message_id = NULL,
            reengagement_count = 0,
            ana_followup_anchor_assistant_message_id = NULL,
            ana_followup_anchor_assistant_created_at = NULL,
            ana_followup_for_user_message_id = NULL,
            ana_followup_attempt_count = 0,
            ana_followup_last_attempt_at = NULL,
            ana_followup_last_sent_message_id = NULL,
            ana_followup_next_at = NULL,
            ana_followup_status = 'cancelled',
            ana_followup_cancel_reason = 'handoff',
            pending_resolution_choice = false,
            pending_resolution_reason = NULL,
            pending_resolution_intent = NULL,
            pending_resolution_created_at = NULL,
            pending_resolution_payload = NULL,
            handoff_deferred_until = NULL,
            handoff_deferred_broker_id = NULL,
            updated_at = NOW()
      WHERE id = $1
        AND (
          COALESCE(handoff, false) = true
          OR lower(trim(COALESCE(classification, ''))) = 'handoff'
        )`,
    [params.conversationId]
  );
  const retryJobs = await executeQuery(
    params.client,
    `UPDATE ana_retry_jobs
        SET status = 'failed_non_retryable',
            reason = 'handoff',
            last_error = 'handoff',
            last_error_code = 'handoff',
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
      WHERE conversation_id = $1
        AND status IN ('pending', 'processing')`,
    [params.conversationId]
  );
  const visitFollowupJobs = await executeQuery(
    params.client,
    `UPDATE ana_visit_followup_jobs
        SET status = 'cancelled',
            cancel_reason = 'handoff',
            completed_at = NOW(),
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
      WHERE conversation_id = $1
        AND status IN ('active', 'processing')`,
    [params.conversationId]
  );
  const result = {
    conversationUpdated: conversation.rowCount ?? 0,
    retryJobsCancelled: retryJobs.rowCount ?? 0,
    visitFollowupJobsCancelled: visitFollowupJobs.rowCount ?? 0,
  };
  console.log('[ANA_PENDING_JOBS_CANCELLED_ON_HANDOFF]', {
    conversationId: params.conversationId,
    source: params.source,
    ...result,
  });
  return result;
}
