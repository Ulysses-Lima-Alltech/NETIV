import { query } from '../db/pg.js';

export interface MessageRow {
  id: number;
  conversation_id: number;
  role: string;
  content: string | null;
  meta_message_id: string | null;
  created_at: Date;
}

export async function insertMessage(
  conversationId: number,
  role: 'user' | 'assistant',
  content: string | null,
  metaMessageId: string | null
): Promise<MessageRow> {
  const { rows } = await query<MessageRow>(
    `INSERT INTO messages (conversation_id, role, content, meta_message_id) VALUES ($1, $2, $3, $4) RETURNING *`,
    [conversationId, role, content, metaMessageId]
  );
  await query(`UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`, [conversationId]);
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
