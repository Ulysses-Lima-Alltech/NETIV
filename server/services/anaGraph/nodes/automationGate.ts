import { getConversationById } from '../../../repositories/conversationRepository.js';
import {
  isAnaAutomationBlockedByHandoff,
  logAnaAutomationBlockedByHandoff,
} from '../../../utils/anaHandoffPolicy.js';
import type { AnaGraphState } from '../state.js';

/**
 * Nó de entrada do grafo: replica o gate de handoff hoje aplicado em
 * webhookProcessor.ts (shouldBlockAnaWebhookAutomation) antes de qualquer
 * classificador/IA rodar. Não decide o roteamento — apenas marca o estado;
 * a edge condicional decide se o grafo segue ou encerra o turno.
 */
export async function automationGateNode(state: AnaGraphState): Promise<Partial<AnaGraphState>> {
  const conversation = await getConversationById(state.conversationId);
  const blocked = isAnaAutomationBlockedByHandoff(conversation);
  if (blocked && conversation) {
    logAnaAutomationBlockedByHandoff(conversation, {
      conversationId: state.conversationId,
      automationType: 'inbound_message',
      blockedAt: 'inbound_entry',
      source: 'ana_graph',
      messageId: state.metaMessageId,
    });
  }
  return {
    automationBlockedByHandoff: blocked,
    handoffBlockedReason: blocked ? 'HANDOFF_BLOCKS_ANA_AUTOMATION' : null,
  };
}
