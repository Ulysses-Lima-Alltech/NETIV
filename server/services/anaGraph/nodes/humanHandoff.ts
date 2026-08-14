import {
  sendAnaEmergencyHandoff,
  type AnaEmergencyHandoffSendResult,
} from '../../../utils/anaEmergencyHandoff.js';
import {
  assignConversationToNextBroker,
  type BrokerAssignmentResult,
} from '../../brokerAssignmentService.js';
import { updateClassification } from '../../../repositories/conversationRepository.js';
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
export type UpdateHandoffClassificationFn = (conversationId: number) => Promise<unknown>;

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
   *
   * IMPORTANTE: assignConversationToNextBroker só notifica/atribui corretor
   * quando `reason` está na whitelist ALLOWED_ASSIGNMENT_REASONS
   * (brokerAssignmentService.ts) — guard deliberado contra reengajamento
   * automático. Rotas de handoff por "sem resposta segura" (evidência
   * insuficiente) normalmente não estão nessa whitelist, então esta função
   * pode não notificar corretor nenhum. Por isso a mudança de status pra
   * Handoff (updateClassification abaixo) é SEMPRE feita separadamente,
   * nunca dependendo do resultado desta atribuição.
   */
  assignBroker?: AssignBrokerFn;
  /**
   * Muda conversations.classification/handoff pra 'Handoff' de verdade —
   * sempre injetável, default aponta para updateClassification
   * (conversationRepository.ts), a mesma função que o motor legado usa.
   * Chamada incondicionalmente: nenhum caminho de handoff pode terminar sem
   * essa mudança de status real (requisito de negócio: handoff é o único
   * estado em que é aceitável o cliente ficar sem resposta imediata da Ana).
   */
  updateHandoffClassification?: UpdateHandoffClassificationFn;
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
  const updateHandoffClassification =
    params.updateHandoffClassification ??
    ((conversationId: number) => updateClassification(conversationId, { classification: 'Handoff', handoff: true }));

  const [handoffResult, brokerAssignment] = await Promise.all([
    sendAnaEmergencyHandoff({
      conversationId: params.conversationId,
      toPhoneNumber: params.toPhoneNumber,
      sendTextMessage: params.sendTextMessage,
      insertAssistantMessage: params.insertAssistantMessage,
    }),
    assignBroker({ conversationId: params.conversationId, reason: params.reason }),
  ]);

  // Sempre incondicional: assignBroker pode ter feito no-op (reason fora da
  // whitelist de ALLOWED_ASSIGNMENT_REASONS), mas o status da conversa tem
  // que virar Handoff de verdade de qualquer forma.
  await updateHandoffClassification(params.conversationId);

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
