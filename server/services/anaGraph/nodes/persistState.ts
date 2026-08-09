import { mergeConversationCommercialFlowState } from '../../../repositories/conversationRepository.js';
import type { AnaGraphState } from '../state.js';

export type PersistCommercialFlowStateFn = (
  conversationId: number,
  nextState: AnaGraphState['commercialFlowState']
) => Promise<void>;

export interface PersistStateNodeParams {
  conversationId: number;
  /**
   * Persistência real é injetável — nunca chamada direto hardcoded. Default
   * aponta para mergeConversationCommercialFlowState (mesma escrita do
   * motor legado, dual-write: o formato gravado continua compatível
   * enquanto a flag da fase 9 não for promovida). O modo sombra DEVE passar
   * um mock aqui para garantir zero escrita em produção.
   */
  persist?: PersistCommercialFlowStateFn;
}

/**
 * Nó de persistência: reaproveita mergeConversationCommercialFlowState
 * (conversationRepository.ts) sem alteração de formato — grava o mesmo JSON
 * que o motor legado grava em conversations.commercial_flow_state.
 */
export async function persistStateNode(
  state: AnaGraphState,
  params: PersistStateNodeParams
): Promise<Partial<AnaGraphState>> {
  const persist = params.persist ?? mergeConversationCommercialFlowState;
  await persist(params.conversationId, state.commercialFlowState);
  return {};
}
