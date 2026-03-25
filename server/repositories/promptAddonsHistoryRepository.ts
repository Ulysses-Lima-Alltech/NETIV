import { query } from '../db/pg.js';

export interface PromptAddonsHistoryRow {
  id: number;
  enterprise_id: number;
  rule_text: string;
  created_at: Date;
  created_by_user_id: number | null;
  creator_name?: string | null;
}

export async function insertPromptAddonsHistory(
  enterpriseId: number,
  ruleText: string,
  createdByUserId: number | null
): Promise<void> {
  await query(
    `INSERT INTO enterprise_prompt_addons_history (enterprise_id, rule_text, created_by_user_id)
     VALUES ($1, $2, $3)`,
    [enterpriseId, ruleText, createdByUserId]
  );
}

export async function listPromptAddonsHistory(enterpriseId: number): Promise<PromptAddonsHistoryRow[]> {
  const { rows } = await query<PromptAddonsHistoryRow>(
    `SELECT h.id, h.enterprise_id, h.rule_text, h.created_at, h.created_by_user_id, u.name AS creator_name
     FROM enterprise_prompt_addons_history h
     LEFT JOIN app_users u ON u.id = h.created_by_user_id
     WHERE h.enterprise_id = $1
     ORDER BY h.created_at DESC
     LIMIT 200`,
    [enterpriseId]
  );
  return rows;
}
