import { query } from '../db/pg.js';
import {
  listCorretoresByEnterprise,
  getCorretorById,
} from '../repositories/corretorRepository.js';
import { listByBroker } from '../repositories/brokerAvailabilityRepository.js';
import {
  createAppointment,
  hasBrokerConflict,
} from '../repositories/appointmentRepository.js';
import { getEnterpriseById } from '../repositories/enterpriseRepository.js';
const TZ_BUSINESS = 'America/Sao_Paulo';

function getDayOfWeekInTz(d: Date): number {
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: TZ_BUSINESS, weekday: 'long' }).format(d);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days.indexOf(dayName);
}

function getTimeStringInTz(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_BUSINESS,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  const s = parts.find((p) => p.type === 'second')?.value ?? '00';
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}:${s.padStart(2, '0')}`;
}

export interface CheckAvailabilityResult {
  available: boolean;
  eligibleBrokerCount: number;
  suggestedBrokerId?: number;
}

export interface AssignAppointmentResult {
  appointment: {
    id: number;
    customerName: string;
    customerPhone: string;
    enterpriseId: number;
    brokerId: number | null;
    city: string;
    startAt: string;
    endAt: string;
    status: string;
    source: string;
    notes: string;
    createdAt: string;
    updatedAt: string;
  };
  broker: {
    id: number;
    fullName: string;
    phone: string;
  } | null;
  empreendimento: string | null;
  dataHora: string;
  cliente: string;
}

function toIso(d: Date): string {
  return d instanceof Date ? d.toISOString() : String(d);
}

/**
 * Verifica se o corretor tem disponibilidade semanal para o slot.
 * Usa dia da semana e horário em America/Sao_Paulo de forma explícita,
 * independente do timezone do ambiente.
 */
async function brokerHasAvailabilityForSlot(
  brokerId: number,
  startAt: Date,
  endAt: Date
): Promise<boolean> {
  const slots = await listByBroker(brokerId);
  if (slots.length === 0) return false;
  const dow = getDayOfWeekInTz(startAt);
  const startTimeStr = getTimeStringInTz(startAt);
  const endTimeStr = getTimeStringInTz(endAt);
  return slots.some(
    (s) =>
      s.active &&
      s.weekday === dow &&
      s.start_time <= startTimeStr &&
      s.end_time >= endTimeStr
  );
}

export async function findEligibleBroker(
  enterpriseId: number,
  startAt: Date,
  endAt: Date
): Promise<number | null> {
  const brokers = await query<{ id: number; last_assigned_at: Date | null }>(
    `SELECT c.id, c.last_assigned_at
     FROM corretores c
     INNER JOIN corretor_empreendimentos ce ON ce.corretor_id = c.id
     WHERE c.active = true
       AND COALESCE(c.receiving_enabled, true) = true
       AND ce.enterprise_id = $1
     ORDER BY c.last_assigned_at ASC NULLS FIRST, c.id ASC`,
    [enterpriseId]
  );
  for (const b of brokers.rows) {
    const hasAvail = await brokerHasAvailabilityForSlot(b.id, startAt, endAt);
    if (!hasAvail) continue;
    const conflict = await hasBrokerConflict(b.id, startAt, endAt);
    if (!conflict) return b.id;
  }
  return null;
}

export async function checkAvailability(
  enterpriseId: number,
  startAt: Date,
  endAt: Date
): Promise<CheckAvailabilityResult> {
  const brokerId = await findEligibleBroker(enterpriseId, startAt, endAt);
  const { rows: brokers } = await query<{ id: number; receiving_enabled: boolean | null }>(
    `SELECT c.id, c.receiving_enabled
     FROM corretores c
     INNER JOIN corretor_empreendimentos ce ON ce.corretor_id = c.id
     WHERE c.active = true
       AND COALESCE(c.receiving_enabled, true) = true
       AND ce.enterprise_id = $1`,
    [enterpriseId]
  );
  let eligibleCount = 0;
  for (const b of brokers) {
    const hasAvail = await brokerHasAvailabilityForSlot(b.id, startAt, endAt);
    if (!hasAvail) continue;
    const conflict = await hasBrokerConflict(b.id, startAt, endAt);
    if (!conflict) eligibleCount++;
  }
  return {
    available: brokerId != null,
    eligibleBrokerCount: eligibleCount,
    suggestedBrokerId: brokerId ?? undefined,
  };
}

export async function assignAppointment(data: {
  customerName: string;
  customerPhone: string;
  enterpriseId: number;
  city: string;
  startAt: Date;
  endAt: Date;
  notes?: string;
  source?: string;
}): Promise<AssignAppointmentResult> {
  // Revalida imediatamente antes de criar para evitar race conditions
  const brokerId = await findEligibleBroker(
    data.enterpriseId,
    data.startAt,
    data.endAt
  );
  const status = brokerId ? 'CONFIRMADO' : 'PENDENTE_DISTRIBUICAO';
  const app = await createAppointment({
    customerName: data.customerName,
    customerPhone: data.customerPhone,
    enterpriseId: data.enterpriseId,
    brokerId,
    city: data.city,
    startAt: data.startAt,
    endAt: data.endAt,
    status,
    source: data.source ?? 'ANA',
    notes: data.notes ?? '',
  });
  if (brokerId) {
    await query(
      `UPDATE corretores SET last_assigned_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [brokerId]
    );
  }
  const broker = brokerId ? await getCorretorById(brokerId) : null;
  const ent = data.enterpriseId ? await getEnterpriseById(data.enterpriseId) : null;
  return {
    appointment: {
      id: app.id,
      customerName: app.customer_name,
      customerPhone: app.customer_phone,
      enterpriseId: app.enterprise_id,
      brokerId: app.broker_id,
      city: app.city,
      startAt: toIso(app.start_at),
      endAt: toIso(app.end_at),
      status: app.status,
      source: app.source,
      notes: app.notes,
      createdAt: toIso(app.created_at),
      updatedAt: toIso(app.updated_at),
    },
    broker: broker
      ? { id: broker.id, fullName: broker.full_name, phone: broker.phone }
      : null,
    empreendimento: ent?.name ?? null,
    dataHora: toIso(app.start_at),
    cliente: app.customer_name,
  };
}
