import { query } from '../db/pg.js';

export async function logWebhookEvent(
  metaMessageId: string | null,
  direction: string,
  payload: string
): Promise<void> {
  await query(`INSERT INTO webhook_events (meta_message_id, direction, payload) VALUES ($1, $2, $3)`, [
    metaMessageId,
    direction,
    payload,
  ]);
}
