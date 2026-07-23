import { query } from '../db/pg.js';
import { withAnaVisitFollowupConversationLock } from './anaVisitFollowupJobRepository.js';
import { touchContactInteractionByConversation } from './contactsRepository.js';
import {
  type RealtimeMessagePayload,
  publishConversationUpdated,
  publishMessageCreated,
  publishMessageUpdated,
} from '../realtime/realtimePublisher.js';
import type { RenderedWhatsAppTemplateMessage } from '../utils/whatsappTemplateMessage.js';

export type MessageKindDb = 'text' | 'document' | 'image' | 'video';
export type MessageDeliveryStatus = 'pending' | 'accepted' | 'sent' | 'delivered' | 'read' | 'failed';

export interface MessageAttachmentPayload {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  whatsappMediaId?: string | null;
  caption?: string | null;
  enterpriseFileId?: number | null;
  templateMediaSettingId?: number | null;
  storageFolder?: string | null;
  mediaType?: 'image' | 'video' | 'document' | null;
}

export interface MessageFailurePayload {
  code: number | null;
  title: string | null;
  message: string;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: string;
  content: string | null;
  meta_message_id: string | null;
  message_kind?: MessageKindDb;
  attachment_json?: unknown | null;
  message_origin?: string | null;
  template_json?: unknown | null;
  delivery_status?: MessageDeliveryStatus;
  sent_at?: Date | null;
  delivered_at?: Date | null;
  read_at?: Date | null;
  failed_at?: Date | null;
  failure_json?: unknown | null;
  batch_id?: number | null;
  batch_recipient_id?: number | null;
  batch_row_number?: number | null;
  enterprise_id?: number | null;
  idempotency_key?: string | null;
  created_at: Date;
  /** Soft delete: timestamp em que foi apagada internamente (NULL = não apagada) */
  deleted_at?: Date | null;
  /** ID do usuário que executou o soft delete */
  deleted_by_user_id?: number | null;
  /** Escopo da exclusão: 'internal' = apenas no NETIV, nunca no WhatsApp do cliente */
  delete_scope?: string | null;
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function mapMessageRowToRealtimePayload(row: MessageRow): RealtimeMessagePayload {
  const rawAttachment = row.attachment_json && typeof row.attachment_json === 'object'
    ? (row.attachment_json as Record<string, unknown>)
    : null;
  const templateMediaSettingId = Number(rawAttachment?.templateMediaSettingId ?? 0) || null;
  return {
    id: String(row.id),
    conversationId: row.conversation_id,
    role: row.role as 'user' | 'assistant',
    direction: row.role === 'user' ? 'inbound' : 'outbound',
    content: row.content,
    metaMessageId: row.meta_message_id,
    externalMessageId: row.meta_message_id,
    messageKind: row.message_kind ?? 'text',
    type: row.message_kind ?? 'text',
    attachment: rawAttachment
      ? {
          ...rawAttachment,
          downloadUrl: templateMediaSettingId
            ? `/whatsapp/conversations/${row.conversation_id}/messages/${row.id}/attachment`
            : null,
        }
      : null,
    status: row.delivery_status ?? 'sent',
    template: row.template_json ?? null,
    failure: row.failure_json ?? null,
    origin: row.message_origin ?? null,
    batch: row.batch_id != null || row.batch_recipient_id != null
      ? {
          batchId: row.batch_id ?? null,
          recipientId: row.batch_recipient_id ?? null,
          rowNumber: row.batch_row_number ?? null,
        }
      : null,
    enterpriseId: row.enterprise_id ?? null,
    sentAt: toIso(row.sent_at),
    deliveredAt: toIso(row.delivered_at),
    readAt: toIso(row.read_at),
    failedAt: toIso(row.failed_at),
    createdAt: row.created_at.toISOString(),
    deleted: row.deleted_at != null,
    deletedAt: row.deleted_at ? row.deleted_at.toISOString() : null,
    deleteScope: row.delete_scope ?? null,
  };
}

export interface ConversationMessageSnippet {
  role: 'user' | 'assistant';
  content: string;
}

export interface ConversationMessageCounts {
  inbound_count: string;
  ana_outbound_count: string;
}

export async function getConversationMessageCounts(conversationId: number): Promise<{
  inboundCount: number;
  anaOutboundCount: number;
}> {
  const { rows } = await query<ConversationMessageCounts>(
    `SELECT
       COUNT(*) FILTER (WHERE role = 'user' AND deleted_at IS NULL)::text AS inbound_count,
       COUNT(*) FILTER (WHERE role = 'assistant' AND deleted_at IS NULL)::text AS ana_outbound_count
     FROM messages
     WHERE conversation_id = $1`,
    [conversationId]
  );
  const row = rows[0];
  return {
    inboundCount: parseInt(row?.inbound_count ?? '0', 10) || 0,
    anaOutboundCount: parseInt(row?.ana_outbound_count ?? '0', 10) || 0,
  };
}

export async function insertMessage(
  conversationId: number,
  role: 'user' | 'assistant',
  content: string | null,
  metaMessageId: string | null,
  opts?: {
    messageKind?: MessageKindDb;
    attachment?: MessageAttachmentPayload | null;
  }
): Promise<MessageRow> {
  if (role === 'user') {
    return withAnaVisitFollowupConversationLock(conversationId, () =>
      insertMessageUnlocked(conversationId, role, content, metaMessageId, opts)
    );
  }
  return insertMessageUnlocked(conversationId, role, content, metaMessageId, opts);
}

async function insertMessageUnlocked(
  conversationId: number,
  role: 'user' | 'assistant',
  content: string | null,
  metaMessageId: string | null,
  opts?: {
    messageKind?: MessageKindDb;
    attachment?: MessageAttachmentPayload | null;
  }
): Promise<MessageRow> {
  const messageKind: MessageKindDb =
    opts?.messageKind ?? (opts?.attachment != null ? 'document' : 'text');
  const attachmentJson = opts?.attachment != null ? JSON.stringify(opts.attachment) : null;

  const { rows } = await query<MessageRow>(
    `INSERT INTO messages (conversation_id, role, content, meta_message_id, message_kind, attachment_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING *`,
    [
      conversationId,
      role,
      content,
      metaMessageId,
      messageKind,
      attachmentJson,
    ]
  );
  await query(`UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`, [conversationId]);
  await touchContactInteractionByConversation({ conversationId, role });
  const inserted = rows[0];
  if (inserted) {
    publishMessageCreated(mapMessageRowToRealtimePayload(inserted));
    void publishConversationUpdated(inserted.conversation_id);
  }
  return inserted;
}

export async function upsertBatchTemplateMessage(params: {
  conversationId: number;
  rendered: RenderedWhatsAppTemplateMessage;
  attachment: MessageAttachmentPayload | null;
  metaMessageId: string | null;
  status: MessageDeliveryStatus;
  failure?: MessageFailurePayload | null;
  batchId: number;
  recipientId: number;
  rowNumber: number;
  enterpriseId: number | null;
  sentAt?: Date | null;
}): Promise<MessageRow> {
  const messageKind: MessageKindDb =
    params.rendered.header.type === 'image' || params.rendered.header.type === 'video' || params.rendered.header.type === 'document'
      ? params.rendered.header.type
      : 'text';
  const idempotencyKey = `whatsapp-batch-recipient:${params.recipientId}`;
  const failureJson = params.failure ? JSON.stringify(params.failure) : null;
  const { rows } = await query<MessageRow & { was_inserted: boolean }>(
    `INSERT INTO messages (
       conversation_id, role, content, meta_message_id, message_kind, attachment_json,
       message_origin, template_json, delivery_status, sent_at, failed_at, failure_json,
       batch_id, batch_recipient_id, batch_row_number, enterprise_id, idempotency_key
     ) VALUES (
       $1, 'assistant', $2, $3, $4, $5::jsonb,
       'batch_template_send', $6::jsonb, $7, $8, CASE WHEN $7 = 'failed' THEN NOW() ELSE NULL END, $9::jsonb,
       $10, $11, $12, $13, $14
     )
     ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
     DO UPDATE SET
       content = EXCLUDED.content,
       meta_message_id = COALESCE(EXCLUDED.meta_message_id, messages.meta_message_id),
       message_kind = EXCLUDED.message_kind,
       attachment_json = EXCLUDED.attachment_json,
       message_origin = EXCLUDED.message_origin,
       template_json = EXCLUDED.template_json,
       delivery_status = EXCLUDED.delivery_status,
       sent_at = COALESCE(EXCLUDED.sent_at, messages.sent_at),
       failed_at = EXCLUDED.failed_at,
       failure_json = EXCLUDED.failure_json,
       batch_id = EXCLUDED.batch_id,
       batch_recipient_id = EXCLUDED.batch_recipient_id,
       batch_row_number = EXCLUDED.batch_row_number,
       enterprise_id = EXCLUDED.enterprise_id
     RETURNING *, (xmax = 0) AS was_inserted`,
    [
      params.conversationId,
      params.rendered.renderedText,
      params.metaMessageId,
      messageKind,
      params.attachment ? JSON.stringify(params.attachment) : null,
      JSON.stringify(params.rendered),
      params.status,
      params.sentAt ?? (params.status === 'failed' ? null : new Date()),
      failureJson,
      params.batchId,
      params.recipientId,
      params.rowNumber,
      params.enterpriseId,
      idempotencyKey,
    ]
  );
  const persisted = rows[0];
  if (!persisted) throw new Error('Falha ao persistir mensagem can?nica do template.');
  const payload = mapMessageRowToRealtimePayload(persisted);
  if (persisted.was_inserted) publishMessageCreated(payload);
  else publishMessageUpdated(payload);
  await query(`UPDATE conversations SET last_message_at = GREATEST(COALESCE(last_message_at, NOW()), NOW()), updated_at = NOW() WHERE id = $1`, [params.conversationId]);
  await touchContactInteractionByConversation({ conversationId: params.conversationId, role: 'assistant' });
  void publishConversationUpdated(params.conversationId);
  return persisted;
}

export async function updateMessageDeliveryStatusByMetaId(params: {
  metaMessageId: string;
  status: Exclude<MessageDeliveryStatus, 'pending' | 'accepted'>;
  occurredAt: Date;
  failure?: MessageFailurePayload | null;
}): Promise<MessageRow | null> {
  const failureJson = params.failure ? JSON.stringify(params.failure) : null;
  const { rows } = await query<MessageRow>(
    `UPDATE messages
        SET delivery_status = CASE
              WHEN delivery_status = 'read' THEN 'read'
              WHEN $2 = 'read' THEN 'read'
              WHEN delivery_status = 'failed' AND $2 <> 'read' THEN 'failed'
              WHEN $2 = 'failed' THEN 'failed'
              WHEN $2 = 'delivered' AND delivery_status IN ('pending', 'accepted', 'sent') THEN 'delivered'
              WHEN $2 = 'sent' AND delivery_status IN ('pending', 'accepted') THEN 'sent'
              ELSE delivery_status
            END,
            sent_at = CASE WHEN $2 = 'sent' THEN COALESCE(sent_at, $3) ELSE sent_at END,
            delivered_at = CASE WHEN $2 = 'delivered' THEN COALESCE(delivered_at, $3) ELSE delivered_at END,
            read_at = CASE WHEN $2 = 'read' THEN COALESCE(read_at, $3) ELSE read_at END,
            failed_at = CASE WHEN $2 = 'failed' AND delivery_status <> 'read' THEN COALESCE(failed_at, $3) ELSE failed_at END,
            failure_json = CASE WHEN $2 = 'failed' AND delivery_status <> 'read' THEN $4::jsonb ELSE failure_json END
      WHERE meta_message_id = $1
      RETURNING *`,
    [params.metaMessageId, params.status, params.occurredAt, failureJson]
  );
  const updated = rows[0] ?? null;
  if (updated) publishMessageUpdated(mapMessageRowToRealtimePayload(updated));
  return updated;
}

export async function getMessageCreatedAtById(messageId: number): Promise<Date | null> {
  const { rows } = await query<{ created_at: Date }>(
    `SELECT created_at FROM messages WHERE id = $1 LIMIT 1`,
    [messageId]
  );
  return rows[0]?.created_at ?? null;
}

export async function findMessageByMetaId(metaMessageId: string): Promise<MessageRow | null> {
  const { rows } = await query<MessageRow>(`SELECT * FROM messages WHERE meta_message_id = $1 LIMIT 1`, [
    metaMessageId,
  ]);
  return rows[0] ?? null;
}

export async function getMessageByIdForConversation(messageId: number, conversationId: number): Promise<MessageRow | null> {
  const { rows } = await query<MessageRow>(
    `SELECT * FROM messages WHERE id = $1 AND conversation_id = $2 LIMIT 1`,
    [messageId, conversationId]
  );
  return rows[0] ?? null;
}

export async function getMessagesByConversationId(conversationId: number): Promise<MessageRow[]> {
  const { rows } = await query<MessageRow>(
    `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );
  return rows;
}

export async function getRecentUserMessageTexts(
  conversationId: number,
  limit: number = 8
): Promise<string[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 8;
  const { rows } = await query<{ content: string | null }>(
    `SELECT content
       FROM messages
      WHERE conversation_id = $1
        AND role = 'user'
        AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [conversationId, safeLimit]
  );
  return rows
    .map((row) => (row.content || '').trim())
    .filter((text) => text.length > 0)
    .reverse();
}

export async function getRecentConversationMessages(
  conversationId: number,
  limit: number = 12
): Promise<ConversationMessageSnippet[]> {
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(60, Math.floor(limit))) : 12;
  const { rows } = await query<{ role: string; content: string | null }>(
    `SELECT role, content
       FROM messages
      WHERE conversation_id = $1
        AND deleted_at IS NULL
        AND role IN ('user', 'assistant')
      ORDER BY created_at DESC, id DESC
      LIMIT $2`,
    [conversationId, safeLimit]
  );
  return rows
    .map((row) => ({
      role: row.role === 'assistant' ? ('assistant' as const) : ('user' as const),
      content: (row.content || '').trim(),
    }))
    .filter((row) => row.content.length > 0)
    .reverse();
}

export async function getLastInboundUserMessageAt(conversationId: number): Promise<Date | null> {
  const { rows } = await query<{ created_at: Date }>(
    `SELECT created_at
     FROM messages
     WHERE conversation_id = $1 AND role = 'user' AND deleted_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
    [conversationId]
  );
  return rows[0]?.created_at ?? null;
}

/** Última mensagem visível (não apagada internamente) da conversa — papel e id. */
export async function getLastVisibleMessageRoleAndId(
  conversationId: number
): Promise<{ role: 'user' | 'assistant'; id: number; created_at: Date } | null> {
  const { rows } = await query<{ role: string; id: number; created_at: Date }>(
    `SELECT role, id, created_at
     FROM messages
     WHERE conversation_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [conversationId]
  );
  const r = rows[0];
  if (!r) return null;
  const role = r.role === 'user' ? 'user' : 'assistant';
  return { role, id: r.id, created_at: r.created_at };
}

/** Última mensagem inbound do cliente (não apagada). */
export async function getLastUserMessageRow(conversationId: number): Promise<MessageRow | null> {
  const { rows } = await query<MessageRow>(
    `SELECT *
     FROM messages
     WHERE conversation_id = $1 AND role = 'user' AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [conversationId]
  );
  return rows[0] ?? null;
}

export async function hasAssistantMessageAfterMessageId(
  conversationId: number,
  inboundMessageId: number
): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1
       FROM messages
       WHERE conversation_id = $1
         AND role = 'assistant'
         AND deleted_at IS NULL
         AND id > $2
     ) AS exists`,
    [conversationId, inboundMessageId]
  );
  return rows[0]?.exists === true;
}

/**
 * Última mensagem do usuário que ainda precisa de resposta da IA.
 * Lógica: compara última mensagem do usuário vs última da IA.
 * Retorna a mensagem do usuário se não existe IA ou se o usuário é mais recente.
 */
/**
 * Mensagens de usuário consecutivas no fim do histórico (após a última mensagem da assistente).
 * Usado para consolidar rajadas de texto no WhatsApp antes de gerar uma única resposta.
 */
export async function getTrailingUserMessageBurst(conversationId: number): Promise<MessageRow[]> {
  const rows = await getMessagesByConversationId(conversationId);
  const burst: MessageRow[] = [];
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.role === 'user' && (r.content || '').trim()) {
      burst.unshift(r);
    } else {
      break;
    }
  }
  return burst;
}

/**
 * Soft delete de mensagem: marca como apagada internamente (NETIV).
 * NÃO remove do banco; NÃO toca no WhatsApp do cliente.
 * Retorna null se a mensagem não existir ou já estiver apagada.
 */
export async function softDeleteMessage(
  messageId: number,
  deletedByUserId: number,
): Promise<MessageRow | null> {
  const { rows } = await query<MessageRow>(
    `UPDATE messages
     SET deleted_at = NOW(),
         deleted_by_user_id = $1,
         delete_scope = 'internal'
     WHERE id = $2 AND deleted_at IS NULL
     RETURNING *`,
    [deletedByUserId, messageId],
  );
  const deleted = rows[0] ?? null;
  if (deleted) {
    publishMessageUpdated({
      id: String(deleted.id),
      conversationId: deleted.conversation_id,
      deleted: true,
      deletedAt: deleted.deleted_at ? deleted.deleted_at.toISOString() : null,
    });
    void publishConversationUpdated(deleted.conversation_id);
  }
  return deleted;
}

export async function getLastUserMessageNeedingReply(conversationId: number): Promise<MessageRow | null> {
  const [userRows, assistantRows] = await Promise.all([
    query<MessageRow>(
      `SELECT * FROM messages WHERE conversation_id = $1 AND role = 'user' ORDER BY created_at DESC LIMIT 1`,
      [conversationId]
    ),
    query<MessageRow>(
      `SELECT * FROM messages WHERE conversation_id = $1 AND role = 'assistant' ORDER BY created_at DESC LIMIT 1`,
      [conversationId]
    ),
  ]);
  const lastUser = userRows.rows[0];
  if (!lastUser || !lastUser.content?.trim()) return null;
  const lastAssistant = assistantRows.rows[0];
  if (!lastAssistant) return lastUser;
  const userTime = new Date(lastUser.created_at).getTime();
  const assistantTime = new Date(lastAssistant.created_at).getTime();
  return userTime > assistantTime ? lastUser : null;
}
