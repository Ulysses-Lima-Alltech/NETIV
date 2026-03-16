import { getDb } from '../db/index.js';

export function logWebhookEvent(metaMessageId: string | null, eventType: string, payload: string): void {
  const database = getDb();
  database
    .prepare(
      `INSERT INTO webhook_events (meta_message_id, event_type, payload, processed) VALUES (?, ?, ?, 0)`
    )
    .run(metaMessageId, eventType, payload);
}

export function markWebhookEventProcessed(id: number): void {
  const database = getDb();
  database.prepare('UPDATE webhook_events SET processed = 1 WHERE id = ?').run(id);
}
