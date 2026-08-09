import { query } from '../db/pg.js';

/**
 * Sincronização ativa com a Costs API da OpenAI foi removida (operação já
 * migrou 100% para Bedrock; nenhuma empresa ativa dependia da sincronização
 * de custos OpenAI). Mantido apenas o leitor de snapshots já persistidos
 * historicamente em `openai_cost_snapshots`.
 */
export async function listOpenAiCostSnapshots(params: {
  startTime?: Date | null;
  endTime?: Date | null;
  enterpriseId?: number | null;
  limit?: number;
}): Promise<Array<Record<string, unknown>>> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (params.startTime) {
    conditions.push(`period_end >= $${i++}`);
    values.push(params.startTime);
  }
  if (params.endTime) {
    conditions.push(`period_start < $${i++}`);
    values.push(params.endTime);
  }
  if (params.enterpriseId != null) {
    conditions.push(`enterprise_id = $${i++}`);
    values.push(params.enterpriseId);
  }
  const limit = Math.max(1, Math.min(params.limit ?? 200, 1000));
  values.push(limit);
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query<Record<string, unknown>>(
    `SELECT
      id,
      period_start,
      period_end,
      openai_api_key_id,
      openai_project_id,
      line_item,
      enterprise_id,
      amount_usd,
      synced_at,
      created_at
    FROM openai_cost_snapshots
    ${where}
    ORDER BY period_start DESC, id DESC
    LIMIT $${i}`,
    values
  );
  return rows;
}
