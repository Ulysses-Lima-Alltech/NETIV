import type { PoolClient } from 'pg';
import { notifyAndPersistBrokerPendingAttendance } from './brokerNotificationService.js';
import { getPool } from '../db/pg.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import { cancelAnaPendingAutomationForHandoff } from '../repositories/anaHandoffAutomationRepository.js';

type PgClient = PoolClient;

type AssignmentConversationRow = {
  id: number;
  enterprise_id: number | null;
  enterprise_name: string | null;
  customer_name: string | null;
  contact_phone: string | null;
  external_contact_id: string;
  assigned_broker_id: number | null;
};

type BrokerRow = {
  id: number;
  full_name: string;
  phone: string | null;
  handoff_load: number;
};

type QueueStateRow = {
  id: number;
  enterprise_id: number;
  last_assigned_broker_id: number | null;
};

export type BrokerAssignmentResult = {
  conversationId: number;
  enterpriseId: number | null;
  enterpriseName: string | null;
  assignedBrokerId: number | null;
  assignedBrokerName: string | null;
  assignedBrokerPhone: string | null;
  customerNameOrPhone: string;
  handoffReason: string;
};

const ALLOWED_ASSIGNMENT_REASONS = new Set([
  'explicit_broker_request',
  'pending_resolution_broker_choice',
  'manual_classification_handoff',
  'appointment_confirmed',
]);

const PENDING_ATTENDANCE_TEMPLATE_SENT_BY_CALLER_REASONS = new Set([
  'explicit_broker_request',
  'pending_resolution_broker_choice',
  'appointment_confirmed',
]);

function normalizeReason(input: string | null | undefined): string {
  const raw = String(input ?? '').trim();
  if (!raw) return 'customer_requested_broker';
  return raw.slice(0, 120);
}

function resolveCustomerNameOrPhone(row: AssignmentConversationRow): string {
  const customerName = String(row.customer_name ?? '').trim();
  if (customerName) return customerName;

  const normalizedPhone =
    normalizePhoneE164(row.contact_phone) ??
    normalizePhoneE164(row.external_contact_id) ??
    normalizePhoneE164(row.contact_phone ?? row.external_contact_id);
  if (normalizedPhone) return normalizedPhone;

  const fallbackPhone = String(row.contact_phone ?? row.external_contact_id ?? '').trim();
  return fallbackPhone || 'Cliente';
}

async function logEnforcedHandoffState(args: {
  conversationId: number;
  expectedBrokerId: number | null;
  client: PgClient;
}): Promise<void> {
  const verification = await args.client.query<{
    id: number;
    assigned_broker_id: number | null;
    handoff: boolean | null;
    classification: string | null;
  }>(
    `SELECT id, assigned_broker_id, handoff, classification
     FROM conversations
     WHERE id = $1
     LIMIT 1`,
    [args.conversationId]
  );
  const row = verification.rows[0] ?? null;
  if (!row) return;
  const attendanceMode = row.handoff === true || row.classification === 'Handoff' ? 'handoff' : 'ana';
  console.log('[ANA_HANDOFF_MODE_ENFORCED]', {
    conversationId: row.id,
    expectedBrokerId: args.expectedBrokerId,
    assignedBrokerId: row.assigned_broker_id ?? null,
    handoff: row.handoff === true,
    classification: row.classification ?? null,
    attendanceMode,
  });
}

export async function getActiveBrokersForEnterprise(args: {
  enterpriseId: number;
  client: PgClient;
}): Promise<BrokerRow[]> {
  const { rows } = await args.client.query<BrokerRow>(
    `SELECT
       c.id,
       c.full_name,
       NULLIF(BTRIM(c.phone), '') AS phone,
       COALESCE(load.active_handoff_count, 0)::int AS handoff_load
     FROM corretores c
     INNER JOIN corretor_empreendimentos ce ON ce.corretor_id = c.id
     LEFT JOIN (
       SELECT assigned_broker_id, COUNT(*)::int AS active_handoff_count
       FROM conversations
       WHERE handoff = true AND assigned_broker_id IS NOT NULL
       GROUP BY assigned_broker_id
     ) load ON load.assigned_broker_id = c.id
     WHERE ce.enterprise_id = $1
       AND c.active = true
       AND COALESCE(c.receiving_enabled, true) = true
     ORDER BY c.id ASC`,
    [args.enterpriseId]
  );
  return rows;
}

export async function resolveNextBrokerFromQueue(args: {
  enterpriseId: number;
  client: PgClient;
}): Promise<BrokerRow | null> {
  const { enterpriseId, client } = args;
  const activeBrokers = await getActiveBrokersForEnterprise({ enterpriseId, client });
  if (activeBrokers.length === 0) return null;

  await client.query(
    `INSERT INTO broker_assignment_queue_state (enterprise_id)
     VALUES ($1)
     ON CONFLICT (enterprise_id) DO NOTHING`,
    [enterpriseId]
  );

  const queueStateResult = await client.query<QueueStateRow>(
    `SELECT id, enterprise_id::int AS enterprise_id, last_assigned_broker_id::int AS last_assigned_broker_id
     FROM broker_assignment_queue_state
     WHERE enterprise_id = $1
     FOR UPDATE`,
    [enterpriseId]
  );
  const queueState = queueStateResult.rows[0] ?? null;
  const lastAssignedBrokerId = queueState?.last_assigned_broker_id ?? null;

  const brokersById = [...activeBrokers].sort((a, b) => a.id - b.id);
  const brokersByLoad = [...activeBrokers].sort((a, b) => {
    if (a.handoff_load !== b.handoff_load) return a.handoff_load - b.handoff_load;
    return a.id - b.id;
  });

  let selectedBroker: BrokerRow;
  if (lastAssignedBrokerId != null) {
    const currentIndex = brokersById.findIndex((broker) => broker.id === lastAssignedBrokerId);
    if (currentIndex >= 0) {
      selectedBroker = brokersById[(currentIndex + 1) % brokersById.length];
    } else {
      selectedBroker = brokersByLoad[0];
    }
  } else {
    selectedBroker = brokersByLoad[0];
  }

  await client.query(
    `UPDATE broker_assignment_queue_state
     SET last_assigned_broker_id = $2,
         last_assigned_at = NOW(),
         updated_at = NOW()
     WHERE enterprise_id = $1`,
    [enterpriseId, selectedBroker.id]
  );

  console.log('[ANA_BROKER_QUEUE_RESOLVED]', {
    enterpriseId,
    lastAssignedBrokerId,
    selectedBrokerId: selectedBroker.id,
    activeBrokerIds: brokersById.map((broker) => broker.id),
    candidateByLoad: brokersByLoad.map((broker) => ({
      id: broker.id,
      handoffLoad: broker.handoff_load,
    })),
  });

  return selectedBroker;
}

export async function markConversationAsHandoffAssigned(args: {
  conversationId: number;
  brokerId: number;
  reason: string;
  client: PgClient;
}): Promise<void> {
  await args.client.query(
    `UPDATE conversations
     SET assigned_broker_id = $2,
         assigned_broker_at = NOW(),
         handoff = true,
         classification = 'Handoff',
         classification_before_handoff = CASE
           WHEN classification = 'Handoff' THEN classification_before_handoff
           ELSE COALESCE(classification_before_handoff, classification)
         END,
         handoff_reason = $3,
         handoff_requested_at = NOW(),
         pending_resolution_choice = false,
         pending_resolution_reason = NULL,
         pending_resolution_intent = NULL,
         pending_resolution_created_at = NULL,
         pending_resolution_payload = NULL,
         ana_followup_status = 'cancelled',
         ana_followup_next_at = NULL,
         ana_followup_cancel_reason = $3,
         broker_notified_at = NULL,
         broker_notification_status = 'pending',
         broker_notification_error = NULL,
         broker_notification_template = NULL,
         broker_push_notified_at = NULL,
         broker_push_notification_status = 'pending',
         broker_push_notification_error = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [args.conversationId, args.brokerId, args.reason]
  );
  await cancelAnaPendingAutomationForHandoff({
    conversationId: args.conversationId,
    source: 'markConversationAsHandoffAssigned',
    client: args.client,
  });
  await logEnforcedHandoffState({
    conversationId: args.conversationId,
    expectedBrokerId: args.brokerId,
    client: args.client,
  });
}

export async function markConversationAsHandoffUnassigned(args: {
  conversationId: number;
  reason: string;
  client: PgClient;
}): Promise<void> {
  await args.client.query(
    `UPDATE conversations
     SET assigned_broker_id = NULL,
         assigned_broker_at = NULL,
         handoff = true,
         classification = 'Handoff',
         classification_before_handoff = CASE
           WHEN classification = 'Handoff' THEN classification_before_handoff
           ELSE COALESCE(classification_before_handoff, classification)
         END,
         handoff_reason = $2,
         handoff_requested_at = NOW(),
         pending_resolution_choice = false,
         pending_resolution_reason = NULL,
         pending_resolution_intent = NULL,
         pending_resolution_created_at = NULL,
         pending_resolution_payload = NULL,
         ana_followup_status = 'cancelled',
         ana_followup_next_at = NULL,
         ana_followup_cancel_reason = $2,
         broker_notified_at = NULL,
         broker_notification_status = 'skipped_no_broker',
         broker_notification_error = NULL,
         broker_notification_template = NULL,
         broker_push_notified_at = NULL,
         broker_push_notification_status = 'skipped_no_broker',
         broker_push_notification_error = NULL,
         updated_at = NOW()
     WHERE id = $1`,
    [args.conversationId, args.reason]
  );
  await cancelAnaPendingAutomationForHandoff({
    conversationId: args.conversationId,
    source: 'markConversationAsHandoffUnassigned',
    client: args.client,
  });
  await logEnforcedHandoffState({
    conversationId: args.conversationId,
    expectedBrokerId: null,
    client: args.client,
  });
}

export async function assignConversationToNextBroker(args: {
  conversationId: number;
  reason: string;
}): Promise<BrokerAssignmentResult | null> {
  const { conversationId } = args;
  const requestedReason = normalizeReason(args.reason);

  console.log('[ANA_BROKER_ASSIGNMENT_STARTED]', {
    conversationId,
    reason: requestedReason,
  });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const guardConversationResult = await client.query<{
      id: number;
      pending_resolution_choice: boolean | null;
      classification: string | null;
      handoff: boolean | null;
      last_user_message_preview: string | null;
    }>(
      `SELECT
         c.id,
         c.pending_resolution_choice,
         c.classification,
         c.handoff,
         (
           SELECT m.content
           FROM messages m
           WHERE m.conversation_id = c.id AND m.role = 'user'
           ORDER BY m.created_at DESC
           LIMIT 1
         ) AS last_user_message_preview
       FROM conversations c
       WHERE c.id = $1
       FOR UPDATE`,
      [conversationId]
    );
    const guardConversation = guardConversationResult.rows[0] ?? null;
    if (!guardConversation) {
      await client.query('ROLLBACK');
      return null;
    }
    if (!ALLOWED_ASSIGNMENT_REASONS.has(requestedReason)) {
      console.log('[ANA_BROKER_ASSIGNMENT_BLOCKED_NO_EXPLICIT_REQUEST]', {
        conversationId,
        reason: requestedReason,
        userMessagePreview: String(guardConversation.last_user_message_preview ?? '').slice(0, 220),
        pendingResolutionChoice: guardConversation.pending_resolution_choice === true,
        classifiedChoice: null,
        currentClassification: guardConversation.classification ?? null,
        currentHandoff: guardConversation.handoff === true,
      });
      await client.query('ROLLBACK');
      return null;
    }

    const conversationResult = await client.query<AssignmentConversationRow>(
      `SELECT
         c.id,
         c.enterprise_id,
         e.name AS enterprise_name,
         c.customer_name,
         c.contact_phone,
         c.external_contact_id,
         c.assigned_broker_id
       FROM conversations c
       LEFT JOIN enterprises e ON e.id = c.enterprise_id
       WHERE c.id = $1
       FOR UPDATE OF c`,
      [conversationId]
    );
    const conversation = conversationResult.rows[0] ?? null;
    if (!conversation) {
      await client.query('ROLLBACK');
      return null;
    }

    const customerNameOrPhone = resolveCustomerNameOrPhone(conversation);
    let assignedBrokerId: number | null = null;
    let assignedBrokerName: string | null = null;
    let assignedBrokerPhone: string | null = null;
    let handoffReason = requestedReason;

    if (conversation.assigned_broker_id != null) {
      assignedBrokerId = conversation.assigned_broker_id;
      const brokerResult = await client.query<Pick<BrokerRow, 'id' | 'full_name' | 'phone'>>(
        `SELECT id, full_name, NULLIF(BTRIM(phone), '') AS phone
         FROM corretores
         WHERE id = $1
         LIMIT 1`,
        [conversation.assigned_broker_id]
      );
      const broker = brokerResult.rows[0] ?? null;
      assignedBrokerName = broker?.full_name ?? null;
      assignedBrokerPhone = broker?.phone ?? null;

      await markConversationAsHandoffAssigned({
        conversationId,
        brokerId: assignedBrokerId,
        reason: requestedReason,
        client,
      });

      console.log('[ANA_BROKER_ASSIGNED_TO_CONVERSATION]', {
        conversationId,
        enterpriseId: conversation.enterprise_id,
        brokerId: assignedBrokerId,
        source: 'existing_assignment_kept',
      });
    } else if (conversation.enterprise_id == null) {
      handoffReason = 'broker_requested_unassigned';
      await markConversationAsHandoffUnassigned({
        conversationId,
        reason: handoffReason,
        client,
      });
      console.warn('[ANA_BROKER_ASSIGNMENT_NO_AVAILABLE_BROKER]', {
        conversationId,
        enterpriseId: null,
        reason: 'missing_enterprise_id',
      });
    } else {
      const nextBroker = await resolveNextBrokerFromQueue({
        enterpriseId: conversation.enterprise_id,
        client,
      });
      if (!nextBroker) {
        handoffReason = 'broker_requested_unassigned';
        await markConversationAsHandoffUnassigned({
          conversationId,
          reason: handoffReason,
          client,
        });
        console.warn('[ANA_BROKER_ASSIGNMENT_NO_AVAILABLE_BROKER]', {
          conversationId,
          enterpriseId: conversation.enterprise_id,
          reason: 'no_active_broker_for_enterprise',
        });
      } else {
        assignedBrokerId = nextBroker.id;
        assignedBrokerName = nextBroker.full_name;
        assignedBrokerPhone = nextBroker.phone ?? null;

        await markConversationAsHandoffAssigned({
          conversationId,
          brokerId: nextBroker.id,
          reason: requestedReason,
          client,
        });

        console.log('[ANA_BROKER_ASSIGNED_TO_CONVERSATION]', {
          conversationId,
          enterpriseId: conversation.enterprise_id,
          brokerId: nextBroker.id,
          source: 'queue_rotation',
        });
      }
    }

    await client.query('COMMIT');
    if (
      assignedBrokerId != null &&
      !PENDING_ATTENDANCE_TEMPLATE_SENT_BY_CALLER_REASONS.has(requestedReason)
    ) {
      void notifyAndPersistBrokerPendingAttendance({
        conversationId,
        brokerId: assignedBrokerId,
        brokerPhone: assignedBrokerPhone ?? '',
        brokerName: assignedBrokerName ?? 'Corretor',
        clientName: customerNameOrPhone,
        enterpriseName: conversation.enterprise_name ?? 'Empreendimento',
      });
    }

    return {
      conversationId,
      enterpriseId: conversation.enterprise_id,
      enterpriseName: conversation.enterprise_name ?? null,
      assignedBrokerId,
      assignedBrokerName,
      assignedBrokerPhone,
      customerNameOrPhone,
      handoffReason,
    };
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // noop
    }
    console.error('[ANA_BROKER_ASSIGNMENT_FAILED]', {
      conversationId,
      reason: requestedReason,
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  } finally {
    client.release();
  }
}
