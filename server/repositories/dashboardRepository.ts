import { query } from '../db/pg.js';

/**
 * Dashboard: única fonte de verdade para classificação = coluna `classification`.
 * A flag `handoff` não entra em nenhuma métrica aqui (compatível com o restante do produto).
 */
export type DashboardPeriod = 'today' | '7d' | '30d';

/** Filtro da lista "Itens que exigem atenção" e do CSV do dashboard (query string `attentionType`). */
export type DashboardAttentionType = 'all' | 'no_first_response' | 'novo_sem_projeto' | 'inactive_12_24h';

export function parseDashboardAttentionType(raw: string | undefined | null): DashboardAttentionType {
  const t = String(raw ?? '').trim();
  if (t === 'no_first_response' || t === 'novo_sem_projeto' || t === 'inactive_12_24h') return t;
  return 'all';
}

function periodDaysBack(period: DashboardPeriod): number {
  if (period === 'today') return 0;
  if (period === '30d') return 29;
  return 6;
}

const TZ = 'America/Sao_Paulo';

/**
 * Rótulo visual igual ao `leadName` da Inbox e aos attention items do dashboard:
 * whatsapp_display_name → customer_name → contact_phone → external_contact_id → 'Sem nome'.
 * Não altera dados; só leitura para UI/CSV do dashboard.
 */
const LEAD_DISPLAY_LABEL_SQL = `COALESCE(
  NULLIF(TRIM(c.whatsapp_display_name), ''),
  NULLIF(TRIM(c.customer_name), ''),
  NULLIF(TRIM(c.contact_phone), ''),
  NULLIF(TRIM(c.external_contact_id), ''),
  'Sem nome'
)`;

export interface DashboardOverview {
  period: DashboardPeriod;
  periodStart: string;
  enterpriseId: number | null;
  kpis: {
    newConversationsToday: number;
    activeConversations: number;
    qualified: number;
    handoffs: number;
    carteira: number;
    avgFirstResponseSeconds: number | null;
    noFirstResponse: number;
  };
  /** Novas conversas por dia (created_at), fuso America/São Paulo — sem série paralela de mensagens. */
  timeline: { date: string; newConversations: number }[];
  classification: { label: string; count: number }[];
  enterprises: {
    enterpriseId: number | null;
    name: string;
    total: number;
    qualified: number;
    handoffs: number;
    carteiras: number;
    llmCostUsd: number | null;
    llmOfficialCostUsd?: number | null;
    llmLocalEstimatedCostUsd?: number | null;
    llmCostSource?: 'official_openai' | 'local_estimated';
    llmTrackedCostUsd: number | null;
    llmEstimatedCostUsd: number | null;
    llmCalls: number;
    llmInputTokens: number;
    llmOutputTokens: number;
    llmTotalTokens: number;
    llmCostPerContact: number | null;
    llmCostPerConversation: number | null;
  }[];
}

export type DashboardAttentionItem = {
  id: number;
  customerName: string | null;
  contactPhone: string | null;
  reason: string;
  enterpriseName: string | null;
};

export interface DashboardAttentionItemsResponse {
  attentionItems: DashboardAttentionItem[];
  attentionType: DashboardAttentionType;
}

function entClause(paramIndex: number): string {
  return ` AND ($${paramIndex}::int IS NULL OR c.enterprise_id = $${paramIndex}::int)`;
}

function parseNullableNumber(value: string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface DashboardCsvRow {
  conversation_id: number;
  /** No export CSV: rótulo visual (mesma ordem da Inbox), não a coluna bruta `customer_name`. */
  customer_name: string | null;
  contact_phone: string | null;
  enterprise_name: string | null;
  classification: string;
  lead_temperature: string | null;
  assigned_broker_id: number | null;
  created_at: Date;
  last_message_at: Date | null;
  no_first_response: boolean;
  is_novo_sem_projeto: boolean;
  /** Alinhado à faixa 12h–24h da lista de atenção do dashboard. */
  is_inactive_12_24h: boolean;
  attention_reason: string;
}

/** Conversas com `created_at` no período (America/São Paulo), mesmo critério do gráfico do overview. */
/** Export global do dashboard: recorte por período + empreendimento (sem filtro de atuação). */
export async function getDashboardCsvRows(
  period: DashboardPeriod,
  enterpriseId: number | null
): Promise<DashboardCsvRow[]> {
  const eid = enterpriseId != null && !Number.isNaN(enterpriseId) ? enterpriseId : null;
  const daysBack = periodDaysBack(period);
  const ent = entClause(2);
  const { rows } = await query<DashboardCsvRow>(
    `SELECT
       c.id AS conversation_id,
       ${LEAD_DISPLAY_LABEL_SQL} AS customer_name,
       c.contact_phone,
       COALESCE(e.name, '') AS enterprise_name,
       c.classification,
       c.lead_temperature,
       c.assigned_broker_id,
       c.created_at,
       c.last_message_at,
       (EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user')
         AND NOT EXISTS (SELECT 1 FROM messages m2 WHERE m2.conversation_id = c.id AND m2.role = 'assistant')
       ) AS no_first_response,
       (c.classification = 'Novo' AND c.enterprise_id IS NULL) AS is_novo_sem_projeto,
       (c.classification IN ('Novo', 'Qualificado')
         AND COALESCE(c.last_message_at, c.created_at) <= NOW() - INTERVAL '12 hours'
         AND COALESCE(c.last_message_at, c.created_at) > NOW() - INTERVAL '24 hours'
       ) AS is_inactive_12_24h,
       CASE
         WHEN EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user')
              AND NOT EXISTS (SELECT 1 FROM messages m2 WHERE m2.conversation_id = c.id AND m2.role = 'assistant')
           THEN 'Sem primeira resposta'
         WHEN c.classification = 'Novo' AND c.enterprise_id IS NULL THEN 'Novo sem projeto'
         WHEN c.classification IN ('Novo', 'Qualificado')
              AND COALESCE(c.last_message_at, c.created_at) <= NOW() - INTERVAL '12 hours'
              AND COALESCE(c.last_message_at, c.created_at) > NOW() - INTERVAL '24 hours'
           THEN 'Sem atividade entre 12h e 24h'
         ELSE ''
       END AS attention_reason
     FROM conversations c
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     WHERE (c.created_at AT TIME ZONE '${TZ}')::date >= (CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::date - $1::int
       AND (c.created_at AT TIME ZONE '${TZ}')::date <= (CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::date
       ${ent}
     ORDER BY c.created_at DESC`,
    [daysBack, eid]
  );
  return rows;
}

function mapAttnRowToItem(
  row: { id: number; contact_phone: string | null; enterprise_name: string | null; attention_lead_label: string },
  reason: string
): DashboardAttentionItem {
  return {
    id: row.id,
    customerName: row.attention_lead_label,
    contactPhone: row.contact_phone,
    reason,
    enterpriseName: row.enterprise_name,
  };
}

/** Lista da seção "Itens que exigem atenção" (filtro local por `attentionType`; usa só empreendimento). */
export async function getDashboardAttentionItems(
  enterpriseId: number | null,
  attentionType: DashboardAttentionType
): Promise<DashboardAttentionItemsResponse> {
  const eid = enterpriseId != null && !Number.isNaN(enterpriseId) ? enterpriseId : null;
  const ent = entClause(1);
  const paramsE: unknown[] = [eid];

  type AttnRow = {
    id: number;
    contact_phone: string | null;
    enterprise_name: string | null;
    attention_lead_label: string;
  };

  const needNoFirst = attentionType === 'all' || attentionType === 'no_first_response';
  const needNovo = attentionType === 'all' || attentionType === 'novo_sem_projeto';
  const needInactive = attentionType === 'all' || attentionType === 'inactive_12_24h';

  let attnNoFirst: AttnRow[] = [];
  let attnNovoSemProjetoRows: AttnRow[] = [];
  let attnStalled12to24h: AttnRow[] = [];

  if (needNoFirst) {
    const { rows } = await query<AttnRow>(
      `SELECT c.id, c.contact_phone, e.name AS enterprise_name,
        ${LEAD_DISPLAY_LABEL_SQL} AS attention_lead_label
       FROM conversations c
       LEFT JOIN enterprises e ON e.id = c.enterprise_id
       WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user')
         AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'assistant')
       ${ent}
       ORDER BY c.created_at DESC NULLS LAST LIMIT 12`,
      paramsE
    );
    attnNoFirst = rows;
  }

  if (needNovo) {
    const { rows } = await query<AttnRow>(
      `SELECT c.id, c.contact_phone, e.name AS enterprise_name,
        ${LEAD_DISPLAY_LABEL_SQL} AS attention_lead_label
       FROM conversations c
       LEFT JOIN enterprises e ON e.id = c.enterprise_id
       WHERE c.classification = 'Novo' AND c.enterprise_id IS NULL
       ${ent}
       ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC LIMIT 12`,
      paramsE
    );
    attnNovoSemProjetoRows = rows;
  }

  if (needInactive) {
    const { rows } = await query<AttnRow>(
      `SELECT c.id, c.contact_phone, e.name AS enterprise_name,
        ${LEAD_DISPLAY_LABEL_SQL} AS attention_lead_label
       FROM conversations c
       LEFT JOIN enterprises e ON e.id = c.enterprise_id
       WHERE c.classification IN ('Novo', 'Qualificado')
         AND COALESCE(c.last_message_at, c.created_at) <= NOW() - INTERVAL '12 hours'
         AND COALESCE(c.last_message_at, c.created_at) > NOW() - INTERVAL '24 hours'
       ${ent}
       ORDER BY COALESCE(c.last_message_at, c.created_at) ASC LIMIT 12`,
      paramsE
    );
    attnStalled12to24h = rows;
  }

  let attentionItems: DashboardAttentionItem[];
  if (attentionType === 'all') {
    const attentionById = new Map<number, DashboardAttentionItem>();
    const pushAttn = (row: AttnRow, reason: string) => {
      if (attentionById.has(row.id)) return;
      attentionById.set(row.id, mapAttnRowToItem(row, reason));
    };
    for (const r of attnNoFirst) pushAttn(r, 'Sem primeira resposta');
    for (const r of attnNovoSemProjetoRows) pushAttn(r, 'Novo sem projeto');
    for (const r of attnStalled12to24h) pushAttn(r, 'Sem atividade entre 12h e 24h');
    attentionItems = [...attentionById.values()];
  } else if (attentionType === 'no_first_response') {
    attentionItems = attnNoFirst.map((r) => mapAttnRowToItem(r, 'Sem primeira resposta'));
  } else if (attentionType === 'novo_sem_projeto') {
    attentionItems = attnNovoSemProjetoRows.map((r) => mapAttnRowToItem(r, 'Novo sem projeto'));
  } else {
    attentionItems = attnStalled12to24h.map((r) => mapAttnRowToItem(r, 'Sem atividade entre 12h e 24h'));
  }

  return { attentionItems, attentionType };
}

export async function getDashboardOverview(period: DashboardPeriod, enterpriseId: number | null): Promise<DashboardOverview> {
  const eid = enterpriseId != null && !Number.isNaN(enterpriseId) ? enterpriseId : null;
  const daysBack = periodDaysBack(period);
  const ent = entClause(1);
  const paramsE: unknown[] = [eid];

  const { rows: newTodayRows } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM conversations c
     WHERE (c.created_at AT TIME ZONE '${TZ}')::date = (CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::date
     ${ent}`,
    paramsE
  );

  const { rows: activeRows } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM conversations c
     WHERE c.classification IN ('Novo', 'Qualificado')
     ${ent}`,
    paramsE
  );

  const { rows: qualRows } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM conversations c
     WHERE c.classification = 'Qualificado'
     ${ent}`,
    paramsE
  );

  const { rows: handRows } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM conversations c
     WHERE c.classification = 'Handoff'
     ${ent}`,
    paramsE
  );

  const { rows: carteiraRows } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM conversations c
     WHERE c.classification = 'Carteira'
     ${ent}`,
    paramsE
  );

  const { rows: noFirstRows } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM conversations c
     WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user')
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'assistant')
     ${ent}`,
    paramsE
  );

  let avgFirst: number | null = null;
  try {
    const { rows: avgRows } = await query<{ secs: string | null }>(
      `SELECT AVG(EXTRACT(EPOCH FROM (fo.t_first - c.created_at)))::text AS secs
       FROM conversations c
       INNER JOIN (
         SELECT conversation_id, MIN(created_at) AS t_first
         FROM messages WHERE role = 'assistant'
         GROUP BY conversation_id
       ) fo ON fo.conversation_id = c.id
       WHERE 1=1 ${ent}`,
      paramsE
    );
    const v = avgRows[0]?.secs;
    if (v != null && v !== '') {
      const n = Number(v);
      if (!Number.isNaN(n) && Number.isFinite(n)) avgFirst = Math.round(n);
    }
  } catch {
    avgFirst = null;
  }

  const { rows: tlRows } = await query<{ d: string; new_conversations: string }>(
    `
    SELECT to_char(gs.d, 'YYYY-MM-DD') AS d,
      (SELECT COUNT(*)::text FROM conversations c
        WHERE (c.created_at AT TIME ZONE '${TZ}')::date = gs.d
        AND ($2::int IS NULL OR c.enterprise_id = $2)) AS new_conversations
    FROM generate_series(
      ((CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::date - $1::int),
      (CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::date,
      interval '1 day'
    ) AS gs(d)
    ORDER BY gs.d
    `,
    [daysBack, eid]
  );

  const { rows: novoC } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM conversations c WHERE c.classification = 'Novo' ${ent}`,
    paramsE
  );
  const { rows: qualC } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM conversations c WHERE c.classification = 'Qualificado' ${ent}`,
    paramsE
  );
  const { rows: resC } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM conversations c WHERE c.classification = 'Carteira' ${ent}`,
    paramsE
  );
  const { rows: handC } = await query<{ n: string }>(
    `SELECT COUNT(*)::text AS n FROM conversations c WHERE c.classification = 'Handoff' ${ent}`,
    paramsE
  );

  const { rows: entRows } = await query<{
    enterprise_id: number | null;
    name: string | null;
    total: string;
    qualified: string;
    handoffs: string;
    carteiras: string;
    llm_cost_usd: string | null;
    llm_official_cost_usd: string | null;
    llm_local_estimated_cost_usd: string | null;
    llm_cost_source: 'official_openai' | 'local_estimated';
    llm_tracked_cost_usd: string | null;
    llm_estimated_cost_usd: string | null;
    llm_calls: string | null;
    llm_input_tokens: string | null;
    llm_output_tokens: string | null;
    llm_total_tokens: string | null;
    llm_cost_per_contact: string | null;
    llm_cost_per_conversation: string | null;
  }>(
    `WITH period_bounds AS (
      SELECT
        (((CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::date - $2::int)::timestamp AT TIME ZONE '${TZ}') AS period_start,
        (((CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::date + 1)::timestamp AT TIME ZONE '${TZ}') AS period_end
    ),
    conv_groups AS (
      SELECT COALESCE(c.enterprise_id::text, '__NO_ENTERPRISE__') AS group_key,
        c.enterprise_id,
        e.name,
        COUNT(*)::bigint AS total,
        SUM(CASE WHEN c.classification = 'Qualificado' THEN 1 ELSE 0 END)::bigint AS qualified,
        SUM(CASE WHEN c.classification = 'Handoff' THEN 1 ELSE 0 END)::bigint AS handoffs,
        SUM(CASE WHEN c.classification = 'Carteira' THEN 1 ELSE 0 END)::bigint AS carteiras,
        0::bigint AS llm_calls,
        0::bigint AS llm_input_tokens,
        0::bigint AS llm_output_tokens,
        0::bigint AS llm_total_tokens,
        0::numeric(12,6) AS llm_tracked_cost_usd,
        0::numeric(12,6) AS llm_estimated_cost_usd,
        0::numeric(12,6) AS llm_official_cost_usd,
        0::numeric(12,6) AS llm_official_rows,
        0::bigint AS llm_contacts,
        0::bigint AS llm_conversations
      FROM conversations c
      LEFT JOIN enterprises e ON e.id = c.enterprise_id
      WHERE 1=1 ${ent}
      GROUP BY c.enterprise_id, e.name
    ),
    usage_groups AS (
      /* Preparado para custo real por API key:
         quando enterprise_id nao vier no evento, tenta mapear por openai_api_key_id -> enterprise_ai_settings.enterprise_id. */
      SELECT COALESCE(COALESCE(ue.enterprise_id::int, eas.enterprise_id)::text, '__NO_ENTERPRISE__') AS group_key,
        COALESCE(ue.enterprise_id::int, eas.enterprise_id) AS enterprise_id,
        e.name,
        0::bigint AS total,
        0::bigint AS qualified,
        0::bigint AS handoffs,
        0::bigint AS carteiras,
        COUNT(*)::bigint AS llm_calls,
        SUM(ue.input_tokens)::bigint AS llm_input_tokens,
        SUM(ue.output_tokens)::bigint AS llm_output_tokens,
        SUM(ue.total_tokens)::bigint AS llm_total_tokens,
        SUM(ue.estimated_cost_usd)::numeric(12,6) AS llm_tracked_cost_usd,
        0::numeric(12,6) AS llm_estimated_cost_usd,
        0::numeric(12,6) AS llm_official_cost_usd,
        0::numeric(12,6) AS llm_official_rows,
        COUNT(DISTINCT ue.contact_id) FILTER (WHERE ue.contact_id IS NOT NULL)::bigint AS llm_contacts,
        COUNT(DISTINCT ue.conversation_id) FILTER (WHERE ue.conversation_id IS NOT NULL)::bigint AS llm_conversations
      FROM llm_usage_events ue
      LEFT JOIN enterprise_ai_settings eas
        ON ue.openai_api_key_id IS NOT NULL
        AND ue.openai_api_key_id <> ''
        AND eas.openai_api_key_id = ue.openai_api_key_id
      LEFT JOIN enterprises e ON e.id = COALESCE(ue.enterprise_id::int, eas.enterprise_id)
      WHERE (ue.created_at AT TIME ZONE '${TZ}')::date >= (CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::date - $2::int
        AND (ue.created_at AT TIME ZONE '${TZ}')::date <= (CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::date
        AND ($1::int IS NULL OR COALESCE(ue.enterprise_id::int, eas.enterprise_id) = $1::int)
      GROUP BY COALESCE(ue.enterprise_id::int, eas.enterprise_id), e.name
    ),
    eligible_backfills AS (
      SELECT b.id,
        b.total_cost_usd,
        GREATEST(b.start_at, pb.period_start) AS allocation_start_at,
        LEAST(b.end_at, pb.period_end) AS allocation_end_at,
        CASE
          WHEN EXTRACT(EPOCH FROM (b.end_at - b.start_at)) > 0
            THEN (
              b.total_cost_usd
              * EXTRACT(EPOCH FROM (LEAST(b.end_at, pb.period_end) - GREATEST(b.start_at, pb.period_start)))
              / EXTRACT(EPOCH FROM (b.end_at - b.start_at))
            )::numeric(12,6)
          ELSE 0::numeric(12,6)
        END AS period_cost_usd
      FROM llm_cost_backfills b
      CROSS JOIN period_bounds pb
      WHERE b.is_active = TRUE
        AND b.start_at < pb.period_end
        AND b.end_at > pb.period_start
    ),
    backfill_effort_sources AS (
      SELECT eb.id AS backfill_id,
        COALESCE(c.enterprise_id::text, '__NO_ENTERPRISE__') AS group_key,
        c.enterprise_id,
        (
          COUNT(*) FILTER (WHERE m.role = 'user')::numeric * 1.0
          + COUNT(*) FILTER (WHERE m.role = 'assistant')::numeric * 3.0
          + COUNT(*)::numeric * 0.25
        ) AS effort,
        COUNT(DISTINCT c.contact_id) FILTER (WHERE c.contact_id IS NOT NULL)::bigint AS llm_contacts,
        COUNT(DISTINCT c.id)::bigint AS llm_conversations
      FROM eligible_backfills eb
      JOIN messages m ON m.created_at >= eb.allocation_start_at
        AND m.created_at < eb.allocation_end_at
      JOIN conversations c ON c.id = m.conversation_id
      WHERE ($1::int IS NULL OR c.enterprise_id = $1::int)
      GROUP BY eb.id, c.enterprise_id
      UNION ALL
      SELECT eb.id AS backfill_id,
        COALESCE(COALESCE(a.resolved_enterprise_id, a.enterprise_id, c.enterprise_id)::text, '__NO_ENTERPRISE__') AS group_key,
        COALESCE(a.resolved_enterprise_id, a.enterprise_id, c.enterprise_id) AS enterprise_id,
        COUNT(*)::numeric * 2.0 AS effort,
        COUNT(DISTINCT COALESCE(a.contact_id, c.contact_id)) FILTER (WHERE COALESCE(a.contact_id, c.contact_id) IS NOT NULL)::bigint AS llm_contacts,
        COUNT(DISTINCT a.conversation_id)::bigint AS llm_conversations
      FROM eligible_backfills eb
      JOIN ana_turn_audit a ON a.created_at >= eb.allocation_start_at
        AND a.created_at < eb.allocation_end_at
      LEFT JOIN conversations c ON c.id = a.conversation_id
      WHERE ($1::int IS NULL OR COALESCE(a.resolved_enterprise_id, a.enterprise_id, c.enterprise_id) = $1::int)
      GROUP BY eb.id, COALESCE(a.resolved_enterprise_id, a.enterprise_id, c.enterprise_id)
    ),
    backfill_effort_groups AS (
      SELECT backfill_id,
        group_key,
        enterprise_id,
        SUM(effort)::numeric AS effort,
        SUM(llm_contacts)::bigint AS llm_contacts,
        SUM(llm_conversations)::bigint AS llm_conversations
      FROM backfill_effort_sources
      WHERE effort > 0
      GROUP BY backfill_id, group_key, enterprise_id
    ),
    backfill_allocations AS (
      SELECT beg.group_key,
        beg.enterprise_id,
        (eb.period_cost_usd * beg.effort / NULLIF(SUM(beg.effort) OVER (PARTITION BY beg.backfill_id), 0))::numeric(12,6) AS allocated_cost_usd,
        beg.llm_contacts,
        beg.llm_conversations
      FROM backfill_effort_groups beg
      JOIN eligible_backfills eb ON eb.id = beg.backfill_id
    ),
    backfill_groups AS (
      SELECT ba.group_key,
        ba.enterprise_id,
        e.name,
        0::bigint AS total,
        0::bigint AS qualified,
        0::bigint AS handoffs,
        0::bigint AS carteiras,
        0::bigint AS llm_calls,
        0::bigint AS llm_input_tokens,
        0::bigint AS llm_output_tokens,
        0::bigint AS llm_total_tokens,
        0::numeric(12,6) AS llm_tracked_cost_usd,
        SUM(ba.allocated_cost_usd)::numeric(12,6) AS llm_estimated_cost_usd,
        0::numeric(12,6) AS llm_official_cost_usd,
        0::numeric(12,6) AS llm_official_rows,
        SUM(ba.llm_contacts)::bigint AS llm_contacts,
        SUM(ba.llm_conversations)::bigint AS llm_conversations
      FROM backfill_allocations ba
      LEFT JOIN enterprises e ON e.id = ba.enterprise_id
      GROUP BY ba.group_key, ba.enterprise_id, e.name
    ),
    official_cost_allocations AS (
      SELECT
        COALESCE(ocs.enterprise_id::text, '__NO_ENTERPRISE__') AS group_key,
        ocs.enterprise_id,
        (
          ocs.amount_usd
          * EXTRACT(EPOCH FROM (LEAST(ocs.period_end, pb.period_end) - GREATEST(ocs.period_start, pb.period_start)))
          / NULLIF(EXTRACT(EPOCH FROM (ocs.period_end - ocs.period_start)), 0)
        )::numeric(12,6) AS allocated_cost_usd
      FROM openai_cost_snapshots ocs
      CROSS JOIN period_bounds pb
      WHERE ocs.period_start < pb.period_end
        AND ocs.period_end > pb.period_start
        AND ($1::int IS NULL OR ocs.enterprise_id = $1::int)
    ),
    official_cost_groups AS (
      SELECT
        oca.group_key,
        oca.enterprise_id,
        e.name,
        0::bigint AS total,
        0::bigint AS qualified,
        0::bigint AS handoffs,
        0::bigint AS carteiras,
        0::bigint AS llm_calls,
        0::bigint AS llm_input_tokens,
        0::bigint AS llm_output_tokens,
        0::bigint AS llm_total_tokens,
        0::numeric(12,6) AS llm_tracked_cost_usd,
        0::numeric(12,6) AS llm_estimated_cost_usd,
        SUM(oca.allocated_cost_usd)::numeric(12,6) AS llm_official_cost_usd,
        COUNT(*)::numeric(12,6) AS llm_official_rows,
        0::bigint AS llm_contacts,
        0::bigint AS llm_conversations
      FROM official_cost_allocations oca
      LEFT JOIN enterprises e ON e.id = oca.enterprise_id
      GROUP BY oca.group_key, oca.enterprise_id, e.name
    ),
    combined AS (
      SELECT * FROM conv_groups
      UNION ALL
      SELECT * FROM usage_groups
      UNION ALL
      SELECT * FROM backfill_groups
      UNION ALL
      SELECT * FROM official_cost_groups
    )
    SELECT CASE WHEN group_key = '__NO_ENTERPRISE__' THEN NULL ELSE MAX(enterprise_id) END AS enterprise_id,
      CASE
        WHEN group_key = '__NO_ENTERPRISE__' THEN '(sem empreendimento)'
        ELSE COALESCE(MAX(name), '(sem empreendimento)')
      END AS name,
      SUM(total)::text AS total,
      SUM(qualified)::text AS qualified,
      SUM(handoffs)::text AS handoffs,
      SUM(carteiras)::text AS carteiras,
      SUM(llm_official_cost_usd)::numeric(12,6)::text AS llm_official_cost_usd,
      (SUM(llm_tracked_cost_usd) + SUM(llm_estimated_cost_usd))::numeric(12,6)::text AS llm_local_estimated_cost_usd,
      SUM(llm_tracked_cost_usd)::numeric(12,6)::text AS llm_tracked_cost_usd,
      SUM(llm_estimated_cost_usd)::numeric(12,6)::text AS llm_estimated_cost_usd,
      CASE
        WHEN SUM(llm_official_rows) > 0 THEN SUM(llm_official_cost_usd)
        ELSE (SUM(llm_tracked_cost_usd) + SUM(llm_estimated_cost_usd))
      END::numeric(12,6)::text AS llm_cost_usd,
      CASE
        WHEN SUM(llm_official_rows) > 0 THEN 'official_openai'
        ELSE 'local_estimated'
      END AS llm_cost_source,
      SUM(llm_calls)::text AS llm_calls,
      SUM(llm_input_tokens)::text AS llm_input_tokens,
      SUM(llm_output_tokens)::text AS llm_output_tokens,
      SUM(llm_total_tokens)::text AS llm_total_tokens,
      CASE
        WHEN SUM(llm_contacts) > 0
          THEN (
            (CASE WHEN SUM(llm_official_rows) > 0 THEN SUM(llm_official_cost_usd) ELSE (SUM(llm_tracked_cost_usd) + SUM(llm_estimated_cost_usd)) END)
            / SUM(llm_contacts)
          )::numeric(12,6)::text
        WHEN SUM(total) > 0
          THEN (
            (CASE WHEN SUM(llm_official_rows) > 0 THEN SUM(llm_official_cost_usd) ELSE (SUM(llm_tracked_cost_usd) + SUM(llm_estimated_cost_usd)) END)
            / SUM(total)
          )::numeric(12,6)::text
        ELSE NULL
      END AS llm_cost_per_contact,
      CASE
        WHEN SUM(llm_conversations) > 0
          THEN (
            (CASE WHEN SUM(llm_official_rows) > 0 THEN SUM(llm_official_cost_usd) ELSE (SUM(llm_tracked_cost_usd) + SUM(llm_estimated_cost_usd)) END)
            / SUM(llm_conversations)
          )::numeric(12,6)::text
        WHEN SUM(total) > 0
          THEN (
            (CASE WHEN SUM(llm_official_rows) > 0 THEN SUM(llm_official_cost_usd) ELSE (SUM(llm_tracked_cost_usd) + SUM(llm_estimated_cost_usd)) END)
            / SUM(total)
          )::numeric(12,6)::text
        ELSE NULL
      END AS llm_cost_per_conversation
    FROM combined
    GROUP BY group_key
    ORDER BY SUM(total) DESC, name NULLS LAST
    LIMIT 50`,
    [eid, daysBack]
  );

  const periodStartIso = new Date(Date.now() - daysBack * 86400000).toISOString();

  return {
    period,
    periodStart: periodStartIso,
    enterpriseId: eid,
    kpis: {
      newConversationsToday: parseInt(newTodayRows[0]?.n || '0', 10) || 0,
      activeConversations: parseInt(activeRows[0]?.n || '0', 10) || 0,
      qualified: parseInt(qualRows[0]?.n || '0', 10) || 0,
      handoffs: parseInt(handRows[0]?.n || '0', 10) || 0,
      carteira: parseInt(carteiraRows[0]?.n || '0', 10) || 0,
      avgFirstResponseSeconds: avgFirst,
      noFirstResponse: parseInt(noFirstRows[0]?.n || '0', 10) || 0,
    },
    timeline: tlRows.map((row) => ({
      date: row.d,
      newConversations: parseInt(row.new_conversations, 10) || 0,
    })),
    classification: [
      { label: 'Novo', count: parseInt(novoC[0]?.n || '0', 10) || 0 },
      { label: 'Qualificado', count: parseInt(qualC[0]?.n || '0', 10) || 0 },
      { label: 'Handoff', count: parseInt(handC[0]?.n || '0', 10) || 0 },
      { label: 'Carteira', count: parseInt(resC[0]?.n || '0', 10) || 0 },
    ],
    enterprises: entRows.map((row) => ({
      enterpriseId: row.enterprise_id,
      name: row.name || '—',
      total: parseInt(row.total, 10) || 0,
      qualified: parseInt(row.qualified, 10) || 0,
      handoffs: parseInt(row.handoffs, 10) || 0,
      carteiras: parseInt(row.carteiras, 10) || 0,
      llmCostUsd: parseNullableNumber(row.llm_cost_usd),
      llmOfficialCostUsd: parseNullableNumber(row.llm_official_cost_usd),
      llmLocalEstimatedCostUsd: parseNullableNumber(row.llm_local_estimated_cost_usd),
      llmCostSource: row.llm_cost_source,
      llmTrackedCostUsd: parseNullableNumber(row.llm_tracked_cost_usd),
      llmEstimatedCostUsd: parseNullableNumber(row.llm_estimated_cost_usd),
      llmCalls: parseInt(row.llm_calls ?? '0', 10) || 0,
      llmInputTokens: parseInt(row.llm_input_tokens ?? '0', 10) || 0,
      llmOutputTokens: parseInt(row.llm_output_tokens ?? '0', 10) || 0,
      llmTotalTokens: parseInt(row.llm_total_tokens ?? '0', 10) || 0,
      llmCostPerContact: parseNullableNumber(row.llm_cost_per_contact),
      llmCostPerConversation: parseNullableNumber(row.llm_cost_per_conversation),
    })),
  };
}
