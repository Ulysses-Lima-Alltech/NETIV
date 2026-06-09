import { query } from '../db/pg.js';
import { notifyDjango } from './djangoWebhook.js';
import { getCorretorById, listCorretoresByEnterprise } from '../repositories/corretorRepository.js';
import { listByBroker } from '../repositories/brokerAvailabilityRepository.js';
import {
  createAppointment,
  hasBrokerConflict,
  countBrokerAppointmentsOnDate,
  getAppointmentById,
  updateAppointmentBroker,
  type AppointmentRow,
} from '../repositories/appointmentRepository.js';
import { getEnterpriseById } from '../repositories/enterpriseRepository.js';

const TZ_BUSINESS = 'America/Sao_Paulo';
const DEBUG_ASSIGN = true; // logs temporários para auditoria

/** Dia da semana em America/Sao_Paulo: 0=domingo, 1=segunda, ..., 6=sábado (convenção JS, alinhado ao banco). */
function getDayOfWeekInTz(d: Date): number {
  const dayName = new Intl.DateTimeFormat('en-US', { timeZone: TZ_BUSINESS, weekday: 'long' }).format(d);
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days.indexOf(dayName);
}

/** Horário em HH:MM no timezone de negócio (normalizado para comparação com slots). */
function getTimeStringInTz(d: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ_BUSINESS,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const h = parts.find((p) => p.type === 'hour')?.value ?? '00';
  const m = parts.find((p) => p.type === 'minute')?.value ?? '00';
  return `${h.padStart(2, '0')}:${m.padStart(2, '0')}`;
}

/** Normaliza tempo para HH:MM para evitar falha de comparação (DB pode retornar HH:MM ou HH:MM:SS). */
function normalizeTimeHHMM(t: string): string {
  const s = String(t ?? '').trim();
  return s.length >= 5 ? s.slice(0, 5) : s;
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
/** Comparação segura de horários em HH:MM (evita falha DB retornar HH:MM:SS). */
function timeLte(a: string, b: string): boolean {
  return normalizeTimeHHMM(a) <= normalizeTimeHHMM(b);
}
function timeGte(a: string, b: string): boolean {
  return normalizeTimeHHMM(a) >= normalizeTimeHHMM(b);
}

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
      timeLte(s.start_time, startTimeStr) &&
      timeGte(s.end_time, endTimeStr)
  );
}

/**
 * Encontra o corretor elegível para o slot.
 * Avalia TODOS os corretores vinculados ao empreendimento, filtra os disponíveis
 * e escolhe aquele com MENOR quantidade de agendamentos no dia (distribuição justa).
 * Desempate: last_assigned_at ASC, depois id ASC.
 */
export async function findEligibleBroker(
  enterpriseId: number,
  startAt: Date,
  endAt: Date
): Promise<number | null> {
  const dow = getDayOfWeekInTz(startAt);
  const startTimeStr = getTimeStringInTz(startAt);
  const endTimeStr = getTimeStringInTz(endAt);

  const { rows: brokers } = await query<{ id: number; full_name: string; active: boolean; receiving_enabled: boolean | null; last_assigned_at: Date | null }>(
    `SELECT c.id, c.full_name, c.active, c.receiving_enabled, c.last_assigned_at
     FROM corretores c
     INNER JOIN corretor_empreendimentos ce ON ce.corretor_id = c.id
     WHERE c.active = true
       AND COALESCE(c.receiving_enabled, true) = true
       AND ce.enterprise_id = $1`,
    [enterpriseId]
  );

  if (DEBUG_ASSIGN) {
    console.log('[ASSIGN DEBUG] enterpriseId=%d startAt=%s endAt=%s weekday=%d slotTime=%s-%s',
      enterpriseId, startAt.toISOString(), endAt.toISOString(), dow, startTimeStr, endTimeStr);
    console.log('[ASSIGN DEBUG] corretores encontrados:', brokers.length, brokers.map((b) => `${b.id}:${b.full_name}`).join(', '));
  }

  const available: { id: number; last_assigned_at: Date | null }[] = [];
  for (const b of brokers) {
    const hasAvail = await brokerHasAvailabilityForSlot(b.id, startAt, endAt);
    const conflict = await hasBrokerConflict(b.id, startAt, endAt);
    const linkedToEnterprise = true; // já filtrado pela query
    const eligible = hasAvail && !conflict;

    if (DEBUG_ASSIGN) {
      const rejectReason = !linkedToEnterprise ? 'notLinked' : !b.active ? 'inactive' : !hasAvail ? 'noAvailability' : conflict ? 'hasConflict' : null;
      console.log(`[ASSIGN DEBUG] broker ${b.id} ${b.full_name}`);
      console.log(`  - active: ${b.active}`);
      console.log(`  - linkedToEnterprise: ${linkedToEnterprise}`);
      console.log(`  - weekday: ${dow}`);
      console.log(`  - hasAvailability: ${hasAvail}`);
      console.log(`  - hasConflict: ${conflict}`);
      console.log(`  - eligible: ${eligible}`);
      if (rejectReason) console.log(`  - motivo reprovação: ${rejectReason}`);
    }

    if (hasAvail && !conflict) available.push({ id: b.id, last_assigned_at: b.last_assigned_at });
  }

  if (DEBUG_ASSIGN) {
    console.log('[ASSIGN DEBUG] elegíveis:', available.length, available.map((a) => a.id).join(', ') || '(nenhum)');
  }

  if (available.length === 0) return null;

  const withCount = await Promise.all(
    available.map(async (b) => ({
      ...b,
      appointmentsCountToday: await countBrokerAppointmentsOnDate(b.id, startAt),
    }))
  );

  withCount.sort((a, b) => {
    if (a.appointmentsCountToday !== b.appointmentsCountToday) {
      return a.appointmentsCountToday - b.appointmentsCountToday;
    }
    const aLast = a.last_assigned_at ? new Date(a.last_assigned_at).getTime() : 0;
    const bLast = b.last_assigned_at ? new Date(b.last_assigned_at).getTime() : 0;
    if (aLast !== bLast) return aLast - bLast;
    return a.id - b.id;
  });

  return withCount[0].id;
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
  brokerId?: number | null;
  conversationId?: number | null;
}): Promise<AssignAppointmentResult> {
  // Se brokerId informado, usa ele; senão distribuição automática
  let brokerId: number | null;
  if (data.brokerId != null && data.brokerId > 0) {
    brokerId = data.brokerId;
  } else {
    brokerId = await findEligibleBroker(
      data.enterpriseId,
      data.startAt,
      data.endAt
    );
  }
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
    conversationId: data.conversationId ?? null,
  });
  if (brokerId) {
    await query(
      `UPDATE corretores SET last_assigned_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [brokerId]
    );
  }
  if (data.conversationId != null && brokerId != null && brokerId > 0) {
    await query(
      `UPDATE conversations
       SET assigned_broker_id = COALESCE(assigned_broker_id, $1),
           assigned_broker_at = CASE WHEN assigned_broker_id IS NULL THEN NOW() ELSE assigned_broker_at END,
           updated_at = NOW()
       WHERE id = $2`,
      [brokerId, data.conversationId]
    );
  }

  // ── Notificar o Django sobre o agendamento (fire-and-forget) ──
  notifyDjango('api/webhook/netiv-appointment/', {
    customer_name: app.customer_name,
    customer_phone: app.customer_phone,
    start_at: toIso(app.start_at),
    end_at: toIso(app.end_at),
    status: app.status,
    source: app.source,
    notes: app.notes,
  });

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

/** Atribui corretor a um agendamento PENDENTE_DISTRIBUICAO (valida disponibilidade e conflito). */
export async function assignPendingAppointment(
  appointmentId: number,
  brokerId: number
): Promise<{ appointment: AppointmentRow; broker: { id: number; fullName: string; phone: string } }> {
  const app = await getAppointmentById(appointmentId);
  if (!app) throw new Error('Agendamento não encontrado.');
  if (app.status !== 'PENDENTE_DISTRIBUICAO') throw new Error('Apenas agendamentos pendentes de distribuição podem ser atribuídos.');
  const brokers = await listCorretoresByEnterprise(app.enterprise_id);
  const broker = brokers.find((b) => b.id === brokerId);
  if (!broker) throw new Error('Corretor não vinculado a este empreendimento.');
  const hasAvail = await brokerHasAvailabilityForSlot(brokerId, app.start_at, app.end_at);
  if (!hasAvail) throw new Error('Corretor não possui disponibilidade no horário do agendamento.');
  const conflict = await hasBrokerConflict(brokerId, app.start_at, app.end_at, appointmentId);
  if (conflict) throw new Error('Corretor possui conflito de horário com outro agendamento.');
  const updated = await updateAppointmentBroker(appointmentId, brokerId, 'CONFIRMADO');
  if (!updated) throw new Error('Erro ao atualizar agendamento.');
  await query(`UPDATE corretores SET last_assigned_at = NOW(), updated_at = NOW() WHERE id = $1`, [brokerId]);
  const b = await getCorretorById(brokerId);
  return {
    appointment: updated,
    broker: b ? { id: b.id, fullName: b.full_name, phone: b.phone } : { id: brokerId, fullName: broker.full_name, phone: broker.phone },
  };
}
