#!/usr/bin/env node
import 'dotenv/config';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

const { Pool } = pg;
const TZ = 'America/Sao_Paulo';
const DEFAULT_LIMIT = 20;

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const part = argv[i];
    if (!part.startsWith('--')) continue;
    const key = part.slice(2);
    const next = argv[i + 1];
    if (next == null || next.startsWith('--')) {
      args[key] = 'true';
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function loadLocalEnvFallback() {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '.env.local'),
    resolve(process.cwd(), '.env.development'),
    resolve(process.cwd(), 'server', '.env'),
    resolve(process.cwd(), 'server', '.env.local'),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    dotenv.config({ path: file, override: false });
  }
}

function requireDate(value, name) {
  if (!value) throw new Error(`Parametro obrigatorio ausente: --${name}`);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Parametro --${name} invalido: ${value}`);
  return date;
}

function requireMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) throw new Error('Parametro --total-cost-usd deve ser numerico e >= 0.');
  return n;
}

function money(n) {
  return `$${n.toFixed(4)}`;
}

function num(n) {
  return new Intl.NumberFormat('pt-BR').format(Number(n || 0));
}

function dec(n, digits = 2) {
  return new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(Number(n || 0));
}

function pct(n) {
  return `${dec(n * 100, 1)}%`;
}

function maskIdentifier(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  if (digits.length >= 8) return `***${digits.slice(-4)}`;
  if (s.length > 16) return `${s.slice(0, 4)}…${s.slice(-4)}`;
  return s;
}

function printSection(title) {
  console.log(`\n${title}`);
  console.log('-'.repeat(title.length));
}

function printTable(rows, columns, limit = DEFAULT_LIMIT) {
  const shown = rows.slice(0, limit);
  if (shown.length === 0) {
    console.log('(sem dados)');
    return;
  }
  const widths = columns.map((col) => {
    const values = shown.map((row) => String(col.value(row)));
    return Math.min(48, Math.max(col.label.length, ...values.map((v) => v.length)));
  });
  console.log(columns.map((col, i) => col.label.padEnd(widths[i])).join('  '));
  console.log(widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of shown) {
    console.log(
      columns
        .map((col, i) => {
          const value = String(col.value(row));
          const clipped = value.length > widths[i] ? `${value.slice(0, widths[i] - 1)}…` : value;
          return col.align === 'right' ? clipped.padStart(widths[i]) : clipped.padEnd(widths[i]);
        })
        .join('  ')
    );
  }
}

async function tableExists(client, tableName) {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = $1
     ) AS ok`,
    [tableName]
  );
  return rows[0]?.ok === true;
}

async function getColumns(client, tableName) {
  const { rows } = await client.query(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [tableName]
  );
  return new Set(rows.map((r) => r.column_name));
}

function jsonNumber(value, paths) {
  for (const path of paths) {
    let cur = value;
    for (const key of path) {
      if (cur == null || typeof cur !== 'object') {
        cur = null;
        break;
      }
      cur = cur[key];
    }
    const n = Number(cur);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return 0;
}

function jsonFlag(value, needles) {
  const raw = JSON.stringify(value ?? {}).toLowerCase();
  return needles.some((needle) => raw.includes(needle));
}

function leadLabel(row) {
  return (
    row.customer_name ||
    row.full_name ||
    maskIdentifier(row.phone_e164) ||
    maskIdentifier(row.contact_phone) ||
    maskIdentifier(row.external_contact_id) ||
    `conversation:${row.conversation_id}`
  );
}

function effortUnits(row) {
  const retries = Number(row.retry_count || 0);
  const fallbacks = Number(row.fallback_count || 0);
  const anaMessages = Number(row.ana_messages || 0);
  const audits = Number(row.audit_turns || 0);
  const totalMessages = Number(row.total_messages || 0);
  return anaMessages * 3 + audits * 5 + retries * 4 + fallbacks * 6 + totalMessages;
}

function applyCostAllocation(rows, totalCostUsd, hasRealCost) {
  if (hasRealCost) {
    return rows.map((row) => ({
      ...row,
      estimated_cost_usd: Number(row.real_cost_usd || 0),
      effort_units: Number(row.effort_units || 0),
    }));
  }
  const withEffort = rows.map((row) => ({ ...row, effort_units: effortUnits(row) }));
  const totalEffort = withEffort.reduce((sum, row) => sum + row.effort_units, 0);
  const fallbackDenominator = Math.max(1, withEffort.length);
  return withEffort.map((row) => ({
    ...row,
    estimated_cost_usd:
      totalEffort > 0 ? (row.effort_units / totalEffort) * totalCostUsd : totalCostUsd / fallbackDenominator,
  }));
}

async function main() {
  loadLocalEnvFallback();

  const args = parseArgs(process.argv);
  const start = requireDate(args.start, 'start');
  const end = requireDate(args.end, 'end');
  const totalCostUsd = requireMoney(args['total-cost-usd']);
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/netiv';
  if (!process.env.DATABASE_URL) {
    console.warn('Aviso: DATABASE_URL nao definido; usando fallback local postgresql://localhost:5432/netiv');
  }

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const client = await pool.connect();

  try {
    const requiredTables = ['contacts', 'conversations', 'messages', 'enterprises', 'integration_settings'];
    const exists = Object.fromEntries(await Promise.all(requiredTables.map(async (t) => [t, await tableExists(client, t)])));
    const hasAudit = await tableExists(client, 'ana_turn_audit');
    const hasAnaDiagnostics = await tableExists(client, 'ana_diagnostics');
    const auditColumns = hasAudit ? await getColumns(client, 'ana_turn_audit') : new Set();
    const messageColumns = exists.messages ? await getColumns(client, 'messages') : new Set();
    const contactColumns = exists.contacts ? await getColumns(client, 'contacts') : new Set();

    for (const table of requiredTables) {
      if (!exists[table]) throw new Error(`Tabela obrigatoria nao encontrada: ${table}`);
    }

    const hasContactId = auditColumns.has('contact_id');
    const hasResolvedEnterprise = auditColumns.has('resolved_enterprise_id');
    const hasDiagnosticsJson = auditColumns.has('diagnostics_json');
    const hasAuditCostColumns = ['cost_usd', 'total_cost_usd', 'prompt_tokens', 'completion_tokens', 'total_tokens'].filter((c) =>
      auditColumns.has(c)
    );

    const realCostSql = auditColumns.has('cost_usd')
      ? 'SUM(COALESCE(a.cost_usd, 0))'
      : auditColumns.has('total_cost_usd')
        ? 'SUM(COALESCE(a.total_cost_usd, 0))'
        : '0';
    const tokenSql = auditColumns.has('total_tokens')
      ? 'SUM(COALESCE(a.total_tokens, 0))'
      : auditColumns.has('prompt_tokens') || auditColumns.has('completion_tokens')
        ? `SUM(COALESCE(${auditColumns.has('prompt_tokens') ? 'a.prompt_tokens' : '0'}, 0) + COALESCE(${auditColumns.has('completion_tokens') ? 'a.completion_tokens' : '0'}, 0))`
        : '0';

    const auditEnterpriseExpr = hasResolvedEnterprise
      ? 'COALESCE(a.resolved_enterprise_id, a.enterprise_id, c.enterprise_id)'
      : 'COALESCE(a.enterprise_id, c.enterprise_id)';
    const auditContactExpr = hasContactId
      ? 'COALESCE(a.contact_id::text, c.contact_id::text, c.external_contact_id, c.id::text)'
      : 'COALESCE(c.contact_id::text, c.external_contact_id, c.id::text)';
    const auditDiagnosticsExpr = hasDiagnosticsJson ? 'a.diagnostics_json' : "'{}'::jsonb";
    const deletedFilter = messageColumns.has('deleted_at') ? 'AND m.deleted_at IS NULL' : '';
    const contactEnterpriseExpr = contactColumns.has('enterprise_id') ? 'ct.enterprise_id' : 'NULL::int';

    const { rows: conversationRowsRaw } = await client.query(
      `WITH msg AS (
         SELECT
           c.id AS conversation_id,
           COUNT(*) FILTER (WHERE m.role = 'user')::int AS client_messages,
           COUNT(*) FILTER (WHERE m.role = 'assistant')::int AS ana_messages,
           COUNT(*)::int AS total_messages,
           MIN(m.created_at) AS first_message_at,
           MAX(m.created_at) AS last_message_at
         FROM conversations c
         JOIN messages m ON m.conversation_id = c.id
         WHERE m.created_at >= $1::timestamptz
           AND m.created_at < $2::timestamptz
           ${deletedFilter}
         GROUP BY c.id
       ),
       aud AS (
         ${
           hasAudit
             ? `SELECT
                  a.conversation_id,
                  COUNT(*)::int AS audit_turns,
                  COUNT(*) FILTER (
                    WHERE lower(COALESCE(a.outbound_status, '')) IN ('send_failed', 'material_failed')
                       OR lower(COALESCE(a.blocked_reason, '')) LIKE '%fallback%'
                       OR lower(COALESCE(a.blocked_reason, '')) LIKE '%retry%'
                       OR lower(COALESCE(${auditDiagnosticsExpr}::text, '')) LIKE '%fallback%'
                       OR lower(COALESCE(${auditDiagnosticsExpr}::text, '')) LIKE '%retry%'
                  )::int AS retry_fallback_signals,
                  COUNT(*) FILTER (
                    WHERE lower(COALESCE(${auditDiagnosticsExpr}::text, '')) LIKE '%retry%'
                  )::int AS retry_count,
                  COUNT(*) FILTER (
                    WHERE lower(COALESCE(${auditDiagnosticsExpr}::text, '')) LIKE '%fallback%'
                       OR lower(COALESCE(a.blocked_reason, '')) LIKE '%fallback%'
                  )::int AS fallback_count,
                  ${realCostSql}::float AS real_cost_usd,
                  ${tokenSql}::float AS total_tokens
                FROM ana_turn_audit a
                WHERE a.created_at >= $1::timestamptz
                  AND a.created_at < $2::timestamptz
                GROUP BY a.conversation_id`
             : `SELECT NULL::int AS conversation_id, 0::int AS audit_turns, 0::int AS retry_fallback_signals,
                  0::int AS retry_count, 0::int AS fallback_count, 0::float AS real_cost_usd, 0::float AS total_tokens
                WHERE false`
         }
       )
       SELECT
         c.id AS conversation_id,
         c.contact_id,
         COALESCE(c.contact_id::text, c.external_contact_id, c.id::text) AS contact_key,
         c.external_contact_id,
         c.contact_phone,
         c.customer_name,
         ct.full_name,
         ct.phone_e164,
         COALESCE(c.enterprise_id, ${contactEnterpriseExpr}) AS enterprise_id,
         COALESCE(e.name, '(sem empreendimento)') AS enterprise_name,
         c.created_at AS conversation_created_at,
         msg.first_message_at,
         msg.last_message_at,
         COALESCE(msg.client_messages, 0) AS client_messages,
         COALESCE(msg.ana_messages, 0) AS ana_messages,
         COALESCE(msg.total_messages, 0) AS total_messages,
         COALESCE(aud.audit_turns, 0) AS audit_turns,
         COALESCE(aud.retry_fallback_signals, 0) AS retry_fallback_signals,
         COALESCE(aud.retry_count, 0) AS retry_count,
         COALESCE(aud.fallback_count, 0) AS fallback_count,
         COALESCE(aud.real_cost_usd, 0)::float AS real_cost_usd,
         COALESCE(aud.total_tokens, 0)::float AS total_tokens
       FROM msg
       JOIN conversations c ON c.id = msg.conversation_id
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN enterprises e ON e.id = COALESCE(c.enterprise_id, ${contactEnterpriseExpr})
       LEFT JOIN aud ON aud.conversation_id = c.id
       ORDER BY msg.last_message_at DESC`,
      [start, end]
    );

    const hasRealCost = conversationRowsRaw.some((row) => Number(row.real_cost_usd || 0) > 0);
    const conversationRows = applyCostAllocation(conversationRowsRaw, totalCostUsd, hasRealCost);

    const contactMap = new Map();
    for (const row of conversationRows) {
      const key = row.contact_key;
      const current =
        contactMap.get(key) || {
          contact_key: key,
          label: leadLabel(row),
          contact_phone: row.contact_phone || row.phone_e164 || null,
          enterprise_id: row.enterprise_id,
          enterprise_name: row.enterprise_name,
          conversations: 0,
          client_messages: 0,
          ana_messages: 0,
          total_messages: 0,
          audit_turns: 0,
          retry_count: 0,
          fallback_count: 0,
          retry_fallback_signals: 0,
          effort_units: 0,
          estimated_cost_usd: 0,
          total_tokens: 0,
        };
      current.conversations += 1;
      current.client_messages += Number(row.client_messages || 0);
      current.ana_messages += Number(row.ana_messages || 0);
      current.total_messages += Number(row.total_messages || 0);
      current.audit_turns += Number(row.audit_turns || 0);
      current.retry_count += Number(row.retry_count || 0);
      current.fallback_count += Number(row.fallback_count || 0);
      current.retry_fallback_signals += Number(row.retry_fallback_signals || 0);
      current.effort_units += Number(row.effort_units || 0);
      current.estimated_cost_usd += Number(row.estimated_cost_usd || 0);
      current.total_tokens += Number(row.total_tokens || 0);
      contactMap.set(key, current);
    }
    const contactRows = [...contactMap.values()].sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd);

    const enterpriseMap = new Map();
    for (const row of conversationRows) {
      const key = row.enterprise_id == null ? 'null' : String(row.enterprise_id);
      const current =
        enterpriseMap.get(key) || {
          enterprise_id: row.enterprise_id,
          enterprise_name: row.enterprise_name || '(sem empreendimento)',
          contacts: new Set(),
          conversations: 0,
          client_messages: 0,
          ana_messages: 0,
          total_messages: 0,
          audit_turns: 0,
          retry_count: 0,
          fallback_count: 0,
          estimated_cost_usd: 0,
          effort_units: 0,
        };
      current.contacts.add(row.contact_key);
      current.conversations += 1;
      current.client_messages += Number(row.client_messages || 0);
      current.ana_messages += Number(row.ana_messages || 0);
      current.total_messages += Number(row.total_messages || 0);
      current.audit_turns += Number(row.audit_turns || 0);
      current.retry_count += Number(row.retry_count || 0);
      current.fallback_count += Number(row.fallback_count || 0);
      current.estimated_cost_usd += Number(row.estimated_cost_usd || 0);
      current.effort_units += Number(row.effort_units || 0);
      enterpriseMap.set(key, current);
    }
    const enterpriseRows = [...enterpriseMap.values()]
      .map((row) => ({ ...row, contacts_count: row.contacts.size }))
      .sort((a, b) => b.estimated_cost_usd - a.estimated_cost_usd);

    const { rows: dailyRows } = await client.query(
      `WITH msg AS (
         SELECT
           to_char(m.created_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:00') AS bucket,
           COUNT(DISTINCT COALESCE(c.contact_id::text, c.external_contact_id, c.id::text))::int AS contacts,
           COUNT(DISTINCT c.id)::int AS conversations,
           COUNT(*) FILTER (WHERE m.role = 'user')::int AS client_messages,
           COUNT(*) FILTER (WHERE m.role = 'assistant')::int AS ana_messages,
           COUNT(*)::int AS total_messages
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.created_at >= $1::timestamptz
           AND m.created_at < $2::timestamptz
           ${deletedFilter}
         GROUP BY bucket
       ),
       aud AS (
         ${
           hasAudit
             ? `SELECT
                  to_char(a.created_at AT TIME ZONE '${TZ}', 'YYYY-MM-DD HH24:00') AS bucket,
                  COUNT(*)::int AS audit_turns
                FROM ana_turn_audit a
                WHERE a.created_at >= $1::timestamptz
                  AND a.created_at < $2::timestamptz
                GROUP BY bucket`
             : `SELECT NULL::text AS bucket, 0::int AS audit_turns WHERE false`
         }
       )
       SELECT
         msg.bucket,
         msg.contacts,
         msg.conversations,
         msg.client_messages,
         msg.ana_messages,
         msg.total_messages,
         COALESCE(aud.audit_turns, 0) AS audit_turns
       FROM msg
       LEFT JOIN aud ON aud.bucket = msg.bucket
       ORDER BY msg.bucket`,
      [start, end]
    );

    const { rows: auditEnterpriseRows } = hasAudit
      ? await client.query(
          `SELECT
             ${auditEnterpriseExpr} AS enterprise_id,
             COALESCE(e.name, MAX(NULLIF(a.resolved_enterprise_name, '')), '(sem empreendimento)') AS enterprise_name,
             COUNT(*)::int AS audit_turns,
             COUNT(DISTINCT ${auditContactExpr})::int AS contacts_processed,
             COUNT(*) FILTER (
               WHERE lower(COALESCE(${auditDiagnosticsExpr}::text, '')) LIKE '%fallback%'
                  OR lower(COALESCE(${auditDiagnosticsExpr}::text, '')) LIKE '%retry%'
                  OR lower(COALESCE(a.blocked_reason, '')) LIKE '%fallback%'
                  OR lower(COALESCE(a.blocked_reason, '')) LIKE '%retry%'
             )::int AS retry_fallback_signals
           FROM ana_turn_audit a
           JOIN conversations c ON c.id = a.conversation_id
           LEFT JOIN enterprises e ON e.id = ${auditEnterpriseExpr}
           WHERE a.created_at >= $1::timestamptz
             AND a.created_at < $2::timestamptz
           GROUP BY ${auditEnterpriseExpr}, e.name
           ORDER BY audit_turns DESC`,
          [start, end]
        )
      : { rows: [] };

    const totalContacts = contactRows.length;
    const totalConversations = conversationRows.length;
    const totalClientMessages = conversationRows.reduce((sum, row) => sum + Number(row.client_messages || 0), 0);
    const totalAnaMessages = conversationRows.reduce((sum, row) => sum + Number(row.ana_messages || 0), 0);
    const totalMessages = conversationRows.reduce((sum, row) => sum + Number(row.total_messages || 0), 0);
    const totalAudits = conversationRows.reduce((sum, row) => sum + Number(row.audit_turns || 0), 0);
    const totalRetries = conversationRows.reduce((sum, row) => sum + Number(row.retry_count || 0), 0);
    const totalFallbacks = conversationRows.reduce((sum, row) => sum + Number(row.fallback_count || 0), 0);
    const totalEffort = conversationRows.reduce((sum, row) => sum + Number(row.effort_units || 0), 0);

    console.log('\nANA / OpenAI Cost Report');
    console.log(`Periodo: ${start.toISOString()} ate ${end.toISOString()} (${TZ})`);
    console.log(`Custo total informado: ${money(totalCostUsd)}`);
    console.log(`DATABASE_URL: [redacted]`);

    printSection('A) Resumo executivo');
    console.log(`custo_total_usd: ${money(totalCostUsd)}`);
    console.log(`contatos_unicos: ${num(totalContacts)}`);
    console.log(`conversas_unicas: ${num(totalConversations)}`);
    console.log(`mensagens_recebidas: ${num(totalClientMessages)}`);
    console.log(`mensagens_enviadas_ana: ${num(totalAnaMessages)}`);
    console.log(`turnos_auditados_ana: ${num(totalAudits)}`);
    console.log(`retries_detectados: ${num(totalRetries)}`);
    console.log(`fallbacks_detectados: ${num(totalFallbacks)}`);
    console.log(`custo_medio_por_contato: ${money(totalContacts ? totalCostUsd / totalContacts : 0)}`);
    console.log(`custo_medio_por_conversa: ${money(totalConversations ? totalCostUsd / totalConversations : 0)}`);
    console.log(`custo_medio_por_mensagem_ana: ${money(totalAnaMessages ? totalCostUsd / totalAnaMessages : 0)}`);
    console.log(`modo_rateio: ${hasRealCost ? 'custo real encontrado em colunas de auditoria' : 'estimado por unidades de esforco'}`);

    printSection('B) Cobertura de dados e auditoria');
    console.log(`ana_turn_audit: ${hasAudit ? 'sim' : 'nao'}`);
    console.log(`ana_diagnostics: ${hasAnaDiagnostics ? 'sim' : 'nao'}`);
    console.log(`colunas de custo/token encontradas: ${hasAuditCostColumns.length ? hasAuditCostColumns.join(', ') : 'nenhuma'}`);
    console.log(
      hasRealCost
        ? 'O custo por contato usa custo real registrado.'
        : 'Nao ha tokens/custo por chamada detectados no banco; custo por contato foi estimado por rateio.'
    );
    console.log(`formula de esforco: ana_messages*3 + audit_turns*5 + retries*4 + fallbacks*6 + total_messages`);
    console.log(`unidades_de_esforco_total: ${num(totalEffort)}`);

    printSection('C) Relatorio por contato/conversa - top 20 contatos por custo estimado');
    printTable(contactRows, [
      { label: 'contato', value: (r) => r.label },
      { label: 'empreendimento', value: (r) => r.enterprise_name },
      { label: 'conv', value: (r) => num(r.conversations), align: 'right' },
      { label: 'msg_cli', value: (r) => num(r.client_messages), align: 'right' },
      { label: 'msg_ana', value: (r) => num(r.ana_messages), align: 'right' },
      { label: 'audit', value: (r) => num(r.audit_turns), align: 'right' },
      { label: 'retry', value: (r) => num(r.retry_count), align: 'right' },
      { label: 'fallback', value: (r) => num(r.fallback_count), align: 'right' },
      { label: 'custo_est', value: (r) => money(r.estimated_cost_usd), align: 'right' },
    ]);

    printSection('D) Relatorio por empreendimento');
    printTable(enterpriseRows, [
      { label: 'empreendimento', value: (r) => r.enterprise_name },
      { label: 'contatos', value: (r) => num(r.contacts_count), align: 'right' },
      { label: 'conv', value: (r) => num(r.conversations), align: 'right' },
      { label: 'msg_cli', value: (r) => num(r.client_messages), align: 'right' },
      { label: 'msg_ana', value: (r) => num(r.ana_messages), align: 'right' },
      { label: 'audit', value: (r) => num(r.audit_turns), align: 'right' },
      { label: 'custo_est', value: (r) => money(r.estimated_cost_usd), align: 'right' },
      { label: '% custo', value: (r) => pct(totalCostUsd ? r.estimated_cost_usd / totalCostUsd : 0), align: 'right' },
    ]);

    printSection('E) Relatorio por dia/hora');
    printTable(dailyRows, [
      { label: 'hora', value: (r) => r.bucket },
      { label: 'contatos', value: (r) => num(r.contacts), align: 'right' },
      { label: 'conv', value: (r) => num(r.conversations), align: 'right' },
      { label: 'msg_cli', value: (r) => num(r.client_messages), align: 'right' },
      { label: 'msg_ana', value: (r) => num(r.ana_messages), align: 'right' },
      { label: 'audit', value: (r) => num(r.audit_turns), align: 'right' },
    ], 200);

    printSection('F) Ranking de contatos mais caros estimados');
    printTable(contactRows, [
      { label: 'contato', value: (r) => r.label },
      { label: 'custo_est', value: (r) => money(r.estimated_cost_usd), align: 'right' },
      { label: 'esforco', value: (r) => num(r.effort_units), align: 'right' },
      { label: 'msg_total', value: (r) => num(r.total_messages), align: 'right' },
      { label: 'audit', value: (r) => num(r.audit_turns), align: 'right' },
    ]);

    printSection('G) Ranking de conversas com mais mensagens');
    printTable([...conversationRows].sort((a, b) => b.total_messages - a.total_messages), [
      { label: 'conversation_id', value: (r) => r.conversation_id, align: 'right' },
      { label: 'contato', value: (r) => leadLabel(r) },
      { label: 'empreendimento', value: (r) => r.enterprise_name },
      { label: 'msg_total', value: (r) => num(r.total_messages), align: 'right' },
      { label: 'msg_cli', value: (r) => num(r.client_messages), align: 'right' },
      { label: 'msg_ana', value: (r) => num(r.ana_messages), align: 'right' },
      { label: 'custo_est', value: (r) => money(r.estimated_cost_usd), align: 'right' },
    ]);

    printSection('H) Ranking de conversas com mais sinais de retry/fallback');
    const retryRows = [...conversationRows].sort(
      (a, b) => b.retry_fallback_signals - a.retry_fallback_signals || b.audit_turns - a.audit_turns
    );
    printTable(retryRows.filter((r) => r.retry_fallback_signals > 0 || r.audit_turns > 0), [
      { label: 'conversation_id', value: (r) => r.conversation_id, align: 'right' },
      { label: 'contato', value: (r) => leadLabel(r) },
      { label: 'retry/fallback', value: (r) => num(r.retry_fallback_signals), align: 'right' },
      { label: 'retry', value: (r) => num(r.retry_count), align: 'right' },
      { label: 'fallback', value: (r) => num(r.fallback_count), align: 'right' },
      { label: 'audit', value: (r) => num(r.audit_turns), align: 'right' },
      { label: 'custo_est', value: (r) => money(r.estimated_cost_usd), align: 'right' },
    ]);

    if (auditEnterpriseRows.length > 0) {
      printSection('Auditoria por empreendimento resolvido');
      printTable(auditEnterpriseRows, [
        { label: 'empreendimento', value: (r) => r.enterprise_name },
        { label: 'contatos_proc', value: (r) => num(r.contacts_processed), align: 'right' },
        { label: 'audit', value: (r) => num(r.audit_turns), align: 'right' },
        { label: 'retry/fallback', value: (r) => num(r.retry_fallback_signals), align: 'right' },
      ]);
    }

    printSection('I) Sinais de desperdicio de custo');
    const highAnaRatio = conversationRows.filter((r) => Number(r.client_messages) > 0 && Number(r.ana_messages) / Number(r.client_messages) >= 2);
    const manyAudits = conversationRows.filter((r) => Number(r.audit_turns) >= 5);
    const noEnterpriseCost = enterpriseRows.find((r) => r.enterprise_id == null)?.estimated_cost_usd || 0;
    console.log(`conversas com respostas_ana / mensagens_cliente >= 2: ${num(highAnaRatio.length)}`);
    console.log(`conversas com 5+ turnos auditados: ${num(manyAudits.length)}`);
    console.log(`custo estimado sem empreendimento: ${money(noEnterpriseCost)} (${pct(totalCostUsd ? noEnterpriseCost / totalCostUsd : 0)})`);
    console.log(`retries/fallbacks detectados: ${num(totalRetries + totalFallbacks)}`);
    if (!hasAudit) console.log('Sem ana_turn_audit: nao da para diferenciar chamada IA, retry e fallback por contato.');
    if (!hasRealCost) console.log('Sem tokens/custo por chamada: desperdicio e custo por contato sao inferencias por esforco.');

    printSection('J) Acoes futuras para reduzir custo (nao aplicadas)');
    const recommendations = [];
    if (highAnaRatio.length > 0) recommendations.push('Revisar conversas em que a Ana respondeu muitas vezes por mensagem do cliente.');
    if (manyAudits.length > 0) recommendations.push('Investigar contatos com muitos turnos auditados para entender loops ou perguntas repetidas.');
    if (totalRetries + totalFallbacks > 0) recommendations.push('Separar causas de retry/fallback por provider, parse JSON e contexto ausente.');
    if (noEnterpriseCost > totalCostUsd * 0.15) recommendations.push('Melhorar resolucao de empreendimento antes de chamar IA completa.');
    recommendations.push('Adicionar captura de usage/tokens/custo por chamada em auditoria futura para sair do rateio estimado.');
    recommendations.push('Criar cache/atalhos determinísticos para respostas recorrentes, sem alterar comportamento nesta etapa.');
    recommendations.forEach((item, i) => console.log(`${i + 1}. ${item}`));

    printSection('Queries usadas');
    console.log('1. information_schema.tables/columns para detectar tabelas e colunas reais.');
    console.log('2. messages + conversations + contacts + enterprises por conversa no periodo.');
    console.log('3. ana_turn_audit agregado por conversa, empreendimento resolvido e hora quando existente.');
    console.log('4. messages agregado por bucket YYYY-MM-DD HH:00 em America/Sao_Paulo.');
    console.log('5. Nenhuma query de escrita foi executada.');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('\nErro ao gerar relatorio de custo da Ana.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
