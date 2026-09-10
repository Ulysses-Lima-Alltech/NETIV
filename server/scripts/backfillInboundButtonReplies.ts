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

function collectMatchesFromEvents(
  lookup: Map<string, { msg: WebhookMessage; eventId: number }>,
  missingIds: Set<string>,
  events: WebhookEventRow[]
): void {
  for (const event of events) {
    for (const msg of payloadMessages(event.payload)) {
      if (missingIds.has(msg.id) && !lookup.has(msg.id)) {
        lookup.set(msg.id, { msg, eventId: event.id });
      }
    }
  }
}

function messageDayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

async function buildWebhookMessageLookup(
  candidates: CandidateRow[]
): Promise<Map<string, { msg: WebhookMessage; eventId: number }>> {
  const lookup = new Map<string, { msg: WebhookMessage; eventId: number }>();
  const ids = [...new Set(candidates.map((row) => row.meta_message_id))];
  if (ids.length === 0) return lookup;

  const indexed = await query<WebhookEventRow>(
    `SELECT id, meta_message_id, payload
       FROM webhook_events
      WHERE meta_message_id = ANY($1::text[])
      ORDER BY created_at ASC, id ASC`,
    [ids]
  );
  collectMatchesFromEvents(lookup, new Set(ids), indexed.rows);

  let missingIds = new Set(ids.filter((id) => !lookup.has(id)));
  const missingByDay = new Map<string, Set<string>>();
  for (const row of candidates) {
    if (!missingIds.has(row.meta_message_id)) continue;
    const day = messageDayKey(row.created_at);
    const group = missingByDay.get(day) ?? new Set<string>();
    group.add(row.meta_message_id);
    missingByDay.set(day, group);
  }

  for (const [day, dayIds] of missingByDay) {
    const fallback = await query<WebhookEventRow>(
      `SELECT id, meta_message_id, payload
         FROM webhook_events
        WHERE direction = 'incoming'
          AND created_at >= $1::date - INTERVAL '2 days'
          AND created_at < $1::date + INTERVAL '3 days'
        ORDER BY created_at ASC, id ASC
        LIMIT 5000`,
      [day]
    );
    collectMatchesFromEvents(lookup, dayIds, fallback.rows);
    missingIds = new Set([...missingIds].filter((id) => !lookup.has(id)));
    if (missingIds.size === 0) break;
  }

  return lookup;
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

  const webhookMessages = await buildWebhookMessageLookup(candidates);

  for (const row of candidates) {
    const found = webhookMessages.get(row.meta_message_id) ?? null;
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
