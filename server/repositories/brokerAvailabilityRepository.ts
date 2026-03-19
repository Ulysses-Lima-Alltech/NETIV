import { query } from '../db/pg.js';

export interface BrokerAvailabilityRow {
  id: number;
  broker_id: number;
  weekday: number;
  start_time: string;
  end_time: string;
  active: boolean;
  created_at: Date;
  updated_at: Date;
}

export async function listByBroker(brokerId: number): Promise<BrokerAvailabilityRow[]> {
  const { rows } = await query<BrokerAvailabilityRow>(
    `SELECT * FROM broker_availability WHERE broker_id = $1 ORDER BY weekday, start_time`,
    [brokerId]
  );
  return rows;
}

export async function getById(id: number): Promise<BrokerAvailabilityRow | null> {
  const { rows } = await query<BrokerAvailabilityRow>(`SELECT * FROM broker_availability WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function create(data: {
  brokerId: number;
  weekday: number;
  startTime: string;
  endTime: string;
  active?: boolean;
}): Promise<BrokerAvailabilityRow> {
  const { rows } = await query<BrokerAvailabilityRow>(
    `INSERT INTO broker_availability (broker_id, weekday, start_time, end_time, active, updated_at)
     VALUES ($1, $2, $3::time, $4::time, $5, NOW()) RETURNING *`,
    [data.brokerId, data.weekday, data.startTime, data.endTime, data.active !== false]
  );
  return rows[0];
}

export async function update(
  id: number,
  data: { weekday?: number; startTime?: string; endTime?: string; active?: boolean }
): Promise<BrokerAvailabilityRow | null> {
  const cur = await getById(id);
  if (!cur) return null;
  const weekday = data.weekday ?? cur.weekday;
  const startTime = data.startTime ?? cur.start_time;
  const endTime = data.endTime ?? cur.end_time;
  const active = data.active !== undefined ? data.active : cur.active;
  const { rows } = await query<BrokerAvailabilityRow>(
    `UPDATE broker_availability SET weekday = $1, start_time = $2::time, end_time = $3::time, active = $4, updated_at = NOW() WHERE id = $5 RETURNING *`,
    [weekday, startTime, endTime, active, id]
  );
  return rows[0] ?? null;
}

export async function deleteAvailability(id: number): Promise<boolean> {
  const { rowCount } = await query(`DELETE FROM broker_availability WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}

export async function listBrokerIdsWithAvailability(): Promise<number[]> {
  const { rows } = await query<{ broker_id: number }>(
    `SELECT DISTINCT broker_id FROM broker_availability WHERE active = true`
  );
  return rows.map((r) => r.broker_id);
}
