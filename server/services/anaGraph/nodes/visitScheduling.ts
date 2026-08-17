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
   * Mesmo contexto que conversationEngine.ts passa pro motor legado
   * (~linha 6960-6979) — sem isso, handleVisitSchedulingDeterministically
   * fica sem saber o que a própria Ana acabou de perguntar (ex.:
   * assistantAskedVisitConfirmation checa se a última resposta foi "Posso
   * confirmar sua visita para amanhã às 9h?"), e a resposta do cliente a um
   * slot sugerido ("melhor na sexta as 14") cai num branch errado dentro do
   * handler em vez de continuar o fluxo de agendamento.
   */
  lastAssistantMessage?: string | null;
  resolvedIntent?: string | null;
  primaryAxis?: string | null;
  currentAxis?: string | null;
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
    lastAssistantMessage: params.lastAssistantMessage ?? null,
    resolvedIntent: params.resolvedIntent ?? null,
    primaryAxis: params.primaryAxis ?? null,
    currentAxis: params.currentAxis ?? null,
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
    // ver state.ts: finalizeReplyNode pula o pipeline de sanitização de
    // texto livre (feito pra RAG) pra respostas determinísticas como esta —
    // sem isso, uma resposta com 2 perguntas (ex.: sugerir data + horário)
    // era substituída por um fallback fixo de localização/corretor.
    replyIsDeterministic: true,
    visitDecision: decision,
  };
}
