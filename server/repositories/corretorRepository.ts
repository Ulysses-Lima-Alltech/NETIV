import { query } from '../db/pg.js';

export interface CorretorRow {
  id: number;
  full_name: string;
  city: string;
  phone: string;
  real_estate_agency: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function listCorretores(activeOnly = false): Promise<CorretorRow[]> {
  const sql = activeOnly
    ? `SELECT * FROM corretores WHERE active = true ORDER BY full_name`
    : `SELECT * FROM corretores ORDER BY full_name`;
  const { rows } = await query<CorretorRow>(sql);
  return rows;
}

export async function getCorretorById(id: number): Promise<CorretorRow | null> {
  const { rows } = await query<CorretorRow>(`SELECT * FROM corretores WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getCorretorEnterpriseIds(corretorId: number): Promise<number[]> {
  const { rows } = await query<{ enterprise_id: number }>(
    `SELECT enterprise_id FROM corretor_empreendimentos WHERE corretor_id = $1`,
    [corretorId]
  );
  return rows.map((r) => r.enterprise_id);
}

export async function setCorretorEnterprises(corretorId: number, enterpriseIds: number[]): Promise<void> {
  await query(`DELETE FROM corretor_empreendimentos WHERE corretor_id = $1`, [corretorId]);
  const unique = [...new Set(enterpriseIds.filter((e) => e > 0))];
  for (const eid of unique) {
    await query(
      `INSERT INTO corretor_empreendimentos (corretor_id, enterprise_id) VALUES ($1, $2)`,
      [corretorId, eid]
    );
  }
}

export interface CorretorWithEnterprises extends CorretorRow {
  enterprise_ids: number[];
}

export async function listCorretoresWithEnterprises(activeOnly = false): Promise<CorretorWithEnterprises[]> {
  const where = activeOnly ? ' WHERE c.active = true' : '';
  const { rows } = await query<CorretorRow & { enterprise_ids: number[] }>(
    `SELECT c.*, COALESCE(
      (SELECT array_agg(ce.enterprise_id ORDER BY ce.enterprise_id) FROM corretor_empreendimentos ce WHERE ce.corretor_id = c.id),
      ARRAY[]::int[]
    ) AS enterprise_ids
     FROM corretores c${where}
     ORDER BY c.full_name`
  );
  return rows;
}

export async function listCorretoresByEnterprise(enterpriseId: number): Promise<CorretorWithEnterprises[]> {
  const { rows } = await query<CorretorRow & { enterprise_ids: number[] }>(
    `SELECT c.*, COALESCE(
      (SELECT array_agg(ce.enterprise_id ORDER BY ce.enterprise_id) FROM corretor_empreendimentos ce WHERE ce.corretor_id = c.id),
      ARRAY[]::int[]
    ) AS enterprise_ids
     FROM corretores c
     INNER JOIN corretor_empreendimentos ce ON ce.corretor_id = c.id
     WHERE c.active = true AND ce.enterprise_id = $1
     ORDER BY c.full_name`,
    [enterpriseId]
  );
  return rows;
}

export async function createCorretor(data: {
  fullName: string;
  city: string;
  phone: string;
  realEstateAgency: string;
  enterpriseIds?: number[];
}): Promise<CorretorRow> {
  const fullName = data.fullName.trim();
  if (!fullName) throw new Error('Nome completo é obrigatório.');
  const { rows } = await query<CorretorRow>(
    `INSERT INTO corretores (full_name, city, phone, real_estate_agency, active, updated_at)
     VALUES ($1, $2, $3, $4, true, NOW()) RETURNING *`,
    [fullName, (data.city || '').trim(), (data.phone || '').trim(), (data.realEstateAgency || '').trim()]
  );
  const corretor = rows[0];
  const ids = data.enterpriseIds ?? [];
  if (ids.length > 0) await setCorretorEnterprises(corretor.id, ids);
  return corretor;
}

export async function updateCorretor(
  id: number,
  data: {
    fullName?: string;
    city?: string;
    phone?: string;
    realEstateAgency?: string;
    active?: boolean;
    enterpriseIds?: number[];
  }
): Promise<CorretorRow | null> {
  const cur = await getCorretorById(id);
  if (!cur) return null;
  const fullName = data.fullName !== undefined ? data.fullName.trim() : cur.full_name;
  if (!fullName) throw new Error('Nome completo é obrigatório.');
  const city = data.city !== undefined ? data.city.trim() : cur.city;
  const phone = data.phone !== undefined ? data.phone.trim() : cur.phone;
  const realEstateAgency = data.realEstateAgency !== undefined ? data.realEstateAgency.trim() : cur.real_estate_agency;
  const active = data.active !== undefined ? data.active : cur.active;
  const { rows } = await query<CorretorRow>(
    `UPDATE corretores SET full_name = $1, city = $2, phone = $3, real_estate_agency = $4, active = $5, updated_at = NOW() WHERE id = $6 RETURNING *`,
    [fullName, city, phone, realEstateAgency, active, id]
  );
  const updated = rows[0] ?? null;
  if (updated && data.enterpriseIds !== undefined) await setCorretorEnterprises(id, data.enterpriseIds);
  return updated;
}

export async function inactivateCorretor(id: number): Promise<CorretorRow | null> {
  const { rows } = await query<CorretorRow>(
    `UPDATE corretores SET active = false, updated_at = NOW() WHERE id = $1 RETURNING *`,
    [id]
  );
  return rows[0] ?? null;
}

export async function deleteCorretor(id: number): Promise<boolean> {
  const { rowCount } = await query(`DELETE FROM corretores WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
