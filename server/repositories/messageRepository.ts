import { query } from '../db/pg.js';
import { touchContactInteractionByConversation } from './contactsRepository.js';
import { emitWhatsAppEvent } from '../services/whatsappEvents.js';

export type MessageKindDb = 'text' | 'document' | 'image' | 'video';

export interface MessageAttachmentPayload {
  fileName: string;
  mimeType: string;
  sizeBytes?: number;
  whatsappMediaId?: string | null;
  caption?: string | null;
  enterpriseFileId?: number | null;
}

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: string;
  content: string | null;
  meta_message_id: string | null;
  message_kind?: MessageKindDb;
  attachment_json?: unknown | null;
  created_at: Date;
  /** Soft delete: timestamp em que foi apagada internamente (NULL = não apagada) */
  deleted_at?: Date | null;
  /** ID do usuário que executou o soft delete */
  deleted_by_user_id?: number | null;
  /** Escopo da exclusão: 'internal' = apenas no NETIV, nunca no WhatsApp do cliente */
  delete_scope?: string | null;
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
    emitWhatsAppEvent('message.created', {
      id: String(inserted.id),
      conversationId: inserted.conversation_id,
      role: inserted.role,
      content: inserted.content,
      metaMessageId: inserted.meta_message_id,
      messageKind: inserted.message_kind ?? 'text',
      attachment: inserted.attachment_json ?? null,
      createdAt: inserted.created_at.toISOString(),
      deleted: inserted.deleted_at != null,
      deletedAt: inserted.deleted_at ? inserted.deleted_at.toISOString() : null,
    });
    emitWhatsAppEvent('conversation.updated', {
      conversationId: inserted.conversation_id,
      updatedAt: inserted.created_at.toISOString(),
      lastMessagePreview: inserted.content ?? '',
    });
  }
  return inserted;
}

export async function findMessageByMetaId(metaMessageId: string): Promise<MessageRow | null> {
  const { rows } = await query<MessageRow>(`SELECT * FROM messages WHERE meta_message_id = $1 LIMIT 1`, [
    metaMessageId,
  ]);
  return rows[0] ?? null;
}

export async function getMessagesByConversationId(conversationId: number): Promise<MessageRow[]> {
  const { rows } = await query<MessageRow>(
    `SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC`,
    [conversationId]
  );
  return rows;
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
): Promise<{ role: 'user' | 'assistant'; id: number } | null> {
  const { rows } = await query<{ role: string; id: number }>(
    `SELECT role, id
     FROM messages
     WHERE conversation_id = $1 AND deleted_at IS NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1`,
    [conversationId]
  );
  const r = rows[0];
  if (!r) return null;
  const role = r.role === 'user' ? 'user' : 'assistant';
  return { role, id: r.id };
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
    emitWhatsAppEvent('message.updated', {
      id: String(deleted.id),
      conversationId: deleted.conversation_id,
      deleted: true,
      deletedAt: deleted.deleted_at ? deleted.deleted_at.toISOString() : null,
    });
    emitWhatsAppEvent('conversation.updated', {
      conversationId: deleted.conversation_id,
      updatedAt: new Date().toISOString(),
      lastMessagePreview: null,
    });
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
