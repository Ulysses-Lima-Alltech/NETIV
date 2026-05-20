import { getPool, query } from '../db/pg.js';
import { getConversationById, type ConversationRow } from '../repositories/conversationRepository.js';
import { touchContactInteractionByConversation } from '../repositories/contactsRepository.js';
import { getLastUserMessageRow, getLastVisibleMessageRoleAndId } from '../repositories/messageRepository.js';
import { conversationHasActiveAppointmentForReengageBlock } from '../repositories/appointmentRepository.js';
import { publishConversationUpdated, publishMessageCreated } from '../realtime/realtimePublisher.js';
import {
  sendAnaTextMessageWithQuota,
} from './anaOutboundQuotaService.js';
import {
  computeEligibleReengagementAtUtc,
  computeCommercialFollowupEligibleAtUtc,
  isReengagementDueNow,
} from '../utils/anaReengagementSchedule.js';
import { isAnaEmergencyHandoffEnabled } from '../utils/anaEmergencyHandoff.js';
import { getActiveEnterpriseById } from '../repositories/enterpriseRepository.js';
import { resolveAiSettingsForEnterprise } from './enterpriseAiSettingsService.js';
import { resolveAnaCommercialFollowupMessage } from './anaCommercialRulesService.js';

const SCAN_LIMIT = 150;

const BODY_WITH_NAME = [
  'Oi, {{name}}. Passando só pra não te deixar sem retorno. Se ainda fizer sentido, sigo por aqui.',
  'Oi, {{name}}. Vi que nossa conversa ficou em aberto. Quando quiser, continuo daqui.',
  'Oi, {{name}}. Só retomando por aqui pra não perder seu atendimento. Me chama quando for melhor pra você.',
];

const BODY_NO_NAME = [
  'Oi. Passando só pra não te deixar sem retorno. Se ainda fizer sentido, sigo por aqui.',
  'Oi. Vi que nossa conversa ficou em aberto. Quando quiser, continuo daqui.',
  'Oi. Só retomando por aqui pra não perder seu atendimento. Me chama quando for melhor pra você.',
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

function isBlockedClassification(c: string): boolean {
  const x = (c || '').trim();
  return x === 'Handoff' || x === 'Carteira';
}

/**
 * Uma passada do worker: tenta reengajamento para conversas candidatas (com lock por linha).
 */
export async function processAnaReengagementScan(): Promise<void> {
  if (isAnaEmergencyHandoffEnabled()) {
    console.log('[ANA_REENGAGE_SKIP]', { reason: 'ana_emergency_handoff_active' });
    return;
  }

  const { rows } = await query<{ id: number }>(
    `SELECT id FROM conversations
     WHERE channel = 'whatsapp'
       AND handoff = false
       AND classification NOT IN ('Handoff', 'Carteira')
       AND manual_closed_at IS NULL
     ORDER BY updated_at DESC
     LIMIT $1`,
    [SCAN_LIMIT]
  );

  console.log('[ANA_REENGAGE_SCAN]', { candidates: rows.length });

  for (const r of rows) {
    try {
      await trySendReengagementForConversation(r.id);
    } catch (e) {
      console.error('[ANA_REENGAGE_ERROR]', {
        conversationId: r.id,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

async function trySendReengagementForConversation(conversationId: number): Promise<void> {
  const conv = await getConversationById(conversationId);
  if (!conv) return;
  if (conv.handoff === true) {
    console.log('[ANA_REENGAGE_SKIP]', { conversationId, reason: 'handoff' });
    return;
  }
  if (isBlockedClassification(conv.classification)) {
    console.log('[ANA_REENGAGE_SKIP]', { conversationId, reason: 'classification', classification: conv.classification });
    return;
  }
  if (conv.assigned_broker_id != null) {
    console.log('[ANA_REENGAGE_SKIP]', { conversationId, reason: 'assigned_broker' });
    return;
  }
  if (conv.manual_closed_at != null) {
    console.log('[ANA_REENGAGE_SKIP]', { conversationId, reason: 'manual_closed' });
    return;
  }

  const lastUser = await getLastUserMessageRow(conversationId);
  if (!lastUser?.created_at) {
    console.log('[ANA_REENGAGE_SKIP]', { conversationId, reason: 'no_user_message' });
    return;
  }

  const lastOverall = await getLastVisibleMessageRoleAndId(conversationId);
  if (!lastOverall || lastOverall.role !== 'assistant') {
    console.log('[ANA_REENGAGE_SKIP]', { conversationId, reason: 'last_not_assistant' });
    return;
  }

  if (await conversationHasActiveAppointmentForReengageBlock(conversationId)) {
    console.log('[ANA_REENGAGE_SKIP]', { conversationId, reason: 'active_appointment' });
    return;
  }

  const enterprise = conv.enterprise_id ? await getActiveEnterpriseById(conv.enterprise_id) : null;
  const cycleCount =
    conv.reengagement_for_user_message_id != null && conv.reengagement_for_user_message_id === lastUser.id
      ? Number(conv.reengagement_count ?? 0)
      : 0;
  const commercialFollowupText = resolveAnaCommercialFollowupMessage({
    enterpriseName: enterprise?.name ?? null,
    cycleCount,
  });
  const eligibleAt = commercialFollowupText
    ? computeCommercialFollowupEligibleAtUtc(new Date(lastUser.created_at), cycleCount)
    : computeEligibleReengagementAtUtc(new Date(lastUser.created_at));
  if (!eligibleAt) {
    console.log('[ANA_REENGAGE_SKIP]', { conversationId, reason: 'no_eligible_slot' });
    return;
  }

  const now = new Date();
  if (!isReengagementDueNow(new Date(lastUser.created_at), now, eligibleAt)) {
    return;
  }

  const to = (conv.contact_phone || conv.external_contact_id || '').replace(/\D/g, '');
  if (to.length < 10) {
    console.log('[ANA_REENGAGE_SKIP]', { conversationId, reason: 'no_phone' });
    return;
  }

  const aiSettings = await resolveAiSettingsForEnterprise(conv.enterprise_id ?? null);
  if (aiSettings.blocked || !aiSettings.aiEnabled) {
    console.log('[ANA_REENGAGE_SKIP]', { conversationId, reason: 'ai_disabled_or_blocked' });
    return;
  }

  const body = commercialFollowupText ?? buildReengagementMessageText(conv);

  console.log('[ANA_REENGAGE_ELIGIBLE]', {
    conversationId,
    userMessageId: lastUser.id,
    eligibleAt: eligibleAt.toISOString(),
    lastUserAt: new Date(lastUser.created_at).toISOString(),
  });

  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const lock = await client.query<ConversationRow>(
      `SELECT * FROM conversations WHERE id = $1 FOR UPDATE`,
      [conversationId]
    );
    const locked = lock.rows[0];
    if (!locked) {
      await client.query('ROLLBACK');
      return;
    }
    if (
      locked.handoff === true ||
      locked.manual_closed_at != null ||
      isBlockedClassification(locked.classification) ||
      locked.assigned_broker_id != null
    ) {
      await client.query('ROLLBACK');
      console.log('[ANA_REENGAGE_SKIP]', { conversationId, reason: 'changed_after_lock' });
      return;
    }

    const uRow = await client.query<{ id: number; created_at: Date }>(
      `SELECT id, created_at FROM messages
       WHERE conversation_id = $1 AND role = 'user' AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [conversationId]
    );
    const u = uRow.rows[0];
    if (!u || u.id !== lastUser.id) {
      await client.query('ROLLBACK');
      console.log('[ANA_REENGAGE_SKIP]', { conversationId, reason: 'user_message_changed' });
      return;
    }

    const lockedCycleCount =
      locked.reengagement_for_user_message_id != null && locked.reengagement_for_user_message_id === u.id
        ? Number(locked.reengagement_count ?? 0)
        : 0;
    const lockedEnterprise = locked.enterprise_id ? await getActiveEnterpriseById(locked.enterprise_id) : null;
    const lockedCommercialFollowupText = resolveAnaCommercialFollowupMessage({
      enterpriseName: lockedEnterprise?.name ?? null,
      cycleCount: lockedCycleCount,
    });
    const lockedEligibleAt = lockedCommercialFollowupText
      ? computeCommercialFollowupEligibleAtUtc(new Date(u.created_at), lockedCycleCount)
      : computeEligibleReengagementAtUtc(new Date(u.created_at));
    if (!lockedEligibleAt) {
      await client.query('ROLLBACK');
      return;
    }

    const lastVis = await client.query<{ role: string }>(
      `SELECT role FROM messages
       WHERE conversation_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC, id DESC LIMIT 1`,
      [conversationId]
    );
    if (lastVis.rows[0]?.role !== 'assistant') {
      await client.query('ROLLBACK');
      console.log('[ANA_REENGAGE_SKIP]', { conversationId, reason: 'last_not_assistant_locked' });
      return;
    }

    if (!isReengagementDueNow(new Date(u.created_at), new Date(), lockedEligibleAt)) {
      await client.query('ROLLBACK');
      return;
    }

    const outboundText = lockedCommercialFollowupText ?? body;
    const sendRes = await sendAnaTextMessageWithQuota({
      conversationId,
      to,
      text: outboundText,
      phase: lockedCommercialFollowupText ? 'ana_commercial_followup' : 'ana_reengagement',
    });
    if (!sendRes.success || !sendRes.metaMessageId) {
      await client.query('ROLLBACK');
      console.log('[ANA_REENGAGE_ERROR]', {
        conversationId,
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
      [conversationId, outboundText, sendRes.metaMessageId]
    );

    await client.query(
      `UPDATE conversations SET
         reengagement_sent_at = NOW(),
         reengagement_for_user_message_id = $1,
         reengagement_count = CASE
           WHEN reengagement_for_user_message_id = $1 THEN COALESCE(reengagement_count, 0) + 1
           ELSE 1
         END,
         last_message_at = NOW(),
         updated_at = NOW()
       WHERE id = $2`,
      [u.id, conversationId]
    );

    await client.query('COMMIT');
    await touchContactInteractionByConversation({ conversationId, role: 'assistant' });
    const inserted = insertResult.rows[0];
    if (inserted) {
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
    }
    console.log('[ANA_REENGAGE_SENT]', {
      conversationId,
      userMessageId: u.id,
      metaMessageId: sendRes.metaMessageId,
      textLen: body.length,
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}
