import { query } from '../db/pg.js';

export const APPOINTMENT_STATUSES = ['PENDENTE_CONFIRMACAO', 'CONFIRMADO', 'CANCELADO', 'REALIZADO', 'NO_SHOW', 'PENDENTE_DISTRIBUICAO'] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export interface AppointmentRow {
  id: number;
  customer_name: string;
  customer_phone: string;
  enterprise_id: number;
  broker_id: number | null;
  city: string;
  start_at: Date;
  end_at: Date;
  status: string;
  source: string;
  notes: string;
  conversation_id?: number | null;
  created_at: Date;
  updated_at: Date;
}

export interface ListAppointmentsParams {
  enterpriseId?: number;
  brokerId?: number;
  status?: string;
  date?: string;
  allowedEnterpriseIds?: number[];
}

export async function listAppointments(params: ListAppointmentsParams = {}): Promise<AppointmentRow[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  let i = 1;
  if (params.enterpriseId != null) {
    conditions.push(`enterprise_id = $${i++}`);
    values.push(params.enterpriseId);
  }
  if (params.allowedEnterpriseIds !== undefined) {
    if (params.allowedEnterpriseIds.length === 0) {
      conditions.push('FALSE');
    } else {
      conditions.push(`enterprise_id = ANY($${i++}::int[])`);
      values.push(params.allowedEnterpriseIds);
    }
  }
  if (params.brokerId != null) {
    conditions.push(`broker_id = $${i++}`);
    values.push(params.brokerId);
  }
  if (params.status != null && params.status !== '') {
    conditions.push(`status = $${i++}`);
    values.push(params.status);
  }
  if (params.date != null && params.date !== '') {
    conditions.push(`start_at::date = $${i++}::date`);
    values.push(params.date);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const { rows } = await query<AppointmentRow>(
    `SELECT * FROM appointments ${where} ORDER BY start_at DESC`,
    values
  );
  return rows;
}

export async function getAppointmentById(id: number): Promise<AppointmentRow | null> {
  const { rows } = await query<AppointmentRow>(`SELECT * FROM appointments WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function createAppointment(data: {
  customerName: string;
  customerPhone: string;
  enterpriseId: number;
  brokerId: number | null;
  city: string;
  startAt: Date;
  endAt: Date;
  status?: string;
  source?: string;
  notes?: string;
  conversationId?: number | null;
}): Promise<AppointmentRow> {
  const { rows } = await query<AppointmentRow>(
    `INSERT INTO appointments (customer_name, customer_phone, enterprise_id, broker_id, city, start_at, end_at, status, source, notes, conversation_id, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW()) RETURNING *`,
    [
      data.customerName.trim(),
      (data.customerPhone || '').trim(),
      data.enterpriseId,
      data.brokerId,
      (data.city || '').trim(),
      data.startAt,
      data.endAt,
      data.status ?? 'CONFIRMADO',
      data.source ?? 'ANA',
      data.notes ?? '',
      data.conversationId ?? null,
    ]
  );
  return rows[0];
}

/** Evita duplicar o mesmo compromisso (mesma conversa + início próximo). */
export async function findDuplicateAppointmentForConversation(
  conversationId: number,
  startAt: Date,
  windowSeconds = 480
): Promise<AppointmentRow | null> {
  const { rows } = await query<AppointmentRow>(
    `SELECT * FROM appointments
     WHERE conversation_id = $1
       AND status NOT IN ('CANCELADO')
       AND ABS(EXTRACT(EPOCH FROM (start_at - $2::timestamptz))) < $3
     LIMIT 1`,
    [conversationId, startAt, windowSeconds]
  );
  return rows[0] ?? null;
}

/**
 * Agendamento ainda editável para a mesma conversa + empreendimento (reagendamento / uma linha ativa).
 */
export async function findOpenAppointmentForConversationAndEnterprise(
  conversationId: number,
  enterpriseId: number
): Promise<AppointmentRow | null> {
  const { rows } = await query<AppointmentRow>(
    `SELECT * FROM appointments
     WHERE conversation_id = $1
       AND enterprise_id = $2
       AND status IN ('CONFIRMADO', 'PENDENTE_CONFIRMACAO', 'PENDENTE_DISTRIBUICAO')
     ORDER BY updated_at DESC, start_at DESC
     LIMIT 1`,
    [conversationId, enterpriseId]
  );
  return rows[0] ?? null;
}

export async function updateAppointmentSchedule(
  id: number,
  data: { startAt: Date; endAt: Date; notes?: string | null }
): Promise<AppointmentRow | null> {
  if (data.notes !== undefined && data.notes !== null) {
    const { rows } = await query<AppointmentRow>(
      `UPDATE appointments SET start_at = $1, end_at = $2, notes = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
      [data.startAt, data.endAt, data.notes, id]
    );
    return rows[0] ?? null;
  }
  const { rows } = await query<AppointmentRow>(
    `UPDATE appointments SET start_at = $1, end_at = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
    [data.startAt, data.endAt, id]
  );
  return rows[0] ?? null;
}

export async function updateAppointmentStatus(id: number, status: string): Promise<AppointmentRow | null> {
  if (!APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) return null;
  const { rows } = await query<AppointmentRow>(
    `UPDATE appointments SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [status, id]
  );
  return rows[0] ?? null;
}

export async function cancelAppointment(id: number): Promise<AppointmentRow | null> {
  return updateAppointmentStatus(id, 'CANCELADO');
}

/** Atribui corretor ao agendamento (para atribuição manual de pendentes). */
export async function updateAppointmentBroker(id: number, brokerId: number, status: string): Promise<AppointmentRow | null> {
  if (!APPOINTMENT_STATUSES.includes(status as AppointmentStatus)) return null;
  const { rows } = await query<AppointmentRow>(
    `UPDATE appointments SET broker_id = $1, status = $2, updated_at = NOW() WHERE id = $3 RETURNING *`,
    [brokerId, status, id]
  );
  return rows[0] ?? null;
}

export async function hasBrokerConflict(
  brokerId: number,
  startAt: Date,
  endAt: Date,
  excludeId?: number
): Promise<boolean> {
  const conditions = [
    'broker_id = $1',
    'status IN ($2, $3)',
    '((start_at, end_at) OVERLAPS ($4::timestamptz, $5::timestamptz))',
  ];
  const values: unknown[] = [brokerId, 'CONFIRMADO', 'PENDENTE_CONFIRMACAO', startAt, endAt];
  if (excludeId != null) {
    conditions.push(`id != $${values.length + 1}`);
    values.push(excludeId);
  }
  const { rows } = await query<{ id: number }>(
    `SELECT id FROM appointments WHERE ${conditions.join(' AND ')} LIMIT 1`,
    values
  );
  return rows.length > 0;
}

/** Conta agendamentos do corretor no mesmo dia (CONFIRMADO ou PENDENTE_CONFIRMACAO). */
export async function countBrokerAppointmentsOnDate(
  brokerId: number,
  date: Date | string
): Promise<number> {
  const dateStr = typeof date === 'string' ? date : date.toISOString().slice(0, 10);
  const { rows } = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM appointments
     WHERE broker_id = $1 AND start_at::date = $2::date
       AND status IN ('CONFIRMADO', 'PENDENTE_CONFIRMACAO')`,
    [brokerId, dateStr]
  );
  return parseInt(rows[0]?.count ?? '0', 10);
}

/** Exclui o agendamento (exclusão real). Retorna true se excluiu. */
export async function deleteAppointment(id: number): Promise<boolean> {
  const result = await query(`DELETE FROM appointments WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/** Reengajamento automático inadequado quando há agendamento ativo na conversa. */
export async function conversationHasActiveAppointmentForReengageBlock(conversationId: number): Promise<boolean> {
  const { rows } = await query<{ exists: boolean }>(
    `SELECT EXISTS(
       SELECT 1 FROM appointments 
       WHERE conversation_id = $1 
         AND status IN ('CONFIRMADO', 'PENDENTE_CONFIRMACAO')
         AND start_at > NOW()
    ) AS exists`,
    [conversationId]
  );
  return rows[0]?.exists ?? false;
}
