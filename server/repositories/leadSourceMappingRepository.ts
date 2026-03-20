import { query } from '../db/pg.js';

/** Normaliza chave para lookup consistente (minúsculas, trim). */
export function normalizeLeadSourceKey(key: string): string {
  return key.trim().toLowerCase();
}

/** Retorna enterprise_id ativo vinculado à chave, ou null. */
export async function lookupLeadSourceEnterpriseMapping(sourceKey: string): Promise<number | null> {
  const k = normalizeLeadSourceKey(sourceKey);
  if (!k) return null;
  const { rows } = await query<{ enterprise_id: number }>(
    `SELECT enterprise_id FROM lead_source_enterprise_map WHERE source_key = $1`,
    [k]
  );
  const id = rows[0]?.enterprise_id;
  return id != null && Number.isFinite(id) ? id : null;
}
