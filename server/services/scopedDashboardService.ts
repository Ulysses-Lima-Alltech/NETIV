import { query } from '../db/pg.js';
import type {
  DashboardAttentionItemsResponse,
  DashboardAttentionType,
  DashboardCsvRow,
  DashboardOverview,
  DashboardPeriod,
} from '../repositories/dashboardRepository.js';

const TZ = 'America/Sao_Paulo';

function daysBack(period: DashboardPeriod): number {
  return period === 'today' ? 0 : period === '30d' ? 29 : 6;
}

export async function getScopedDashboardCsvRows(
  period: DashboardPeriod,
  enterpriseId: number | null,
  conversationIds: number[]
): Promise<DashboardCsvRow[]> {
  if (conversationIds.length === 0) return [];
  const { rows } = await query<DashboardCsvRow>(
    `SELECT c.id AS conversation_id,
       COALESCE(NULLIF(TRIM(c.whatsapp_display_name), ''), NULLIF(TRIM(c.customer_name), ''), c.contact_phone, c.external_contact_id, 'Sem nome') AS customer_name,
       c.contact_phone, COALESCE(e.name, '') AS enterprise_name, c.classification, c.lead_temperature,
       c.assigned_broker_id, c.created_at, c.last_message_at,
       (EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user')
        AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'assistant')) AS no_first_response,
       (c.classification = 'Novo' AND c.enterprise_id IS NULL) AS is_novo_sem_projeto,
       (c.classification IN ('Novo','Qualificado') AND COALESCE(c.last_message_at,c.created_at) <= NOW() - INTERVAL '12 hours'
        AND COALESCE(c.last_message_at,c.created_at) > NOW() - INTERVAL '24 hours') AS is_inactive_12_24h,
       CASE
         WHEN EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'user')
          AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.role = 'assistant') THEN 'Sem primeira resposta'
         WHEN c.classification = 'Novo' AND c.enterprise_id IS NULL THEN 'Novo sem projeto'
         WHEN c.classification IN ('Novo','Qualificado') AND COALESCE(c.last_message_at,c.created_at) <= NOW() - INTERVAL '12 hours'
          AND COALESCE(c.last_message_at,c.created_at) > NOW() - INTERVAL '24 hours' THEN 'Sem atividade entre 12h e 24h'
         ELSE '' END AS attention_reason
     FROM conversations c LEFT JOIN enterprises e ON e.id = c.enterprise_id
     WHERE c.id = ANY($1::bigint[])
       AND ($2::int IS NULL OR c.enterprise_id = $2)
       AND (c.created_at AT TIME ZONE '${TZ}')::date >= (CURRENT_TIMESTAMP AT TIME ZONE '${TZ}')::date - $3::int
     ORDER BY c.created_at DESC`,
    [conversationIds, enterpriseId, daysBack(period)]
  );
  return rows;
}

export async function getScopedDashboardAttentionItems(
  enterpriseId: number | null,
  attentionType: DashboardAttentionType,
  conversationIds: number[]
): Promise<DashboardAttentionItemsResponse> {
  if (conversationIds.length === 0) return { attentionItems: [], attentionType };
  const rows = await getScopedDashboardCsvRows('30d', enterpriseId, conversationIds);
  const filtered = rows.filter((row) => {
    if (attentionType === 'no_first_response') return row.no_first_response;
    if (attentionType === 'novo_sem_projeto') return row.is_novo_sem_projeto;
    if (attentionType === 'inactive_12_24h') return row.is_inactive_12_24h;
    return row.no_first_response || row.is_novo_sem_projeto || row.is_inactive_12_24h;
  });
  return {
    attentionType,
    attentionItems: filtered.slice(0, 100).map((row) => ({
      id: row.conversation_id,
      customerName: row.customer_name,
      contactPhone: row.contact_phone,
      reason: row.attention_reason,
      enterpriseName: row.enterprise_name,
    })),
  };
}

export async function getScopedDashboardOverview(
  period: DashboardPeriod,
  enterpriseId: number | null,
  conversationIds: number[]
): Promise<DashboardOverview> {
  const start = new Date(Date.now() - daysBack(period) * 86400000).toISOString();
  if (conversationIds.length === 0) {
    return {
      period, periodStart: start, enterpriseId,
      kpis: { newConversationsToday: 0, activeConversations: 0, qualified: 0, handoffs: 0, carteira: 0, avgFirstResponseSeconds: null, noFirstResponse: 0 },
      timeline: [], classification: [], enterprises: [],
    };
  }
  const csvRows = await getScopedDashboardCsvRows(period, enterpriseId, conversationIds);
  const { rows: activeRows } = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM conversations
     WHERE id = ANY($1::bigint[]) AND ($2::int IS NULL OR enterprise_id = $2) AND manual_closed_at IS NULL`,
    [conversationIds, enterpriseId]
  );
  const { rows: avgRows } = await query<{ average: string | null }>(
    `SELECT AVG(EXTRACT(EPOCH FROM (reply.first_reply - inbound.first_inbound)))::text AS average
     FROM conversations c
     JOIN LATERAL (SELECT MIN(created_at) AS first_inbound FROM messages WHERE conversation_id=c.id AND role='user') inbound ON inbound.first_inbound IS NOT NULL
     JOIN LATERAL (SELECT MIN(created_at) AS first_reply FROM messages WHERE conversation_id=c.id AND role='assistant' AND created_at >= inbound.first_inbound) reply ON reply.first_reply IS NOT NULL
     WHERE c.id = ANY($1::bigint[]) AND ($2::int IS NULL OR c.enterprise_id = $2)`,
    [conversationIds, enterpriseId]
  );
  const timelineMap = new Map<string, number>();
  const classificationMap = new Map<string, number>();
  const enterpriseMap = new Map<string, DashboardCsvRow[]>();
  for (const row of csvRows) {
    const day = row.created_at.toISOString().slice(0, 10);
    timelineMap.set(day, (timelineMap.get(day) ?? 0) + 1);
    classificationMap.set(row.classification, (classificationMap.get(row.classification) ?? 0) + 1);
    const groupKey = row.enterprise_name || '(sem empreendimento)';
    enterpriseMap.set(groupKey, [...(enterpriseMap.get(groupKey) ?? []), row]);
  }
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
  return {
    period, periodStart: start, enterpriseId,
    kpis: {
      newConversationsToday: csvRows.filter((row) => row.created_at.toISOString().slice(0, 10) === today).length,
      activeConversations: Number(activeRows[0]?.total ?? 0),
      qualified: csvRows.filter((row) => row.classification === 'Qualificado').length,
      handoffs: csvRows.filter((row) => row.classification === 'Handoff').length,
      carteira: csvRows.filter((row) => row.classification === 'Carteira').length,
      avgFirstResponseSeconds: avgRows[0]?.average == null ? null : Number(avgRows[0].average),
      noFirstResponse: csvRows.filter((row) => row.no_first_response).length,
    },
    timeline: [...timelineMap].sort(([a], [b]) => a.localeCompare(b)).map(([date, newConversations]) => ({ date, newConversations })),
    classification: [...classificationMap].map(([label, count]) => ({ label, count })),
    enterprises: [...enterpriseMap].map(([name, rows]) => ({
      enterpriseId,
      name,
      total: rows.length,
      qualified: rows.filter((row) => row.classification === 'Qualificado').length,
      handoffs: rows.filter((row) => row.classification === 'Handoff').length,
      carteiras: rows.filter((row) => row.classification === 'Carteira').length,
      llmCostUsd: null, llmTrackedCostUsd: null, llmEstimatedCostUsd: null,
      llmCalls: 0, llmInputTokens: 0, llmOutputTokens: 0, llmTotalTokens: 0,
      llmCostPerContact: null, llmCostPerConversation: null,
    })),
  };
}
