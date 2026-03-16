import { getDb } from '../db/index.js';
import type { MessageDirection } from '../types/whatsapp.js';

export interface MessageRow {
  id: number;
  conversation_id: number;
  direction: MessageDirection;
  meta_message_id: string | null;
  status: string;
  body_text: string | null;
  content: string | null;
  type: string;
  raw_payload: string | null;
  created_at: string;
}

export function insertMessage(
  conversationId: number,
  direction: MessageDirection,
  metaMessageId: string | null,
  status: string,
  bodyText: string | null,
  rawPayload: string | null
): MessageRow {
  const database = getDb();
  const result = database
    .prepare(
      `INSERT INTO messages (conversation_id, direction, meta_message_id, status, body_text, content, type, raw_payload)
       VALUES (?, ?, ?, ?, ?, ?, 'text', ?)`
    )
    .run(conversationId, direction, metaMessageId ?? null, status, bodyText, bodyText, rawPayload);
  database.prepare(`UPDATE conversations SET updated_at = datetime('now'), last_message_at = datetime('now') WHERE id = ?`).run(conversationId);
  return database.prepare('SELECT * FROM messages WHERE id = ?').get(result.lastInsertRowid) as MessageRow;
}

export function findMessageByMetaId(metaMessageId: string): MessageRow | null {
  const database = getDb();
  const row = database.prepare('SELECT * FROM messages WHERE meta_message_id = ?').get(metaMessageId);
  return (row as MessageRow) ?? null;
}

export function getMessagesByConversationId(conversationId: number): MessageRow[] {
  const database = getDb();
  const rows = database
    .prepare('SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC')
    .all(conversationId);
  return rows as MessageRow[];
}

export function updateMessageStatusByExternalId(externalMessageId: string, status: string, deliveredAt?: string | null, readAt?: string | null, errorMessage?: string | null): void {
  const database = getDb();
  database
    .prepare(
      `UPDATE messages SET status = ?, delivered_at = COALESCE(?, delivered_at), read_at = COALESCE(?, read_at), error_message = COALESCE(?, error_message), updated_at = datetime('now') WHERE meta_message_id = ?`
    )
    .run(status, deliveredAt ?? null, readAt ?? null, errorMessage ?? null, externalMessageId);
}
