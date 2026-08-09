import {
  sendAnaEmergencyHandoff,
  type AnaEmergencyHandoffSendResult,
} from '../../../utils/anaEmergencyHandoff.js';
import {
  assignConversationToNextBroker,
  type BrokerAssignmentResult,
} from '../../brokerAssignmentService.js';
import type { AnaGraphState } from '../state.js';

export type SendEmergencyHandoffTextFn = (
  to: string,
  text: string
) => Promise<AnaEmergencyHandoffSendResult>;
export type InsertAssistantMessageFn = (
  conversationId: number,
  text: string,
  metaMessageId: string
) => Promise<unknown>;
export type AssignBrokerFn = (args: {
  conversationId: number;
  reason: string;
}) => Promise<BrokerAssignmentResult | null>;

export interface HumanHandoffNodeParams {
  conversationId: number;
  toPhoneNumber: string;
  reason: string;
  /** Nunca chamado direto hardcoded — injetável para garantir modo sombra sem envio real. */
  sendTextMessage: SendEmergencyHandoffTextFn;
  insertAssistantMessage: InsertAssistantMessageFn;
  /**
   * Atribuição de corretor grava em produção (conversations/brokers) — sempre
   * injetável, nunca chamada direta. Default aponta para a função real
   * (assignConversationToNextBroker) apenas para uso fora do modo sombra
   * (ex.: harness com banco descartável); o modo sombra (fase 9) DEVE passar
   * um mock aqui.
   */
  assignBroker?: AssignBrokerFn;
}

/**
 * Nó de ramificação: reaproveita sendAnaEmergencyHandoff
 * (anaEmergencyHandoff.ts) e assignConversationToNextBroker
 * (brokerAssignmentService.ts) sem alteração de lógica.
 */
export async function humanHandoffNode(
  state: AnaGraphState,
  params: HumanHandoffNodeParams
): Promise<Partial<AnaGraphState>> {
  const assignBroker = params.assignBroker ?? assignConversationToNextBroker;

  const [handoffResult, brokerAssignment] = await Promise.all([
    sendAnaEmergencyHandoff({
      conversationId: params.conversationId,
      toPhoneNumber: params.toPhoneNumber,
      sendTextMessage: params.sendTextMessage,
      insertAssistantMessage: params.insertAssistantMessage,
    }),
    assignBroker({ conversationId: params.conversationId, reason: params.reason }),
  ]);

  return {
    assistantReplyText: handoffResult.replyText,
    automationBlockedByHandoff: true,
    handoffBlockedReason: params.reason,
    commercialFlowState: {
      ...state.commercialFlowState,
      dialoguePolicy: {
        ...state.commercialFlowState.dialoguePolicy,
        brokerHandoffAcceptedAt: brokerAssignment ? new Date().toISOString() : null,
      },
    },
  };
}
