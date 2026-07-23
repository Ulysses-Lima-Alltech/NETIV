import type { PoolClient } from 'pg';
import { getPool } from '../db/pg.js';

export interface AnaHandoffAutomationCleanupResult {
  conversationUpdated: boolean;
  retryJobsCancelled: number;
  visitFollowupJobsCancelled: number;
}

const PENDING_COMMERCIAL_FLOW_KEYS = [
  'pendingAssistantContinuation', 'pending_action', 'pending_material_type',
  'pending_enterprise_id', 'pendingVisitScheduling', 'pendingVisitDateLabel',
  'pendingVisitDate', 'pendingVisitDay', 'pendingVisitTime', 'pendingVisitPeriod',
  'pendingVisitEnterpriseId', 'pendingVisitInvalidTime', 'pendingVisitMissingSlot',
  'pendingVisitCustomerName', 'pendingVisitConfirmationAsked',
  'pendingAppointmentCandidate', 'suggestedVisitStartAt', 'suggestedVisitEndAt',
  'suggestedVisitBrokerId', 'suggestedVisitSlotLabel', 'suggestedVisitTimezone',
  'suggestedVisitStatus', 'awaitingAlternativeSlotInterest',
  'suggestedVisitDeclinedStartAt', 'suggestedVisitDeclinedEndAt',
  'suggestedVisitDeclinedBrokerId', 'suggestedVisitDeclinedSlotLabel',
  'suggestedVisitDeclinedTimezone', 'visitScheduling',
] as const;

export async function cancelAnaPendingAutomationForHandoff(params: {
  conversationId: number;
  source: string;
  client?: PoolClient;
}): Promise<AnaHandoffAutomationCleanupResult> {
  const ownedClient = params.client == null;
  const client = params.client ?? (await getPool().connect());
  try {
    if (ownedClient) await client.query('BEGIN');
    const conversationResult = await client.query(
      `UPDATE conversations
          SET commercial_flow_state = COALESCE(commercial_flow_state, '{}'::jsonb) - $2::text[],
              pending_resolution_choice = false,
              pending_resolution_reason = NULL,
              pending_resolution_intent = NULL,
              pending_resolution_created_at = NULL,
              pending_resolution_payload = NULL,
              handoff_deferred_until = NULL,
              handoff_deferred_broker_id = NULL,
              reengagement_for_user_message_id = NULL,
              ana_followup_anchor_assistant_message_id = NULL,
              ana_followup_anchor_assistant_created_at = NULL,
              ana_followup_for_user_message_id = NULL,
              ana_followup_next_at = NULL,
              ana_followup_status = 'cancelled',
              ana_followup_cancel_reason = 'handoff',
              updated_at = NOW()
        WHERE id = $1
          AND (handoff = true OR lower(trim(COALESCE(classification, ''))) = 'handoff')`,
      [params.conversationId, [...PENDING_COMMERCIAL_FLOW_KEYS]]
    );

    let retryJobsCancelled = 0;
    let visitFollowupJobsCancelled = 0;
    if ((conversationResult.rowCount ?? 0) > 0) {
      const retryResult = await client.query(
        `UPDATE ana_retry_jobs
            SET status = 'failed_non_retryable', reason = 'handoff', last_error = 'handoff',
                last_error_code = 'handoff', locked_at = NULL, locked_by = NULL, updated_at = NOW()
          WHERE conversation_id = $1 AND status IN ('pending', 'processing')`,
        [params.conversationId]
      );
      retryJobsCancelled = retryResult.rowCount ?? 0;
      const visitResult = await client.query(
        `UPDATE ana_visit_followup_jobs
            SET status = 'cancelled', cancel_reason = 'handoff', completed_at = NOW(),
                locked_at = NULL, locked_by = NULL, updated_at = NOW()
          WHERE conversation_id = $1 AND status IN ('active', 'processing')`,
        [params.conversationId]
      );
      visitFollowupJobsCancelled = visitResult.rowCount ?? 0;
    }
    if (ownedClient) await client.query('COMMIT');
    const result = {
      conversationUpdated: (conversationResult.rowCount ?? 0) > 0,
      retryJobsCancelled,
      visitFollowupJobsCancelled,
    };
    console.log('[ANA_HANDOFF_PENDING_AUTOMATIONS_CANCELLED]', {
      conversationId: params.conversationId, source: params.source, ...result,
    });
    return result;
  } catch (error) {
    if (ownedClient) {
      try { await client.query('ROLLBACK'); } catch { /* preserve original error */ }
    }
    throw error;
  } finally {
    if (ownedClient) client.release();
  }
}
