import {
  extractAnaVisitSlotPreferenceFromText,
  findNextAvailableVisitSlot,
  formatAnaVisitSlotLabel,
  validateVisitSlotStillAvailable,
  type AnaVisitAvailabilitySlot,
  type AnaVisitSlotAvailabilityChecker,
  type AnaVisitSlotAvailabilityResult,
} from '../../anaVisitAvailabilityService.js';
import { APPOINTMENT_BUSINESS_TZ, parseAppointmentStartEndInSaoPaulo } from '../../../utils/appointmentDateNormalize.js';
import {
  isExplicitVisitSchedulingNegativeMessage,
  isVisitSchedulingAckOnlyMessage,
  isVisitSchedulingConfirmationMessage,
} from '../../../utils/anaDirectVisitScheduling.js';
import type { CommercialFlowState } from '../../../utils/commercialFlowState.js';

export interface VisitAvailabilityContext {
  availabilitySuggestion: AnaVisitAvailabilitySlot | null;
  availabilitySearchCompleted: boolean;
  suggestedSlotValidation: AnaVisitSlotAvailabilityResult | null;
  suggestedSlotReplacement: AnaVisitAvailabilitySlot | null;
  suggestedSlotUnavailable: boolean;
  exactSlotAvailability: AnaVisitSlotAvailabilityResult | null;
  exactSlotUnavailableReplacement: AnaVisitAvailabilitySlot | null;
  exactSlotUnavailable: boolean;
}

const EMPTY_CONTEXT: VisitAvailabilityContext = {
  availabilitySuggestion: null,
  availabilitySearchCompleted: false,
  suggestedSlotValidation: null,
  suggestedSlotReplacement: null,
  suggestedSlotUnavailable: false,
  exactSlotAvailability: null,
  exactSlotUnavailableReplacement: null,
  exactSlotUnavailable: false,
};

/**
 * Porta simplificada da orquestração de disponibilidade real que
 * conversationEngine.ts faz antes de handleVisitSchedulingDeterministically
 * (linhas ~6723-6935): valida o slot sugerido pendente, ou o slot exato
 * informado pelo cliente, ou busca o próximo horário disponível — sempre via
 * validateVisitSlotStillAvailable/findNextAvailableVisitSlot (que checam
 * agenda real dos corretores), nunca aceitando data/hora do cliente sem
 * checagem.
 *
 * Gaps conhecidos vs. o motor legado (fidelidade parcial, documentados aqui
 * em vez de reescritos às cegas): não replica busca de slot alternativo após
 * recusa explícita (`alternativeSlotSearchAccepted`), nem a preferência por
 * "semana que vem" ao repetir um dia da semana, nem o caso de troca de dia
 * mantendo o mesmo horário (`suggestedSlotAlternativeDayRequested`). Esses
 * casos caem no branch geral de busca do próximo horário disponível, que
 * ainda é seguro (nunca agenda sem checar disponibilidade real), só não é
 * byte-a-byte idêntico ao texto do motor legado nesses casos de borda.
 */
export async function computeVisitAvailabilityContext(params: {
  userMessage: string;
  flowState: CommercialFlowState;
  enterpriseId: number;
  referenceNow: Date;
  /** Só para testes — produção sempre usa a checagem real (checkAvailability via DB). */
  checkSlotAvailability?: AnaVisitSlotAvailabilityChecker;
}): Promise<VisitAvailabilityContext> {
  const { flowState, userMessage, enterpriseId, referenceNow, checkSlotAvailability } = params;

  if (isExplicitVisitSchedulingNegativeMessage(userMessage)) {
    return EMPTY_CONTEXT;
  }

  const preferenceFromMessage = extractAnaVisitSlotPreferenceFromText(userMessage, referenceNow);

  const pendingSuggestedStartAt = flowState.suggestedVisitStartAt ? new Date(flowState.suggestedVisitStartAt) : null;
  const pendingSuggestedEndAt = flowState.suggestedVisitEndAt ? new Date(flowState.suggestedVisitEndAt) : null;
  const hasValidPendingSuggestedDates =
    pendingSuggestedStartAt instanceof Date &&
    !Number.isNaN(pendingSuggestedStartAt.getTime()) &&
    pendingSuggestedEndAt instanceof Date &&
    !Number.isNaN(pendingSuggestedEndAt.getTime());
  const awaitingSuggestedVisitSlot =
    flowState.pendingVisitScheduling === true &&
    flowState.suggestedVisitStatus === 'awaiting_confirmation' &&
    hasValidPendingSuggestedDates &&
    Boolean((flowState.suggestedVisitSlotLabel ?? '').trim());
  const suggestedSlotAccepted =
    awaitingSuggestedVisitSlot &&
    (isVisitSchedulingConfirmationMessage(userMessage) || isVisitSchedulingAckOnlyMessage(userMessage));

  if (suggestedSlotAccepted && pendingSuggestedStartAt && pendingSuggestedEndAt) {
    const suggestedSlotValidation = await validateVisitSlotStillAvailable({
      enterpriseId,
      startAt: pendingSuggestedStartAt,
      endAt: pendingSuggestedEndAt,
      preferredBrokerId: flowState.suggestedVisitBrokerId ?? null,
      checkSlotAvailability,
    });
    const suggestedSlotUnavailable = !suggestedSlotValidation.available;
    let suggestedSlotReplacement: AnaVisitAvailabilitySlot | null = null;
    let availabilitySearchCompleted = false;
    if (suggestedSlotUnavailable) {
      suggestedSlotReplacement = await findNextAvailableVisitSlot({
        enterpriseId,
        referenceNow,
        preference: null,
        checkSlotAvailability,
      });
      availabilitySearchCompleted = true;
    }
    return {
      ...EMPTY_CONTEXT,
      suggestedSlotValidation,
      suggestedSlotReplacement,
      suggestedSlotUnavailable,
      availabilitySearchCompleted,
    };
  }

  const exactDateYmd =
    preferenceFromMessage.dateYmd ??
    (flowState.pendingVisitScheduling === true
      ? flowState.pendingVisitDate ?? flowState.visitScheduling?.normalizedDate ?? null
      : null);
  const exactTimeHm =
    preferenceFromMessage.timeHm ??
    (flowState.pendingVisitScheduling === true
      ? flowState.pendingVisitTime ?? flowState.visitScheduling?.normalizedTime ?? null
      : null);
  const hasExactSlotCandidate = Boolean(exactDateYmd && exactTimeHm);
  const shouldValidateExactSlot =
    hasExactSlotCandidate &&
    !awaitingSuggestedVisitSlot &&
    (Boolean(preferenceFromMessage.dateYmd && preferenceFromMessage.timeHm) ||
      flowState.pendingVisitConfirmationAsked === true ||
      flowState.pendingVisitScheduling === true);

  if (shouldValidateExactSlot && exactDateYmd && exactTimeHm) {
    const parsedExact = parseAppointmentStartEndInSaoPaulo(exactDateYmd, exactTimeHm);
    if (!parsedExact) {
      return { ...EMPTY_CONTEXT, exactSlotUnavailable: true, availabilitySearchCompleted: true };
    }
    const exactSlotAvailability = await validateVisitSlotStillAvailable({
      enterpriseId,
      startAt: parsedExact.startAt,
      endAt: parsedExact.endAt,
      preferredBrokerId: flowState.suggestedVisitBrokerId ?? null,
      checkSlotAvailability,
    });
    const exactSlotUnavailable = !exactSlotAvailability.available;
    if (!exactSlotUnavailable && exactSlotAvailability.brokerId != null) {
      const availabilitySuggestion: AnaVisitAvailabilitySlot = {
        enterpriseId,
        startAt: parsedExact.startAt,
        endAt: parsedExact.endAt,
        startYmd: exactDateYmd,
        timeHm: exactTimeHm,
        brokerId: exactSlotAvailability.brokerId,
        eligibleBrokerCount: exactSlotAvailability.eligibleBrokerCount,
        timezone: APPOINTMENT_BUSINESS_TZ,
        label: formatAnaVisitSlotLabel({ startYmd: exactDateYmd, timeHm: exactTimeHm }, referenceNow),
      };
      return {
        ...EMPTY_CONTEXT,
        availabilitySuggestion,
        exactSlotAvailability,
        exactSlotUnavailable,
        availabilitySearchCompleted: true,
      };
    }
    const exactSlotUnavailableReplacement = await findNextAvailableVisitSlot({
      enterpriseId,
      referenceNow,
      minimumStartAt: parsedExact.startAt,
      excludeStartAt: parsedExact.startAt,
      preference: {
        dateYmd: exactDateYmd,
        period: preferenceFromMessage.period ?? null,
        weekday: preferenceFromMessage.weekday ?? null,
        timeHm: null,
      },
      checkSlotAvailability,
    });
    return {
      ...EMPTY_CONTEXT,
      exactSlotAvailability,
      exactSlotUnavailable,
      exactSlotUnavailableReplacement,
      availabilitySearchCompleted: true,
    };
  }

  const shouldFindSuggestedSlot =
    !awaitingSuggestedVisitSlot ||
    Boolean(preferenceFromMessage.dateYmd || preferenceFromMessage.period || preferenceFromMessage.weekday);

  if (shouldFindSuggestedSlot) {
    const availabilitySuggestion = await findNextAvailableVisitSlot({
      enterpriseId,
      referenceNow,
      preference: {
        dateYmd: preferenceFromMessage.dateYmd ?? flowState.pendingVisitDate ?? null,
        weekday: preferenceFromMessage.weekday ?? null,
        period: preferenceFromMessage.period ?? null,
        timeHm: null,
      },
      checkSlotAvailability,
    });
    return { ...EMPTY_CONTEXT, availabilitySuggestion, availabilitySearchCompleted: true };
  }

  return EMPTY_CONTEXT;
}
