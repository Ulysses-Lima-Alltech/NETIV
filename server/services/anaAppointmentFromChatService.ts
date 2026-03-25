import { query } from '../db/pg.js';
import {
  findDuplicateAppointmentForConversation,
  findOpenAppointmentForConversationAndEnterprise,
  updateAppointmentSchedule,
} from '../repositories/appointmentRepository.js';
import { assignAppointment } from './appointmentService.js';
import { normalizeAnaAppointmentDateYmd, parseAppointmentStartEndInSaoPaulo } from '../utils/appointmentDateNormalize.js';

async function persistBrokerOnConversationIfUnset(conversationId: number, brokerId: number | null | undefined): Promise<void> {
  if (brokerId == null || brokerId <= 0) return;
  await query(
    `UPDATE conversations SET assigned_broker_id = COALESCE(assigned_broker_id, $1), updated_at = NOW() WHERE id = $2`,
    [brokerId, conversationId]
  );
}

/**
 * Registra ou atualiza agendamento quando a ANA confirma data/hora no JSON estruturado.
 * - Reagendamento: atualiza o registro aberto da mesma conversa + empreendimento (mesmo corretor).
 * - Novo: cria um compromisso; corretor = já atribuído à conversa ou distribuição automática.
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
  /** Corretor já vinculado à conversa/handoff — tem prioridade sobre distribuição automática. */
  brokerId?: number | null;
}): Promise<void> {
  if (!args.appointmentConfirmed) return;
  const dateRaw = args.appointmentDateYmd?.trim();
  const time = args.appointmentTimeHm?.trim();
  if (!dateRaw || !time) return;

  const dateNorm = normalizeAnaAppointmentDateYmd(dateRaw);
  if (!dateNorm) return;

  const parsed = parseAppointmentStartEndInSaoPaulo(dateNorm, time);
  if (!parsed) return;

  const conversationBroker =
    args.brokerId != null && args.brokerId > 0 ? args.brokerId : null;

  const existing = await findOpenAppointmentForConversationAndEnterprise(args.conversationId, args.enterpriseId);

  if (existing) {
    const notes =
      args.notes?.trim() ||
      existing.notes ||
      'Agendamento atualizado pelo chat pela Ana.';
    const updated = await updateAppointmentSchedule(existing.id, {
      startAt: parsed.startAt,
      endAt: parsed.endAt,
      notes,
    });
    if (updated) {
      console.log('[ANA APPT] reagendamento (UPDATE)', {
        conversationId: args.conversationId,
        appointmentId: existing.id,
        startAt: parsed.startAt.toISOString(),
      });
      await persistBrokerOnConversationIfUnset(args.conversationId, existing.broker_id);
      await persistBrokerOnConversationIfUnset(args.conversationId, conversationBroker);
    }
    return;
  }

  const dup = await findDuplicateAppointmentForConversation(args.conversationId, parsed.startAt);
  if (dup) {
    console.log('[ANA APPT] ignorado — duplicata próxima no tempo', {
      conversationId: args.conversationId,
      dupId: dup.id,
    });
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
      brokerId: conversationBroker ?? undefined,
      conversationId: args.conversationId,
    });
    console.log('[ANA APPT] registrado (INSERT)', {
      conversationId: args.conversationId,
      startAt: parsed.startAt.toISOString(),
    });
  } catch (e) {
    console.error('[ANA APPT] falha ao registrar', e instanceof Error ? e.message : e);
  }
}
