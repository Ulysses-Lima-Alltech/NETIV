import { mergeConversationCommercialFlowState } from '../../../repositories/conversationRepository.js';
import { listEnterprises, type EnterpriseRow } from '../../../repositories/enterpriseRepository.js';
import { computeNextCommercialFlowState } from '../../../utils/commercialFlowState.js';
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
  /** Só para testes — produção sempre usa listEnterprises(true) (DB real). */
  listActiveEnterprises?: () => Promise<EnterpriseRow[]>;
}

/**
 * Nó de persistência: reaproveita computeNextCommercialFlowState
 * (commercialFlowState.ts) — mesma função que conversationEngine.ts chama
 * logo após enviar a resposta (ver call site em torno da linha ~13628) —
 * para resolver purchaseIntent (eixo morar x investir),
 * lastAssistantAskedPurchaseIntent e lastInferredEnterpriseId a partir do
 * texto final da resposta e da mensagem do usuário, e só então grava via
 * mergeConversationCommercialFlowState (sem alteração de formato — mesmo
 * JSON que o motor legado grava em conversations.commercial_flow_state).
 *
 * Sem essa chamada, nenhum nó do grafo atualizava esses campos: o estado
 * comercial persistido nunca refletia o que o cliente acabou de responder
 * (ex.: "Morar" após a pergunta morar/investir ficava sem efeito no turno
 * seguinte).
 */
export async function persistStateNode(
  state: AnaGraphState,
  params: PersistStateNodeParams
): Promise<Partial<AnaGraphState>> {
  const persist = params.persist ?? mergeConversationCommercialFlowState;
  const listActiveEnterprises = params.listActiveEnterprises ?? (() => listEnterprises(true));
  const allActiveEnterprises = await listActiveEnterprises();
  const nextFlowState = computeNextCommercialFlowState(state.commercialFlowState, state.assistantReplyText ?? '', {
    conversationPhase: state.enterpriseId != null ? 'scoped' : 'triage',
    enterpriseIdResolved: state.enterpriseId,
    enterprises: allActiveEnterprises,
    productTypeHint: undefined,
    userMessage: state.userMessage,
  });
  await persist(params.conversationId, nextFlowState);
  return { commercialFlowState: nextFlowState };
}
