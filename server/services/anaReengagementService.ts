
import { getPool, query } from '../db/pg.js';
import { getConversationById, type ConversationRow } from '../repositories/conversationRepository.js';
import { touchContactInteractionByConversation } from '../repositories/contactsRepository.js';
import {
  getLastUserMessageRow,
  getLastVisibleMessageRoleAndId,
  getMessageCreatedAtById,
} from '../repositories/messageRepository.js';
import { withAnaVisitFollowupConversationLock } from '../repositories/anaVisitFollowupJobRepository.js';
import { conversationHasActiveAppointmentForReengageBlock } from '../repositories/appointmentRepository.js';
import { publishConversationUpdated, publishMessageCreated } from '../realtime/realtimePublisher.js';
import {
  sendAnaTextMessageWithQuota,
} from './anaOutboundQuotaService.js';
import { computeAnaFollowupAtUtc } from '../utils/anaFollowupCadence.js';
import { isAnaEmergencyHandoffEnabled } from '../utils/anaEmergencyHandoff.js';
import { getActiveEnterpriseById } from '../repositories/enterpriseRepository.js';
import { resolveAiSettingsForEnterprise } from './enterpriseAiSettingsService.js';
import { resolveAnaCommercialFollowupMessage } from './anaCommercialRulesService.js';
import { parseCommercialFlowState } from '../utils/commercialFlowState.js';

const SCAN_LIMIT = 500;
const ANA_FOLLOWUP_MIN_GAP_AFTER_SEND_MS = 60_000;

const BODY_WITH_NAME = [
  'Oi, {{name}}. Passando sÃ³ pra nÃ£o te deixar sem retorno. Se ainda fizer sentido, sigo por aqui.',
  'Oi, {{name}}. Vi que nossa conversa ficou em aberto. Quando quiser, continuo daqui.',
  'Oi, {{name}}. SÃ³ retomando por aqui pra nÃ£o perder seu atendimento. Me chama quando for melhor pra vocÃª.',
];

const BODY_NO_NAME = [
  'Oi. Passando sÃ³ pra nÃ£o te deixar sem retorno. Se ainda fizer sentido, sigo por aqui.',
  'Oi. Vi que nossa conversa ficou em aberto. Quando quiser, continuo daqui.',
  'Oi. SÃ³ retomando por aqui pra nÃ£o perder seu atendimento. Me chama quando for melhor pra vocÃª.',
];

function firstName(raw: string | null | undefined): string | null {
  const t = (raw || '').trim();
  if (t.length < 2) return null;
  const parts = t.split(/\s+/);
  return parts[0] ?? null;
}

export function buildReengagementMessageText(conv: ConversationRow): string {
  const nm =
    firstName(conv.customer_name) ||
    firstName(conv.whatsapp_display_name ?? null) ||
    null;
  const pool = nm ? BODY_WITH_NAME : BODY_NO_NAME;
  const tpl = pool[Math.floor(Math.random() * pool.length)]!;
  if (nm) return tpl.replace(/\{\{name\}\}/g, nm);
  return tpl;
}

type QueryLike = {
  query: (text: string, params?: unknown[]) => Promise<{ rowCount: number | null }>;
};

interface LastVisibleAssistant {
  role: 'assistant';
  id: number;
  created_at: Date;
}

interface FollowupCycleState {
  anchorAssistantMessageId: number;
  anchorAssistantCreatedAt: Date;
  forUserMessageId: number;
  attemptCount: number;
  attemptIndex: number;
  nextFollowupAt: Date;
  continuedStoredCycle: boolean;
}

function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function logFollowupSkip(params: {
  conversationId: number;
  enterpriseId?: number | null;
  attemptIndex?: number | null;
  nextFollowupAt?: Date | null;
  reason: string;
  extra?: Record<string, unknown>;
}): void {
  console.log('[ANA_FOLLOWUP_SKIP]', {
    conversationId: params.conversationId,
    enterpriseId: params.enterpriseId ?? null,
    attemptIndex: params.attemptIndex ?? null,
    nextFollowupAt: params.nextFollowupAt?.toISOString() ?? null,
    reason: params.reason,
    ...(params.extra ?? {}),
  });
}

async function markConversationFollowupCancelled(params: {
  conversationId: number;
  reason: string;
}): Promise<void> {
  await query(
    `UPDATE conversations
        SET ana_followup_status = 'cancelled',
            ana_followup_cancel_reason = $2,
            ana_followup_next_at = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [params.conversationId, params.reason]
  );
}

function persistFollowupStateSql(state: FollowupCycleState): { text: string; params: unknown[] } {
  return {
    text: `UPDATE conversations
              SET reengagement_for_user_message_id = $2::int,
                  reengagement_count = $3,
                  ana_followup_anchor_assistant_message_id = $4,
                  ana_followup_anchor_assistant_created_at = $5,
                  ana_followup_for_user_message_id = $7::bigint,
                  ana_followup_attempt_count = $3,
                  ana_followup_next_at = $6,
                  ana_followup_status = 'active',
                  ana_followup_cancel_reason = NULL,
                  updated_at = NOW()
            WHERE id = $1`,
    params: [
      null,
      state.forUserMessageId,
      state.attemptCount,
      state.anchorAssistantMessageId,
      state.anchorAssistantCreatedAt,
      state.nextFollowupAt,
      state.forUserMessageId,
    ],
  };
}

async function persistFollowupState(
  conversationId: number,
  state: FollowupCycleState,
  executor?: QueryLike
): Promise<void> {
  const stmt = persistFollowupStateSql(state);
  stmt.params[0] = conversationId;
  if (executor) {
    await executor.query(stmt.text, stmt.params);
    return;
  }
  await query(stmt.text, stmt.params);
}

async function resolveFollowupCycleState(params: {
  conv: ConversationRow;
  lastUser: { id: number; created_at: Date };
  lastVisible: LastVisibleAssistant;
  notBefore?: Date | null;
}): Promise<FollowupCycleState | null> {
  const storedUserMessageId =
    params.conv.ana_followup_for_user_message_id ?? params.conv.reengagement_for_user_message_id ?? null;
  const storedAnchorMessageId = params.conv.ana_followup_anchor_assistant_message_id ?? null;
  const storedLastSentMessageId = params.conv.ana_followup_last_sent_message_id ?? null;
  const canContinueStoredCycle =
    storedUserMessageId === params.lastUser.id &&
    storedAnchorMessageId != null &&
    (params.lastVisible.id === storedAnchorMessageId ||
      (storedLastSentMessageId != null && params.lastVisible.id === storedLastSentMessageId));

  const anchorAssistantMessageId = canContinueStoredCycle ? storedAnchorMessageId : params.lastVisible.id;
  const anchorAssistantCreatedAt = canContinueStoredCycle
    ? toDateOrNull(params.conv.ana_followup_anchor_assistant_created_at) ??
      (params.lastVisible.id === storedAnchorMessageId
        ? params.lastVisible.created_at
        : await getMessageCreatedAtById(storedAnchorMessageId))
    : params.lastVisible.created_at;

  if (!anchorAssistantCreatedAt) return null;

  const attemptCount = canContinueStoredCycle
    ? Math.max(0, Number(params.conv.ana_followup_attempt_count ?? params.conv.reengagement_count ?? 0) || 0)
    : 0;
  const attemptIndex = attemptCount + 1;
  const nextFollowupAt = computeAnaFollowupAtUtc({
    anchor: anchorAssistantCreatedAt,
    attemptIndex,
    notBefore: params.notBefore ?? null,
  });

  return {
    anchorAssistantMessageId,
    anchorAssistantCreatedAt,
    forUserMessageId: params.lastUser.id,
    attemptCount,
    attemptIndex,
    nextFollowupAt,
    continuedStoredCycle: canContinueStoredCycle,
  };
}

function getAutomationBlockedReason(conv: ConversationRow): string | null {
  if (conv.handoff === true) return 'handoff';
  if ((conv.classification || '').trim() === 'Handoff') return 'handoff';
  if ((conv.classification || '').trim() === 'Carteira') return 'carteira';
  if (conv.assigned_broker_id != null) return 'assigned_broker';
  if (conv.manual_closed_at != null) return 'manual_closed';
  return null;
}

async function cancelAndLogFollowup(params: {
  conversationId: number;
  enterpriseId?: number | null;
  attemptIndex?: number | null;
  nextFollowupAt?: Date | null;
  reason: string;
  extra?: Record<string, unknown>;
}): Promise<void> {
  await markConversationFollowupCancelled({
    conversationId: params.conversationId,
    reason: params.reason,
  });
  logFollowupSkip(params);
}

/**
 * Uma passada do worker: tenta reengajamento para conversas candidatas (com lock por linha).
 */
export async function processAnaReengagementScan(): Promise<void> {
  if (isAnaEmergencyHandoffEnabled()) {
    console.log('[ANA_FOLLOWUP_SKIP]', { reason: 'ana_emergency_handoff_active' });
    return;
  }

  const { rows } = await query<{ id: number }>(
    `SELECT id FROM conversations
     WHERE channel = 'whatsapp'
       AND COALESCE(handoff, false) = false
       AND COALESCE(classification, '') NOT IN ('Handoff', 'Carteira')
       AND manual_closed_at IS NULL
       AND COALESCE(ana_followup_status, 'idle') IN ('idle', 'active')
       AND ana_followup_next_at IS NOT NULL
       AND ana_followup_next_at <= NOW()
       AND EXISTS (
         SELECT 1 FROM messages m
          WHERE m.conversation_id = conversations.id
            AND m.role = 'assistant'
            AND m.deleted_at IS NULL
       )
     ORDER BY ana_followup_next_at ASC, updated_at ASC, id ASC
     LIMIT $1`,
    [SCAN_LIMIT]
  );

  console.log('[ANA_FOLLOWUP_SCAN]', { candidates: rows.length });

  for (const r of rows) {
    try {
      await trySendReengagementForConversation(r.id);
    } catch (e) {
      console.error('[ANA_FOLLOWUP_ERROR]', {
        conversationId: r.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

async function trySendReengagementForConversation(conversationId: number): Promise<void> {
  const conv = await getConversationById(conversationId);
  if (!conv) return;

  const automationBlockedReason = getAutomationBlockedReason(conv);
  if (automationBlockedReason) {
    await cancelAndLogFollowup({
      conversationId,
      enterpriseId: conv.enterprise_id ?? null,
      reason: automationBlockedReason,
    });
    return;
  }

  const flowState = parseCommercialFlowState(conv.commercial_flow_state);
  if (flowState?.dialoguePolicy?.brokerHandoffAcceptedAt) {
    await cancelAndLogFollowup({
      conversationId,
      enterpriseId: conv.enterprise_id ?? null,
      reason: 'broker_handoff_pending',
      extra: { brokerHandoffAcceptedAt: flowState.dialoguePolicy.brokerHandoffAcceptedAt },
    });
    return;
  }
  if (flowState?.pendingVisitScheduling === true || flowState?.visitScheduling?.active === true) {
    await cancelAndLogFollowup({
      conversationId,
      enterpriseId: conv.enterprise_id ?? null,
      reason: 'visit_flow_active',
      extra: { visitStatus: flowState?.visitScheduling?.status ?? null },
    });
    return;
  }
  if (flowState?.pending_action === 'send_material') {
    await cancelAndLogFollowup({
      conversationId,
      enterpriseId: conv.enterprise_id ?? null,
      reason: 'material_flow_pending',
      extra: { pendingMaterialType: flowState?.pending_material_type ?? null },
    });
    return;
  }

  const lastUser = await getLastUserMessageRow(conversationId);
  if (!lastUser?.created_at) {
    logFollowupSkip({ conversationId, enterpriseId: conv.enterprise_id ?? null, reason: 'no_user_message' });
    return;
  }

  const lastOverall = await getLastVisibleMessageRoleAndId(conversationId);
  if (!lastOverall || lastOverall.role !== 'assistant') {
    logFollowupSkip({ conversationId, enterpriseId: conv.enterprise_id ?? null, reason: 'last_not_assistant' });
    return;
  }

  if (await conversationHasActiveAppointmentForReengageBlock(conversationId)) {
    await cancelAndLogFollowup({
      conversationId,
      enterpriseId: conv.enterprise_id ?? null,
      reason: 'active_appointment',
    });
    return;
  }

  const followupState = await resolveFollowupCycleState({
    conv,
    lastUser,
    lastVisible: {
      role: 'assistant',
      id: lastOverall.id,
      created_at: lastOverall.created_at,
    },
  });
  if (!followupState) {
    logFollowupSkip({ conversationId, enterpriseId: conv.enterprise_id ?? null, reason: 'missing_anchor' });
    return;
  }

  const enterprise = conv.enterprise_id ? await getActiveEnterpriseById(conv.enterprise_id) : null;
  if (conv.enterprise_id != null && !enterprise) {
    await cancelAndLogFollowup({
      conversationId,
      enterpriseId: conv.enterprise_id,
      attemptIndex: followupState.attemptIndex,
      nextFollowupAt: followupState.nextFollowupAt,
      reason: 'enterprise_id_inactive',
    });
    return;
  }

  const now = new Date();
  if (now.getTime() < followupState.nextFollowupAt.getTime()) {
    await persistFollowupState(conversationId, followupState);
    logFollowupSkip({
      conversationId,
      enterpriseId: conv.enterprise_id ?? null,
      attemptIndex: followupState.attemptIndex,
      nextFollowupAt: followupState.nextFollowupAt,
      reason: 'not_due',
    });
    return;
  }

  const to = (conv.contact_phone || conv.external_contact_id || '').replace(/\D/g, '');
  if (to.length < 10) {
    logFollowupSkip({
      conversationId,
      enterpriseId: conv.enterprise_id ?? null,
      attemptIndex: followupState.attemptIndex,
      nextFollowupAt: followupState.nextFollowupAt,
      reason: 'no_phone',
    });
    return;
  }

  const aiSettings = await resolveAiSettingsForEnterprise(conv.enterprise_id ?? null);
  if (aiSettings.blocked || !aiSettings.aiEnabled) {
    await cancelAndLogFollowup({
      conversationId,
      enterpriseId: conv.enterprise_id ?? null,
      attemptIndex: followupState.attemptIndex,
      nextFollowupAt: followupState.nextFollowupAt,
      reason: 'ai_disabled_or_blocked',
    });
    return;
  }

  await withAnaVisitFollowupConversationLock(conversationId, async () => {
    await sendReengagementAfterFinalValidation({
      conversationId,
      expectedUserMessageId: lastUser.id,
      to,
    });
  });
}

async function sendReengagementAfterFinalValidation(params: {
  conversationId: number;
  expectedUserMessageId: number;
  to: string;
}): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query<ConversationRow>(
      `SELECT * FROM conversations WHERE id = $1 FOR UPDATE`,
      [params.conversationId]
    );
    const locked = lock.rows[0];
    if (!locked) {
      await client.query('ROLLBACK');
      return;
    }

    const blockedReason = getAutomationBlockedReason(locked);
    if (blockedReason) {
      await client.query('ROLLBACK');
      await cancelAndLogFollowup({
        conversationId: params.conversationId,
        enterpriseId: locked.enterprise_id ?? null,
        reason: blockedReason,
      });
      return;
    }

    const uRow = await client.query<{ id: number; created_at: Date }>(
      `SELECT id, created_at FROM messages
       WHERE conversation_id = $1 AND role = 'user' AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [params.conversationId]
    );
    const u = uRow.rows[0];
    if (!u || u.id !== params.expectedUserMessageId) {
      await client.query('ROLLBACK');
      logFollowupSkip({
        conversationId: params.conversationId,
        enterpriseId: locked.enterprise_id ?? null,
        reason: 'customer_replied_after_candidate',
      });
      return;
    }

    const lastVis = await client.query<{ role: string; id: number; created_at: Date }>(
      `SELECT role, id, created_at FROM messages
       WHERE conversation_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [params.conversationId]
    );
    const lastVisible = lastVis.rows[0];
    if (!lastVisible || lastVisible.role !== 'assistant') {
      await client.query('ROLLBACK');
      logFollowupSkip({
        conversationId: params.conversationId,
        enterpriseId: locked.enterprise_id ?? null,
        reason: 'last_not_assistant',
      });
      return;
    }

    const state = await resolveFollowupCycleState({
      conv: locked,
      lastUser: u,
      lastVisible: {
        role: 'assistant',
        id: lastVisible.id,
        created_at: lastVisible.created_at,
      },
    });
    if (!state) {
      await client.query('ROLLBACK');
      logFollowupSkip({
        conversationId: params.conversationId,
        enterpriseId: locked.enterprise_id ?? null,
        reason: 'missing_anchor',
      });
      return;
    }

    const now = new Date();
    if (now.getTime() < state.nextFollowupAt.getTime()) {
      await persistFollowupState(params.conversationId, state, client);
      await client.query('COMMIT');
      logFollowupSkip({
        conversationId: params.conversationId,
        enterpriseId: locked.enterprise_id ?? null,
        attemptIndex: state.attemptIndex,
        nextFollowupAt: state.nextFollowupAt,
        reason: 'not_due',
      });
      return;
    }

    const lockedEnterprise = locked.enterprise_id ? await getActiveEnterpriseById(locked.enterprise_id) : null;
    if (locked.enterprise_id != null && !lockedEnterprise) {
      await client.query('ROLLBACK');
      await cancelAndLogFollowup({
        conversationId: params.conversationId,
        enterpriseId: locked.enterprise_id,
        attemptIndex: state.attemptIndex,
        nextFollowupAt: state.nextFollowupAt,
        reason: 'enterprise_id_inactive',
      });
      return;
    }

    const lockedAiSettings = await resolveAiSettingsForEnterprise(locked.enterprise_id ?? null);
    if (lockedAiSettings.blocked || !lockedAiSettings.aiEnabled) {
      await client.query('ROLLBACK');
      await cancelAndLogFollowup({
        conversationId: params.conversationId,
        enterpriseId: locked.enterprise_id ?? null,
        attemptIndex: state.attemptIndex,
        nextFollowupAt: state.nextFollowupAt,
        reason: 'ai_disabled_or_blocked',
      });
      return;
    }

    const commercialFollowupText = resolveAnaCommercialFollowupMessage({
      enterpriseName: lockedEnterprise?.name ?? null,
      cycleCount: state.attemptCount,
    });
    const outboundText = commercialFollowupText ?? buildReengagementMessageText(locked);
    const sendRes = await sendAnaTextMessageWithQuota({
      conversationId: params.conversationId,
      to: params.to,
      text: outboundText,
      phase: commercialFollowupText ? 'ana_commercial_followup' : 'ana_followup',
    });
    if (!sendRes.success || !sendRes.metaMessageId) {
      await client.query('ROLLBACK');
      console.log('[ANA_FOLLOWUP_ERROR]', {
        conversationId: params.conversationId,
        enterpriseId: locked.enterprise_id ?? null,
        attemptIndex: state.attemptIndex,
        nextFollowupAt: state.nextFollowupAt.toISOString(),
        error: sendRes.error ?? 'send_failed',
        code: sendRes.code ?? null,
      });
      return;
    }

    const insertResult = await client.query<{
      id: number;
      conversation_id: number;
      role: string;
      content: string | null;
      meta_message_id: string | null;
      message_kind: 'text' | 'document' | 'image' | 'video' | null;
      attachment_json: unknown | null;
      created_at: Date;
      deleted_at: Date | null;
    }>(
      `INSERT INTO messages (conversation_id, role, content, meta_message_id, message_kind, attachment_json)
       VALUES ($1, 'assistant', $2, $3, 'text', NULL::jsonb)
       RETURNING id, conversation_id, role, content, meta_message_id, message_kind, attachment_json, created_at, deleted_at`,
      [params.conversationId, outboundText, sendRes.metaMessageId]
    );
    const inserted = insertResult.rows[0];
    if (!inserted) {
      await client.query('ROLLBACK');
      throw new Error('Ana follow-up message insert returned no row');
    }

    const nextAttemptIndex = state.attemptIndex + 1;
    const nextFollowupAt = computeAnaFollowupAtUtc({
      anchor: state.anchorAssistantCreatedAt,
      attemptIndex: nextAttemptIndex,
      notBefore: new Date(Date.now() + ANA_FOLLOWUP_MIN_GAP_AFTER_SEND_MS),
    });

    await client.query(
      `UPDATE conversations SET
         reengagement_sent_at = NOW(),
         reengagement_for_user_message_id = $1::int,
         reengagement_count = $2,
         ana_followup_anchor_assistant_message_id = $3,
         ana_followup_anchor_assistant_created_at = $4,
         ana_followup_for_user_message_id = $8::bigint,
         ana_followup_attempt_count = $2,
         ana_followup_last_attempt_at = NOW(),
         ana_followup_last_sent_message_id = $5,
         ana_followup_next_at = $6,
         ana_followup_status = 'active',
         ana_followup_cancel_reason = NULL,
         last_message_at = NOW(),
         updated_at = NOW()
       WHERE id = $7`,
      [
        u.id,
        state.attemptIndex,
        state.anchorAssistantMessageId,
        state.anchorAssistantCreatedAt,
        inserted.id,
        nextFollowupAt,
        params.conversationId,
        u.id,
      ]
    );

    await client.query('COMMIT');
    await touchContactInteractionByConversation({ conversationId: params.conversationId, role: 'assistant' });
    publishMessageCreated({
      id: String(inserted.id),
      conversationId: inserted.conversation_id,
      role: inserted.role as 'user' | 'assistant',
      content: inserted.content,
      metaMessageId: inserted.meta_message_id,
      messageKind: inserted.message_kind ?? 'text',
      attachment: inserted.attachment_json,
      createdAt: inserted.created_at.toISOString(),
      deleted: inserted.deleted_at != null,
      deletedAt: inserted.deleted_at ? inserted.deleted_at.toISOString() : null,
    });
    void publishConversationUpdated(inserted.conversation_id);
    console.log('[ANA_FOLLOWUP_SENT]', {
      conversationId: params.conversationId,
      enterpriseId: locked.enterprise_id ?? null,
      userMessageId: u.id,
      anchorAssistantMessageId: state.anchorAssistantMessageId,
      attemptIndex: state.attemptIndex,
      nextFollowupAt: nextFollowupAt.toISOString(),
      metaMessageId: sendRes.metaMessageId,
      textLen: outboundText.length,
      kind: commercialFollowupText ? 'commercial_followup' : 'generic_followup',
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

