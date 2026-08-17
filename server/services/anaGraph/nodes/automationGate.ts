import { getConversationById } from '../../../repositories/conversationRepository.js';
import {
  isAnaAutomationBlockedByHandoff,
  logAnaAutomationBlockedByHandoff,
} from '../../../utils/anaHandoffPolicy.js';
import { parseCommercialFlowState, isEmptyCommercialFlowState } from '../../../utils/commercialFlowState.js';
import type { AnaGraphState } from '../state.js';

/**
 * Nó de entrada do grafo: replica o gate de handoff hoje aplicado em
 * webhookProcessor.ts (shouldBlockAnaWebhookAutomation) antes de qualquer
 * classificador/IA rodar. Não decide o roteamento — apenas marca o estado;
 * a edge condicional decide se o grafo segue ou encerra o turno.
 *
 * Também hidrata commercialFlowState a partir de conversations.commercial_flow_state
 * (mesma coluna que o motor legado lê/grava) quando o checkpointer do LangGraph
 * ainda não tem estado pra essa thread — primeiro turno que o grafo processa
 * de uma conversa que já existia antes (ex.: no dia da virada de produção, ou
 * conversas atendidas pelo motor legado antes desse turno). Sem isso, o grafo
 * "esquece" tudo que já foi respondido/perguntado/agendado até aqui.
 *
 * Reseta assistantReplyText pra null aqui, sempre — o checkpointer persiste
 * estado entre turnos por thread_id (conversationId), e Annotation só
 * atualiza os campos que um nó de fato retorna. Sem esse reset explícito no
 * primeiro nó do turno, um turno em que nenhum nó posterior define
 * assistantReplyText (ex.: rota que não passa por ragAnswer/knowledgeGapReply)
 * herdaria o texto do ÚLTIMO turno bem-sucedido do checkpoint e reenviaria a
 * mesma resposta antiga pro cliente, ignorando a pergunta atual.
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

  const patch: Partial<AnaGraphState> = {
    automationBlockedByHandoff: blocked,
    handoffBlockedReason: blocked ? 'HANDOFF_BLOCKS_ANA_AUTOMATION' : null,
    assistantReplyText: null,
    // Mesmo motivo do reset de assistantReplyText acima: sem isso, um turno
    // que não passa por visitScheduling herdaria replyIsDeterministic:true
    // do último turno que passou, e finalizeReplyNode puraria o pipeline de
    // sanitização indevidamente pra uma resposta livre do LLM.
    replyIsDeterministic: false,
  };

  if (!blocked && conversation && isEmptyCommercialFlowState(state.commercialFlowState)) {
    const persisted = parseCommercialFlowState(conversation.commercial_flow_state);
    if (persisted) {
      patch.commercialFlowState = persisted;
    }
  }

  return patch;
}
