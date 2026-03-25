import { query } from '../db/pg.js';

/**
 * Dashboard: única fonte de verdade para classificação = coluna `classification`.
 * A flag `handoff` não entra em nenhuma métrica aqui (compatível com o restante do produto).
 */
export type DashboardPeriod = 'today' | '7d' | '30d';

function periodDaysBack(period: DashboardPeriod): number {
  if (period === 'today') return 0;
  if (period === '30d') return 29;
  return 6;
}

const TZ = 'America/Sao_Paulo';

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
  }[];
  attentionItems: {
    id: number;
    customerName: string | null;
    contactPhone: string | null;
    reason: string;
    enterpriseName: string | null;
  }[];
}

function entClause(paramIndex: number): string {
  return ` AND ($${paramIndex}::int IS NULL OR c.enterprise_id = $${paramIndex}::int)`;
}

export async function getDashboardOverview(
  period: DashboardPeriod,
  enterpriseId: number | null
): Promise<DashboardOverview> {
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
  }>(
    `SELECT c.enterprise_id,
      COALESCE(e.name, '(sem empreendimento)') AS name,
      COUNT(*)::text AS total,
      SUM(CASE WHEN c.classification = 'Qualificado' THEN 1 ELSE 0 END)::text AS qualified,
      SUM(CASE WHEN c.classification = 'Handoff' THEN 1 ELSE 0 END)::text AS handoffs,
      SUM(CASE WHEN c.classification = 'Carteira' THEN 1 ELSE 0 END)::text AS carteiras
    FROM conversations c
    LEFT JOIN enterprises e ON e.id = c.enterprise_id
    WHERE 1=1 ${ent}
    GROUP BY c.enterprise_id, e.name
    ORDER BY COUNT(*) DESC NULLS LAST, name NULLS LAST
    LIMIT 50`,
    paramsE
  );

  const { rows: attnNoFirst } = await query<{
    id: number;
    customer_name: string | null;
    contact_phone: string | null;
    enterprise_name: string | null;
  }>(
    `SELECT c.id, c.customer_name, c.contact_phone, e.name AS enterprise_name
     FROM conversations c
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     WHERE EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user')
       AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'assistant')
     ${ent}
     ORDER BY c.created_at DESC NULLS LAST LIMIT 12`,
    paramsE
  );

  type AttnRow = {
    id: number;
    customer_name: string | null;
    contact_phone: string | null;
    enterprise_name: string | null;
  };

  const { rows: attnNovoSemProjetoRows } = await query<AttnRow>(
    `SELECT c.id, c.customer_name, c.contact_phone, e.name AS enterprise_name
     FROM conversations c
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     WHERE c.classification = 'Novo' AND c.enterprise_id IS NULL
     ${ent}
     ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC LIMIT 12`,
    paramsE
  );

  const { rows: attnStalled24h } = await query<AttnRow>(
    `SELECT c.id, c.customer_name, c.contact_phone, e.name AS enterprise_name
     FROM conversations c
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     WHERE c.classification IN ('Novo', 'Qualificado')
       AND COALESCE(c.last_message_at, c.created_at) < NOW() - INTERVAL '24 hours'
     ${ent}
     ORDER BY COALESCE(c.last_message_at, c.created_at) ASC LIMIT 12`,
    paramsE
  );

  /** Itens de atenção: uma conversa só aparece uma vez; motivo pela prioridade (a > b > c). */
  const attentionById = new Map<number, DashboardOverview['attentionItems'][0]>();
  const pushAttn = (row: AttnRow, reason: string) => {
    if (attentionById.has(row.id)) return;
    attentionById.set(row.id, {
      id: row.id,
      customerName: row.customer_name,
      contactPhone: row.contact_phone,
      reason,
      enterpriseName: row.enterprise_name,
    });
  };
  for (const r of attnNoFirst) pushAttn(r, 'Sem primeira resposta');
  for (const r of attnNovoSemProjetoRows) pushAttn(r, 'Novo sem projeto');
  for (const r of attnStalled24h) pushAttn(r, 'Conversas paradas');
  const attentionItems = [...attentionById.values()];

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
    })),
    attentionItems,
  };
}
