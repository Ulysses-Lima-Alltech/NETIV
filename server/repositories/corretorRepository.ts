import { query } from '../db/pg.js';

export interface CorretorRow {
  id: number;
  full_name: string;
  city: string;
  phone: string;
  real_estate_agency: string;
  email: string | null;
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
  return rows.map((r: { enterprise_id: number }) => r.enterprise_id);
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
  email?: string | null;
}): Promise<CorretorRow> {
  const fullName = data.fullName.trim();
  if (!fullName) throw new Error('Nome completo é obrigatório.');
  const { rows } = await query<CorretorRow>(
    `INSERT INTO corretores (full_name, city, phone, real_estate_agency, email, active, updated_at)
     VALUES ($1, $2, $3, $4, $5, true, NOW()) RETURNING *`,
    [fullName, (data.city || '').trim(), (data.phone || '').trim(), (data.realEstateAgency || '').trim(), data.email || null]
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
    email?: string | null;
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
  const email = data.email !== undefined ? data.email : cur.email;
  const { rows } = await query<CorretorRow>(
    `UPDATE corretores SET full_name = $1, city = $2, phone = $3, real_estate_agency = $4, active = $5, email = $6, updated_at = NOW() WHERE id = $7 RETURNING *`,
    [fullName, city, phone, realEstateAgency, active, email, id]
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

export async function findCorretorByPhoneOrEmail(
  phone: string | null,
  email: string | null
): Promise<CorretorRow | null> {
  if (!phone && !email) return null;

  let conditions: string[] = [];
  let params: (string | null)[] = [];
  let paramIndex = 1;

  if (phone) {
    conditions.push(`phone = $${paramIndex}`);
    params.push(phone);
    paramIndex++;
  }

  if (email) {
    conditions.push(`LOWER(email) = LOWER($${paramIndex})`);
    params.push(email);
    paramIndex++;
  }

  const sql = `SELECT * FROM corretores WHERE (${conditions.join(' OR ')}) AND active = true LIMIT 1`;
  const { rows } = await query<CorretorRow>(sql, params);
  return rows[0] ?? null;
}

export async function upsertCorretorAndEnterprise(args: {
  existingBrokerId: number | null;
  fullName: string;
  phone: string | null;
  email: string | null;
  realEstateAgency: string;
  enterpriseId: number;
}): Promise<number> {
  const { existingBrokerId, fullName, phone, email, realEstateAgency, enterpriseId } = args;

  let corretorId: number;

  if (existingBrokerId) {
    const existing = await getCorretorById(existingBrokerId);
    if (existing) {
      await updateCorretor(existingBrokerId, {
        fullName,
        phone: phone ?? existing.phone,
        email: email ?? existing.email,
        realEstateAgency,
      });
      corretorId = existingBrokerId;
    } else {
      const match = await findCorretorByPhoneOrEmail(phone, email);
      if (match) {
        await updateCorretor(match.id, {
          fullName,
          phone: phone ?? match.phone,
          email: email ?? match.email,
          realEstateAgency,
        });
        corretorId = match.id;
      } else {
        const newCorretor = await createCorretor({
          fullName,
          city: '',
          phone: phone ?? '',
          realEstateAgency,
        });
        corretorId = newCorretor.id;
      }
    }
  } else {
    const match = await findCorretorByPhoneOrEmail(phone, email);
    if (match) {
      await updateCorretor(match.id, {
        fullName,
        phone: phone ?? match.phone,
        email: email ?? match.email,
        realEstateAgency,
      });
      corretorId = match.id;
    } else {
      const newCorretor = await createCorretor({
        fullName,
        city: '',
        phone: phone ?? '',
        realEstateAgency,
      });
      corretorId = newCorretor.id;
    }
  }

  await query(
    `INSERT INTO corretor_empreendimentos (corretor_id, enterprise_id)
     VALUES ($1, $2)
     ON CONFLICT (corretor_id, enterprise_id) DO NOTHING`,
    [corretorId, enterpriseId]
  );

  return corretorId;
}
