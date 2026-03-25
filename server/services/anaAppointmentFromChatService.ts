import { findDuplicateAppointmentForConversation } from '../repositories/appointmentRepository.js';
import { assignAppointment } from './appointmentService.js';

function parseLocalStartEnd(dateYmd: string, timeHm: string): { startAt: Date; endAt: Date } | null {
  const d = dateYmd.trim();
  const t = timeHm.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (!/^\d{1,2}:\d{2}$/.test(t)) return null;
  const startAt = new Date(`${d}T${t}:00`);
  if (Number.isNaN(startAt.getTime())) return null;
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
  return { startAt, endAt };
}

/**
 * Registra agendamento na agenda quando a ANA confirma data/hora no JSON estruturado.
 * Ignora duplicatas próximas na mesma conversa.
 */
export async function registerAnaAppointmentIfConfirmed(args: {
  conversationId: number;
  customerName: string;
  customerPhone: string;
  enterpriseId: number;
  city: string;
  appointmentConfirmed: boolean;
  appointmentDateYmd: string | null | undefined;
  appointmentTimeHm: string | null | undefined;
  notes: string | null | undefined;
  /** Corretor já vinculado ao handoff, se houver — senão distribui automaticamente. */
  brokerId?: number | null;
}): Promise<void> {
  if (!args.appointmentConfirmed) return;
  const date = args.appointmentDateYmd?.trim();
  const time = args.appointmentTimeHm?.trim();
  if (!date || !time) return;
  const parsed = parseLocalStartEnd(date, time);
  if (!parsed) return;

  const dup = await findDuplicateAppointmentForConversation(args.conversationId, parsed.startAt);
  if (dup) {
    console.log('[ANA APPT] ignorado — possível duplicata', { conversationId: args.conversationId });
    return;
  }

  try {
    await assignAppointment({
      customerName: args.customerName || 'Cliente',
      customerPhone: args.customerPhone || '',
      enterpriseId: args.enterpriseId,
      city: args.city || '',
      startAt: parsed.startAt,
      endAt: parsed.endAt,
      notes: args.notes?.trim() || 'Agendamento confirmado no chat pela Ana.',
      source: 'ANA',
      brokerId: args.brokerId != null && args.brokerId > 0 ? args.brokerId : undefined,
      conversationId: args.conversationId,
    });
    console.log('[ANA APPT] registrado', { conversationId: args.conversationId, startAt: parsed.startAt.toISOString() });
  } catch (e) {
    console.error('[ANA APPT] falha ao registrar', e instanceof Error ? e.message : e);
  }
}
