import { getDb } from '../db/index.js';

export interface ConversationRow {
  id: number;
  channel: string;
  external_id: string;
  contact_phone: string | null;
  contact_name: string | null;
  meta_phone_number_id: string | null;
  status: string;
  last_message_at: string | null;
  lead_stage: string;
  lead_score: number;
  lead_intent_now: string;
  lead_reason: string | null;
  lead_last_analyzed_at: string | null;
  project: string | null;
  project_id: number | null;
  classification_status: string;
  created_at: string;
  updated_at: string;
}

export function findOrCreateConversation(
  channel: string,
  externalId: string,
  contactPhone: string | null,
  contactName: string | null,
  metaPhoneNumberId: string | null
): ConversationRow {
  const database = getDb();
  let row = database
    .prepare(
      `SELECT id, channel, external_id, contact_phone, contact_name, meta_phone_number_id, status, last_message_at,
              lead_stage, lead_score, lead_intent_now, lead_reason, lead_last_analyzed_at, project, project_id, classification_status, created_at, updated_at
       FROM conversations WHERE channel = ? AND external_id = ?`
    )
    .get(channel, externalId) as ConversationRow | undefined;

  if (row) {
  database
    .prepare(
      `UPDATE conversations SET contact_phone = ?, contact_name = ?, meta_phone_number_id = ?, updated_at = datetime('now')
         WHERE id = ?`
    )
    .run(contactPhone ?? row.contact_phone, contactName ?? row.contact_name, metaPhoneNumberId ?? row.meta_phone_number_id, row.id);
    database.prepare(`UPDATE conversations SET last_message_at = datetime('now') WHERE id = ?`).run(row.id);
    return database.prepare('SELECT * FROM conversations WHERE id = ?').get(row.id) as ConversationRow;
  }

  const result = database
    .prepare(
      `INSERT INTO conversations (channel, external_id, contact_phone, contact_name, meta_phone_number_id, status, last_message_at)
       VALUES (?, ?, ?, ?, ?, 'open', datetime('now'))`
    )
    .run(channel, externalId, contactPhone, contactName, metaPhoneNumberId);
  return database.prepare('SELECT * FROM conversations WHERE id = ?').get(result.lastInsertRowid) as ConversationRow;
}

export function getConversationById(id: number): ConversationRow | null {
  const database = getDb();
  const row = database.prepare('SELECT * FROM conversations WHERE id = ?').get(id);
  return (row as ConversationRow) ?? null;
}

export function listConversations(channel: string = 'whatsapp', limit: number = 100): ConversationRow[] {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT * FROM conversations WHERE channel = ? ORDER BY COALESCE(last_message_at, updated_at, created_at) DESC LIMIT ?`
    )
    .all(channel, limit);
  return rows as ConversationRow[];
}

export interface ConversationWithPreview extends ConversationRow {
  last_message_preview: string | null;
  project_name: string | null;
}

export function listConversationsWithPreview(channel: string = 'whatsapp', limit: number = 100): ConversationWithPreview[] {
  const database = getDb();
  const rows = database
    .prepare(
      `SELECT c.*,
        (SELECT COALESCE(content, body_text) FROM messages WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 1) as last_message_preview,
        p.name as project_name
       FROM conversations c
       LEFT JOIN projects p ON p.id = c.project_id
       WHERE c.channel = ?
       ORDER BY COALESCE(c.last_message_at, c.updated_at, c.created_at) DESC
       LIMIT ?`
    )
    .all(channel, limit);
  return rows as ConversationWithPreview[];
}

export function updateClassification(
  conversationId: number,
  update: { project_id?: number | null; classification_status?: string }
): ConversationRow | null {
  const database = getDb();
  const current = database.prepare('SELECT id, project_id, classification_status FROM conversations WHERE id = ?').get(conversationId) as
    | { id: number; project_id: number | null; classification_status: string }
    | undefined;
  if (!current) return null;
  const project_id = update.project_id !== undefined ? update.project_id : current.project_id;
  const classification_status = update.classification_status !== undefined ? update.classification_status : current.classification_status;
  database
    .prepare("UPDATE conversations SET project_id = ?, classification_status = ?, updated_at = datetime('now') WHERE id = ?")
    .run(project_id, classification_status, conversationId);
  return getConversationById(conversationId);
}
