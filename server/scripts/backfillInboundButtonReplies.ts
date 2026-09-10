import 'dotenv/config';
import { query } from '../db/pg.js';
import type { WebhookMessage, WebhookPayload } from '../types/webhook.js';
import { extractWhatsAppInboundMessageText } from '../utils/whatsappInboundMessageText.js';

const PLACEHOLDERS = ['[Mensagem button]', '[Mensagem interactive]'] as const;

interface CandidateRow {
  id: number;
  meta_message_id: string;
  content: string | null;
  created_at: Date;
}

interface WebhookEventRow {
  id: number;
  meta_message_id: string | null;
  payload: string | null;
}

function parseArgs(): { apply: boolean; limit: number } {
  const args = process.argv.slice(2);
  const limitFlagIndex = args.findIndex((arg) => arg === '--limit');
  const limitRaw = limitFlagIndex >= 0 ? args[limitFlagIndex + 1] : null;
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 500;
  return {
    apply: args.includes('--apply'),
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(limit, 5000) : 500,
  };
}

async function countPlaceholders(): Promise<Record<(typeof PLACEHOLDERS)[number], number>> {
  const { rows } = await query<{ content: string; count: string }>(
    `SELECT content, COUNT(*)::text AS count
       FROM messages
      WHERE role = 'user'
        AND content = ANY($1::text[])
      GROUP BY content`,
    [[...PLACEHOLDERS]]
  );
  return {
    '[Mensagem button]': Number(rows.find((row) => row.content === '[Mensagem button]')?.count ?? 0),
    '[Mensagem interactive]': Number(rows.find((row) => row.content === '[Mensagem interactive]')?.count ?? 0),
  };
}

async function findCandidates(limit: number): Promise<CandidateRow[]> {
  const { rows } = await query<CandidateRow>(
    `SELECT id, meta_message_id, content, created_at
       FROM messages
      WHERE role = 'user'
        AND content = ANY($1::text[])
        AND meta_message_id IS NOT NULL
      ORDER BY id ASC
      LIMIT $2`,
    [[...PLACEHOLDERS], limit]
  );
  return rows;
}

function payloadMessages(payload: string | null): WebhookMessage[] {
  if (!payload) return [];
  try {
    const parsed = JSON.parse(payload) as WebhookPayload;
    const messages: WebhookMessage[] = [];
    for (const entry of parsed.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          messages.push(msg);
        }
      }
    }
    return messages;
  } catch {
    return [];
  }
}

function findMessageInPayload(payload: string | null, metaMessageId: string): WebhookMessage | null {
  return payloadMessages(payload).find((msg) => msg.id === metaMessageId) ?? null;
}

async function findWebhookMessage(
  metaMessageId: string,
  messageCreatedAt: Date
): Promise<{ msg: WebhookMessage; eventId: number } | null> {
  const indexed = await query<WebhookEventRow>(
    `SELECT id, meta_message_id, payload
       FROM webhook_events
      WHERE meta_message_id = $1
      ORDER BY created_at ASC, id ASC
      LIMIT 10`,
    [metaMessageId]
  );
  for (const event of indexed.rows) {
    const msg = findMessageInPayload(event.payload, metaMessageId);
    if (msg) return { msg, eventId: event.id };
  }

  const fallback = await query<WebhookEventRow>(
    `SELECT id, meta_message_id, payload
       FROM webhook_events
      WHERE direction = 'incoming'
        AND created_at >= $2::timestamptz - INTERVAL '2 days'
        AND created_at <= $2::timestamptz + INTERVAL '2 days'
      ORDER BY ABS(EXTRACT(EPOCH FROM (created_at - $2::timestamptz))) ASC, id ASC
      LIMIT 250`,
    [metaMessageId, messageCreatedAt]
  );
  for (const event of fallback.rows) {
    const msg = findMessageInPayload(event.payload, metaMessageId);
    if (msg) return { msg, eventId: event.id };
  }

  return null;
}

async function main() {
  const { apply, limit } = parseArgs();
  const before = await countPlaceholders();
  const candidates = await findCandidates(limit);

  let recovered = 0;
  let updated = 0;
  let skippedNoWebhookEvent = 0;
  let skippedNoText = 0;
  let skippedInvalidType = 0;

  console.log('[BACKFILL_INBOUND_BUTTON_REPLIES] inicio', {
    apply,
    limit,
    candidates: candidates.length,
    before,
  });

  for (const row of candidates) {
    const found = await findWebhookMessage(row.meta_message_id, row.created_at);
    if (!found) {
      skippedNoWebhookEvent += 1;
      continue;
    }

    if (found.msg.type !== 'button' && found.msg.type !== 'interactive') {
      skippedInvalidType += 1;
      continue;
    }

    const text = extractWhatsAppInboundMessageText(found.msg);
    if (!text) {
      skippedNoText += 1;
      continue;
    }

    recovered += 1;

    if (!apply) continue;

    const result = await query(
      `UPDATE messages
          SET content = $1,
              message_kind = 'text'
        WHERE id = $2
          AND role = 'user'
          AND content = ANY($3::text[])
          AND meta_message_id = $4`,
      [text, row.id, [...PLACEHOLDERS], row.meta_message_id]
    );
    updated += result.rowCount ?? 0;
  }

  const after = await countPlaceholders();
  console.log('[BACKFILL_INBOUND_BUTTON_REPLIES] resumo', {
    apply,
    limit,
    candidates: candidates.length,
    recovered,
    updated,
    skippedNoWebhookEvent,
    skippedInvalidType,
    skippedNoText,
    before,
    after,
  });
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[BACKFILL_INBOUND_BUTTON_REPLIES] erro fatal', error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
