import { getPool, query } from '../db/pg.js';
import {
  findDuplicateAppointmentForConversation,
  findOpenAppointmentForConversationAndEnterprise,
  updateAppointmentSchedule,
  type AppointmentRow,
} from '../repositories/appointmentRepository.js';
import { getConversationById, scheduleDeferredHandoffAfterAppointment } from '../repositories/conversationRepository.js';
import { findContactById } from '../repositories/contactsRepository.js';
import { assignAppointment, checkAvailability } from './appointmentService.js';
import {
  APPOINTMENT_BUSINESS_TZ,
  formatAppointmentCanonicalPtBr,
  parseAppointmentStartEndInSaoPaulo,
} from '../utils/appointmentDateNormalize.js';
import { resolveAppointmentDateTimeFromContext } from '../utils/appointmentRelativeDateResolve.js';
import { hasHumanResolvedName, resolveOperationalCustomerNameParts } from '../utils/customerNameResolver.js';

async function persistBrokerOnConversationIfUnset(conversationId: number, brokerId: number | null | undefined): Promise<void> {
  if (brokerId == null || brokerId <= 0) return;
  await query(
    `UPDATE conversations
     SET assigned_broker_id = COALESCE(assigned_broker_id, $1),
         assigned_broker_at = CASE WHEN assigned_broker_id IS NULL THEN NOW() ELSE assigned_broker_at END,
         updated_at = NOW()
     WHERE id = $2`,
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

function isSameAppointmentSlot(appointment: AppointmentRow, startAt: Date, endAt: Date): boolean {
  return (
    Math.abs(new Date(appointment.start_at).getTime() - startAt.getTime()) < 1000 &&
    Math.abs(new Date(appointment.end_at).getTime() - endAt.getTime()) < 1000
  );
}

function appointmentResultFromExisting(
  appointment: AppointmentRow,
  canonicalLine: string,
  appointmentDateTimeText: string
): RegisterAnaAppointmentResult {
  return {
    persisted: true,
    canonicalLine,
    appointmentId: appointment.id,
    brokerId: appointment.broker_id ?? null,
    appointmentDateTimeText,
  };
}

async function withAnaAppointmentSlotLock<T>(
  startAt: Date,
  endAt: Date,
  run: () => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  const lockScope = 'ana_appointment_slot';
  const lockKey = `${startAt.toISOString()}|${endAt.toISOString()}`;
  let locked = false;
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1), hashtext($2))', [lockScope, lockKey]);
    locked = true;
    return await run();
  } finally {
    if (locked) {
      await client
        .query('SELECT pg_advisory_unlock(hashtext($1), hashtext($2))', [lockScope, lockKey])
        .catch((error) => {
          console.error('[ANA APPT] falha ao liberar advisory lock', error instanceof Error ? error.message : error);
        });
    }
    client.release();
  }
}

export interface RegisterAnaAppointmentResult {
  persisted: boolean;
  /** Linha alinhada ao horario salvo no banco (America/Sao_Paulo). */
  canonicalLine?: string;
  appointmentId?: number;
  brokerId?: number | null;
  appointmentDateTimeText?: string;
}

function formatBrokerVisitTimeLabel(hour: string, minute: string): string {
  const h = Number.parseInt(hour, 10);
  const mm = String(minute ?? '').padStart(2, '0').slice(0, 2);
  if (!Number.isFinite(h)) return `${hour}:${mm}`;
  return mm === '00' ? `${h}h` : `${h}h${mm}`;
}

function weekdayForBrokerTemplate(startAt: Date): string {
  const weekday = new Intl.DateTimeFormat('pt-BR', {
    timeZone: APPOINTMENT_BUSINESS_TZ,
    weekday: 'long',
  }).format(startAt);
  return weekday.replace(/-feira$/i, '').toLowerCase();
}

export function formatAppointmentDateTimeForBrokerNotification(
  startAt: Date | null | undefined,
  fallbackDateYmd?: string | null,
  fallbackTimeHm?: string | null
): string {
  if (startAt instanceof Date && !Number.isNaN(startAt.getTime())) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: APPOINTMENT_BUSINESS_TZ,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(startAt);
    const hour = parts.find((part) => part.type === 'hour')?.value ?? '00';
    const minute = parts.find((part) => part.type === 'minute')?.value ?? '00';
    return `${weekdayForBrokerTemplate(startAt)} às ${formatBrokerVisitTimeLabel(hour, minute)}`;
  }

  const date = String(fallbackDateYmd ?? '').trim();
  const time = String(fallbackTimeHm ?? '').trim();
  if (date && /^\d{1,2}:\d{2}$/.test(time)) {
    const [hour, minute] = time.split(':');
    return `${date} às ${formatBrokerVisitTimeLabel(hour, minute)}`;
  }
  if (date) return date;
  if (time) return time;
  return 'data/hora da visita';
}

/**
 * Registra ou atualiza agendamento quando a ANA confirma data/hora no JSON estruturado.
 * - Data/hora: `resolveAppointmentDateTimeFromContext` (texto do cliente + fallback JSON) em America/Sao_Paulo.
 * - Reagendamento: atualiza o registro aberto da mesma conversa + empreendimento.
 * - Novo: cria compromisso apenas depois de revalidar corretor disponivel.
 * - A secao critica usa advisory lock por slot para reduzir corrida entre check e insert.
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
  /** Corretor ja vinculado a conversa: prioridade na distribuicao do agendamento. */
  brokerId?: number | null;
  /** Falas do usuario (inclui atual) para resolver "amanha", "quinta as 15h", etc. */
  userUtteranceText?: string;
  /** Instante da mensagem do usuario (America/Sao_Paulo aplicado na resolucao de data relativa). */
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
    console.warn('[ANA APPT] nao foi possivel resolver data/hora (contexto + JSON)', {
      conversationId: args.conversationId,
    });
    return { persisted: false };
  }

  const parsed = parseAppointmentStartEndInSaoPaulo(resolved.dateYmd, resolved.timeHm);
  if (!parsed) return { persisted: false };

  const canonicalLine = `Registrado no sistema: ${formatAppointmentCanonicalPtBr(parsed.startAt)}.`;
  const appointmentDateTimeText = formatAppointmentDateTimeForBrokerNotification(
    parsed.startAt,
    resolved.dateYmd,
    resolved.timeHm
  );

  try {
    return await withAnaAppointmentSlotLock(parsed.startAt, parsed.endAt, async () => {
      const conversationBroker =
        args.brokerId != null && args.brokerId > 0 ? args.brokerId : null;
      const existing = await findOpenAppointmentForConversationAndEnterprise(args.conversationId, args.enterpriseId);

      if (existing && isSameAppointmentSlot(existing, parsed.startAt, parsed.endAt)) {
        console.log('[ANA APPT] idempotente: appointment existente no mesmo slot', {
          conversationId: args.conversationId,
          appointmentId: existing.id,
          startAt: parsed.startAt.toISOString(),
        });
        await scheduleDeferredHandoffAfterAppointment(args.conversationId, existing.broker_id ?? conversationBroker);
        return appointmentResultFromExisting(existing, canonicalLine, appointmentDateTimeText);
      }

      if (!existing) {
        const dup = await findDuplicateAppointmentForConversation(args.conversationId, parsed.startAt);
        if (dup) {
          console.log('[ANA APPT] idempotente: duplicata proxima no tempo', {
            conversationId: args.conversationId,
            dupId: dup.id,
          });
          await scheduleDeferredHandoffAfterAppointment(args.conversationId, dup.broker_id ?? conversationBroker);
          return appointmentResultFromExisting(dup, canonicalLine, appointmentDateTimeText);
        }
      }

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

      const slotAvailability = await checkAvailability(args.enterpriseId, parsed.startAt, parsed.endAt, {
        preferredBrokerId: existing?.broker_id ?? conversationBroker,
        excludeAppointmentId: existing?.id ?? null,
      });
      if (!slotAvailability.available || slotAvailability.suggestedBrokerId == null) {
        console.warn('[ANA APPT] slot indisponivel na revalidacao', {
          conversationId: args.conversationId,
          enterpriseId: args.enterpriseId,
          startAt: parsed.startAt.toISOString(),
          eligibleBrokerCount: slotAvailability.eligibleBrokerCount,
          excludeAppointmentId: existing?.id ?? null,
        });
        return { persisted: false, appointmentDateTimeText };
      }
      const availableBrokerId = slotAvailability.suggestedBrokerId;

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
          if (updated.broker_id !== availableBrokerId) {
            await query(
              `UPDATE appointments SET broker_id = $1, status = 'CONFIRMADO', updated_at = NOW() WHERE id = $2`,
              [availableBrokerId, updated.id]
            );
          }
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
          await persistBrokerOnConversationIfUnset(args.conversationId, availableBrokerId);
          await scheduleDeferredHandoffAfterAppointment(args.conversationId, availableBrokerId);
          return {
            persisted: true,
            canonicalLine,
            appointmentId: updated.id,
            brokerId: availableBrokerId,
            appointmentDateTimeText,
          };
        }
        return { persisted: false };
      }

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
        brokerId: availableBrokerId,
        conversationId: args.conversationId,
      });
      console.log('[ANA APPT] registrado (INSERT)', {
        conversationId: args.conversationId,
        startAt: parsed.startAt.toISOString(),
        brokerId: result.appointment.brokerId,
      });
      const finalBroker = availableBrokerId ?? result.appointment.brokerId ?? conversationBroker ?? null;
      await scheduleDeferredHandoffAfterAppointment(args.conversationId, finalBroker);
      return {
        persisted: true,
        canonicalLine,
        appointmentId: result.appointment.id,
        brokerId: finalBroker,
        appointmentDateTimeText,
      };
    });
  } catch (error) {
    console.error('[ANA APPT] falha ao registrar', error instanceof Error ? error.message : error);
    return { persisted: false };
  }
}
