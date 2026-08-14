import {
  handleVisitSchedulingDeterministically,
  type DirectVisitSchedulingDecision,
  type DirectVisitSchedulingInput,
} from '../../../utils/anaDirectVisitScheduling.js';
import { parseAppointmentStartEndInSaoPaulo } from '../../../utils/appointmentDateNormalize.js';
import { assignAppointment, type AssignAppointmentResult } from '../../appointmentService.js';
import { computeVisitAvailabilityContext } from './visitAvailabilityContext.js';
import type { AnaVisitSlotAvailabilityChecker } from '../../anaVisitAvailabilityService.js';
import type { AnaGraphState } from '../state.js';

export type PersistAppointmentFn = (
  data: Parameters<typeof assignAppointment>[0]
) => Promise<AssignAppointmentResult>;

export interface VisitSchedulingNodeParams {
  conversationId: number;
  enterpriseId: number | null;
  enterpriseCity: string;
  customerName?: string | null;
  customerPhone?: string | null;
  referenceNow?: Date;
  /**
   * Persistência do agendamento é sempre injetável — nunca chame
   * assignAppointment diretamente a partir do grafo novo fora do ponto único
   * controlado por flag (fase 9). Em modo sombra, o chamador DEVE passar um
   * mock aqui; o default só existe para permitir uso fora do modo sombra
   * (ex.: harness com banco descartável), nunca em produção sem flag.
   */
  persistAppointment?: PersistAppointmentFn;
  /** Só para testes — produção sempre usa a checagem real (checkAvailability via DB). */
  checkSlotAvailability?: AnaVisitSlotAvailabilityChecker;
}

/**
 * Nó de ramificação: reaproveita handleVisitSchedulingDeterministically
 * (anaDirectVisitScheduling.ts), que já contém a máquina de estados completa
 * (collecting_date/collecting_time/collecting_name/ready_to_confirm) via
 * CommercialFlowState.visitScheduling.status — não há necessidade de
 * reimplementar essas transições como nós LangGraph separados.
 */
export async function visitSchedulingNode(
  state: AnaGraphState,
  params: VisitSchedulingNodeParams
): Promise<Partial<AnaGraphState> & { visitDecision: DirectVisitSchedulingDecision }> {
  const referenceNow = params.referenceNow ?? new Date();
  const availabilityContext =
    params.enterpriseId != null
      ? await computeVisitAvailabilityContext({
          userMessage: state.userMessage,
          flowState: state.commercialFlowState,
          enterpriseId: params.enterpriseId,
          referenceNow,
          checkSlotAvailability: params.checkSlotAvailability,
        })
      : null;

  const input: DirectVisitSchedulingInput = {
    userMessage: state.userMessage,
    flowState: state.commercialFlowState,
    enterpriseId: params.enterpriseId,
    customerName: params.customerName ?? null,
    customerPhone: params.customerPhone ?? null,
    referenceNow: params.referenceNow,
    ...(availabilityContext ?? {}),
  };

  const decision = handleVisitSchedulingDeterministically(input);

  if (
    decision.appointmentConfirmed &&
    decision.appointmentDateYmd &&
    decision.appointmentTimeHm &&
    params.customerName &&
    params.customerPhone
  ) {
    const parsed = parseAppointmentStartEndInSaoPaulo(decision.appointmentDateYmd, decision.appointmentTimeHm);
    if (parsed && params.enterpriseId != null) {
      const persist = params.persistAppointment ?? assignAppointment;
      await persist({
        customerName: params.customerName,
        customerPhone: params.customerPhone,
        enterpriseId: params.enterpriseId,
        city: params.enterpriseCity,
        startAt: parsed.startAt,
        endAt: parsed.endAt,
        brokerId: decision.appointmentBrokerId ?? null,
        conversationId: params.conversationId,
        source: 'ANA_GRAPH',
      });
    }
  }

  return {
    commercialFlowState: decision.nextState,
    assistantReplyText: decision.reply,
    visitDecision: decision,
  };
}
