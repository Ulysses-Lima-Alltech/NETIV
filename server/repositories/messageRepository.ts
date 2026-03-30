import { query } from '../db/pg.js';
import { touchContactInteractionByConversation } from './contactsRepository.js';

export type MessageKindDb = 'text' | 'document' | 'image';

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
  return rows[0];
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
     WHERE conversation_id = $1 AND role = 'user'
     ORDER BY created_at DESC
     LIMIT 1`,
    [conversationId]
  );
  return rows[0]?.created_at ?? null;
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
