#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { Pool } = require('pg');
const dotenv = require('dotenv');

dotenv.config({ path: path.resolve(__dirname, '..', '.env') });
dotenv.config();

const DEFAULT_FROM = '2026-07-04T20:00:00.000Z';
const DEFAULT_TO = '2026-07-04T22:00:00.000Z';
const FOLLOWUP_PATTERNS = [
  '%retomando por aqui%',
  '%conversa ficou em aberto%',
  '%não perder seu atendimento%',
  '%nÃ£o perder%',
  '%SÃ³ retomando%',
  '%SÃƒÂ³ retomando%',
  '%nÃƒÂ£o perder%',
];

function readArg(name, fallback) {
  const prefix = `${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  if (found) return found.slice(prefix.length);
  const idx = process.argv.indexOf(name);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function asIsoDate(value, label) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
  return date.toISOString();
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = $1
     ) AS exists`,
    [tableName]
  );
  return rows[0]?.exists === true;
}

async function columnsFor(client, tableName) {
  const { rows } = await client.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1`,
    [tableName]
  );
  return new Set(rows.map((row) => row.column_name));
}

function selectColumn(columns, tableAlias, columnName, alias = columnName) {
  if (!columns.has(columnName)) return `NULL AS ${alias}`;
  return `${tableAlias}.${columnName} AS ${alias}`;
}

function groupBy(items, keyFn) {
  const out = new Map();
  for (const item of items) {
    const key = keyFn(item);
    out.set(key, (out.get(key) ?? 0) + 1);
  }
  return [...out.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)));
}

function minuteKey(value) {
  const date = new Date(value);
  date.setUTCSeconds(0, 0);
  return date.toISOString();
}

function inferOrigin(row, visitAttemptByAssistantId, visitAttemptByMetaId) {
  if (visitAttemptByAssistantId.has(String(row.id))) return 'ana_visit_followup_attempt';
  if (row.meta_message_id && visitAttemptByMetaId.has(String(row.meta_message_id))) return 'ana_visit_followup_attempt';
  const content = String(row.content ?? '').toLowerCase();
  if (content.includes('retomando por aqui') || content.includes('conversa ficou em aberto')) {
    return 'ana_reengagement_followup';
  }
  if (content.includes('não perder seu atendimento') || content.includes('nã')) {
    return 'ana_reengagement_followup_or_mojibake_variant';
  }
  return 'assistant_outbound_unknown';
}

async function main() {
  const from = asIsoDate(readArg('--from', DEFAULT_FROM), '--from');
  const to = asIsoDate(readArg('--to', DEFAULT_TO), '--to');
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/netiv';
  const json = process.argv.includes('--json');
  const pool = new Pool({ connectionString: databaseUrl, max: 3 });
  const client = await pool.connect();

  try {
    const messagesColumns = await columnsFor(client, 'messages');
    const conversationsColumns = await columnsFor(client, 'conversations');
    const messageSelect = [
      'm.id',
      'm.conversation_id',
      'm.role',
      'm.content',
      'm.created_at',
      selectColumn(messagesColumns, 'm', 'meta_message_id'),
      selectColumn(messagesColumns, 'm', 'status'),
      selectColumn(messagesColumns, 'm', 'metadata'),
      selectColumn(messagesColumns, 'm', 'message_kind'),
      selectColumn(messagesColumns, 'm', 'attachment_json'),
      selectColumn(conversationsColumns, 'c', 'customer_name', 'conversation_customer_name'),
      selectColumn(conversationsColumns, 'c', 'classification', 'conversation_classification'),
      selectColumn(conversationsColumns, 'c', 'handoff', 'conversation_handoff'),
      selectColumn(conversationsColumns, 'c', 'assigned_broker_id', 'conversation_assigned_broker_id'),
      selectColumn(conversationsColumns, 'c', 'manual_closed_at', 'conversation_manual_closed_at'),
      selectColumn(conversationsColumns, 'c', 'ana_followup_status', 'conversation_ana_followup_status'),
      selectColumn(conversationsColumns, 'c', 'ana_followup_attempt_count', 'conversation_ana_followup_attempt_count'),
      selectColumn(conversationsColumns, 'c', 'ana_followup_next_at', 'conversation_ana_followup_next_at'),
      selectColumn(conversationsColumns, 'c', 'ana_followup_last_sent_message_id', 'conversation_ana_followup_last_sent_message_id'),
      selectColumn(conversationsColumns, 'c', 'reengagement_count', 'conversation_reengagement_count'),
    ].join(',\n      ');

    const { rows: messages } = await client.query(
      `SELECT
         ${messageSelect}
       FROM messages m
       LEFT JOIN conversations c ON c.id = m.conversation_id
       WHERE m.role = 'assistant'
         AND m.created_at >= $1::timestamptz
         AND m.created_at < $2::timestamptz
         AND (
           m.content ILIKE ANY($3::text[])
           OR m.content LIKE '%Ãƒ%'
           OR m.content LIKE '%Ã‚%'
           OR m.content LIKE '%ï¿½%'
         )
       ORDER BY m.created_at ASC, m.id ASC`,
      [from, to, FOLLOWUP_PATTERNS]
    );

    const visitAttemptByAssistantId = new Set();
    const visitAttemptByMetaId = new Set();
    let visitAttempts = [];
    if (await tableExists(client, 'ana_visit_followup_attempts')) {
      const { rows } = await client.query(
        `SELECT *
           FROM ana_visit_followup_attempts
          WHERE created_at >= $1::timestamptz
            AND created_at < $2::timestamptz
          ORDER BY created_at ASC, id ASC`,
        [from, to]
      );
      visitAttempts = rows;
      for (const row of rows) {
        if (row.assistant_message_id != null) visitAttemptByAssistantId.add(String(row.assistant_message_id));
        if (row.meta_message_id != null) visitAttemptByMetaId.add(String(row.meta_message_id));
      }
    }

    const affectedConversationIds = [...new Set(messages.map((row) => String(row.conversation_id)))];
    const origins = messages.map((row) => inferOrigin(row, visitAttemptByAssistantId, visitAttemptByMetaId));

    let retryJobs = [];
    if (await tableExists(client, 'ana_retry_jobs')) {
      const { rows } = await client.query(
        `SELECT *
           FROM ana_retry_jobs
          WHERE (
            created_at >= $1::timestamptz AND created_at < $2::timestamptz
          ) OR (
            updated_at >= $1::timestamptz AND updated_at < $2::timestamptz
          ) OR (
            next_run_at >= $1::timestamptz AND next_run_at < $2::timestamptz
          )
          ORDER BY updated_at ASC, id ASC`,
        [from, to]
      );
      retryJobs = rows;
    }

    let anaTurnAudit = [];
    if (await tableExists(client, 'ana_turn_audit')) {
      const auditColumns = await columnsFor(client, 'ana_turn_audit');
      const auditTimeColumn = auditColumns.has('created_at') ? 'created_at' : auditColumns.has('updated_at') ? 'updated_at' : null;
      if (auditTimeColumn) {
        const { rows } = await client.query(
          `SELECT *
             FROM ana_turn_audit
            WHERE ${auditTimeColumn} >= $1::timestamptz
              AND ${auditTimeColumn} < $2::timestamptz
            ORDER BY ${auditTimeColumn} ASC
            LIMIT 500`,
          [from, to]
        );
        anaTurnAudit = rows;
      }
    }

    const report = {
      dryRun: true,
      window: { from, to },
      affectedConversationIds,
      counts: {
        messages: messages.length,
        conversations: affectedConversationIds.length,
        visitAttempts: visitAttempts.length,
        retryJobs: retryJobs.length,
        anaTurnAuditRows: anaTurnAudit.length,
      },
      summaryByMinute: groupBy(messages, (row) => minuteKey(row.created_at)),
      summaryByContent: groupBy(messages, (row) => String(row.content ?? '').slice(0, 220)),
      summaryByPossibleOrigin: groupBy(origins, (value) => value),
      messages,
      retryJobs,
      visitAttempts,
      anaTurnAudit,
    };

    if (json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }

    console.log('[incident-20260704-diagnose-followup-spam] dry-run report');
    console.log(`window: ${from} -> ${to}`);
    console.log(`messages=${report.counts.messages} conversations=${report.counts.conversations}`);
    console.log('affectedConversationIds:', affectedConversationIds.join(', ') || '(none)');
    console.log('summaryByMinute:', report.summaryByMinute);
    console.log('summaryByPossibleOrigin:', report.summaryByPossibleOrigin);
    console.log('summaryByContent:', report.summaryByContent);
    console.log('retryJobs:', retryJobs.length);
    console.log('visitAttempts:', visitAttempts.length);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[incident-20260704-diagnose-followup-spam] failed', error);
  process.exitCode = 1;
});
