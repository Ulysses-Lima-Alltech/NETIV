import { query } from '../db/pg.js';
import {
  findDuplicateAppointmentForConversation,
  findOpenAppointmentForConversationAndEnterprise,
  updateAppointmentSchedule,
} from '../repositories/appointmentRepository.js';
import { getConversationById, scheduleDeferredHandoffAfterAppointment } from '../repositories/conversationRepository.js';
import { findContactById } from '../repositories/contactsRepository.js';
import { assignAppointment } from './appointmentService.js';
import { formatAppointmentCanonicalPtBr, parseAppointmentStartEndInSaoPaulo } from '../utils/appointmentDateNormalize.js';
import { resolveAppointmentDateTimeFromContext } from '../utils/appointmentRelativeDateResolve.js';
import { hasHumanResolvedName, resolveOperationalCustomerNameParts } from '../utils/customerNameResolver.js';

async function persistBrokerOnConversationIfUnset(conversationId: number, brokerId: number | null | undefined): Promise<void> {
  if (brokerId == null || brokerId <= 0) return;
  await query(
    `UPDATE conversations SET assigned_broker_id = COALESCE(assigned_broker_id, $1), updated_at = NOW() WHERE id = $2`,
    [brokerId, conversationId]
  );
}

function appendCustomerNameToAppointmentNotes(
  baseNotes: string,
  resolvedName: string,
  source: ReturnType<typeof resolveOperationalCustomerNameParts>['source']
): string {
  const cleanBase = (baseNotes || '').trim();
  if (!hasHumanResolvedName(source)) return cleanBase;
  const prefix = `Cliente: ${resolvedName}.`;
  if (!cleanBase) return prefix;
  if (cleanBase.toLowerCase().includes(`cliente: ${resolvedName.toLowerCase()}`)) return cleanBase;
  return `${prefix} ${cleanBase}`.slice(0, 4000);
}

export interface RegisterAnaAppointmentResult {
  persisted: boolean;
  /** Linha alinhada ao horário salvo no banco (America/Sao_Paulo). */
  canonicalLine?: string;
}

/**
 * Registra ou atualiza agendamento quando a ANA confirma data/hora no JSON estruturado.
 * - Data/hora: `resolveAppointmentDateTimeFromContext` (texto do cliente + fallback JSON) em America/Sao_Paulo.
 * - Reagendamento: atualiza o registro aberto da mesma conversa + empreendimento (mesmo corretor).
 * - Novo: cria um compromisso; corretor = já atribuído à conversa ou distribuição automática.
 * - Após sucesso: handoff agendado para ~5 min (mesmo corretor), permitindo reagendar sem ir ao humano na hora.
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
  /** Corretor já vinculado à conversa — prioridade na distribuição do agendamento. */
  brokerId?: number | null;
  /** Falas do usuário (inclui atual) para resolver "amanhã", "quinta às 15h", etc. */
  userUtteranceText?: string;
  /** Instante da mensagem do usuário (America/Sao_Paulo aplicado na resolução de data relativa). */
  referenceNow?: Date;
}): Promise<RegisterAnaAppointmentResult> {
  if (!args.appointmentConfirmed) return { persisted: false };

  const ref = args.referenceNow instanceof Date && !Number.isNaN(args.referenceNow.getTime()) ? args.referenceNow : new Date();

  const resolved = resolveAppointmentDateTimeFromContext({
    referenceNow: ref,
    userText: (args.userUtteranceText ?? '').trim(),
    llmDateYmd: args.appointmentDateYmd,
    llmTimeHm: args.appointmentTimeHm,
  });
  if (!resolved) {
    console.warn('[ANA APPT] não foi possível resolver data/hora (contexto + JSON)', {
      conversationId: args.conversationId,
    });
    return { persisted: false };
  }

  const parsed = parseAppointmentStartEndInSaoPaulo(resolved.dateYmd, resolved.timeHm);
  if (!parsed) return { persisted: false };

  const canonicalLine = `Registrado no sistema: ${formatAppointmentCanonicalPtBr(parsed.startAt)}.`;
  const conv = await getConversationById(args.conversationId);
  const contact = conv?.contact_id != null ? await findContactById(conv.contact_id) : null;
  const resolvedCustomerName = resolveOperationalCustomerNameParts({
    conversationCustomerName: conv?.customer_name ?? args.customerName ?? null,
    whatsappDisplayName: conv?.whatsapp_display_name ?? null,
    contactFullName: contact?.full_name ?? null,
    contactFirstName: contact?.first_name ?? null,
    phone: (args.customerPhone || conv?.contact_phone || conv?.external_contact_id || '').trim(),
    fallbackLabel: 'Cliente',
  });

  const conversationBroker =
    args.brokerId != null && args.brokerId > 0 ? args.brokerId : null;

  const existing = await findOpenAppointmentForConversationAndEnterprise(args.conversationId, args.enterpriseId);

  if (existing) {
    const notes = appendCustomerNameToAppointmentNotes(
      args.notes?.trim() || existing.notes || 'Agendamento atualizado pelo chat pela Ana.',
      resolvedCustomerName.value,
      resolvedCustomerName.source
    );
    const updated = await updateAppointmentSchedule(existing.id, {
      startAt: parsed.startAt,
      endAt: parsed.endAt,
      notes,
    });
    if (updated) {
      const currentName = (updated.customer_name || '').trim().toLowerCase();
      if (!currentName || currentName === 'cliente') {
        await query(
          `UPDATE appointments SET customer_name = $1, updated_at = NOW() WHERE id = $2`,
          [resolvedCustomerName.value, updated.id]
        );
      }
      console.log('[ANA APPT] reagendamento (UPDATE)', {
        conversationId: args.conversationId,
        appointmentId: existing.id,
        startAt: parsed.startAt.toISOString(),
      });
      await persistBrokerOnConversationIfUnset(args.conversationId, existing.broker_id);
      await persistBrokerOnConversationIfUnset(args.conversationId, conversationBroker);
      const finalBroker = conversationBroker ?? existing.broker_id ?? null;
      await scheduleDeferredHandoffAfterAppointment(args.conversationId, finalBroker);
      return { persisted: true, canonicalLine };
    }
    return { persisted: false };
  }

  const dup = await findDuplicateAppointmentForConversation(args.conversationId, parsed.startAt);
  if (dup) {
    console.log('[ANA APPT] ignorado — duplicata próxima no tempo', {
      conversationId: args.conversationId,
      dupId: dup.id,
    });
    return { persisted: false };
  }

  try {
    const result = await assignAppointment({
      customerName: resolvedCustomerName.value,
      customerPhone: args.customerPhone || '',
      enterpriseId: args.enterpriseId,
      city: args.city || '',
      startAt: parsed.startAt,
      endAt: parsed.endAt,
      notes: appendCustomerNameToAppointmentNotes(
        args.notes?.trim() || 'Agendamento confirmado no chat pela Ana.',
        resolvedCustomerName.value,
        resolvedCustomerName.source
      ),
      source: 'ANA',
      brokerId: conversationBroker ?? undefined,
      conversationId: args.conversationId,
    });
    console.log('[ANA APPT] registrado (INSERT)', {
      conversationId: args.conversationId,
      startAt: parsed.startAt.toISOString(),
      brokerId: result.appointment.brokerId,
    });
    const finalBroker = conversationBroker ?? result.appointment.brokerId ?? null;
    await scheduleDeferredHandoffAfterAppointment(args.conversationId, finalBroker);
    return { persisted: true, canonicalLine };
  } catch (e) {
    console.error('[ANA APPT] falha ao registrar', e instanceof Error ? e.message : e);
    return { persisted: false };
  }
}
