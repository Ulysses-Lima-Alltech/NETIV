import { Annotation } from '@langchain/langgraph';
import type { CommercialFlowState } from '../../utils/commercialFlowState.js';
import type { AnaDecisionPolicyResult } from '../../utils/anaDecisionPolicy.js';

/**
 * Espelha CommercialFlowState como um único campo (merge raso) em vez de achatar
 * suas ~40 chaves opcionais em annotations individuais — reduz risco de divergência
 * silenciosa com o motor legado, que sempre lê/grava o objeto inteiro.
 */
function mergeCommercialFlowState(
  current: CommercialFlowState,
  update: CommercialFlowState
): CommercialFlowState {
  return { ...current, ...update };
}

export const AnaGraphStateAnnotation = Annotation.Root({
  // Campos de turno
  conversationId: Annotation<number>(),
  contactId: Annotation<number | string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  enterpriseId: Annotation<number | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  userMessage: Annotation<string>(),
  metaMessageId: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  phoneNumberId: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  // Contexto do turno carregado uma vez por loadTurnContextNode (fase 8) e
  // reaproveitado pelos nós seguintes — evita refetch repetido da conversa.
  customerName: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  customerPhone: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  enterpriseName: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  enterpriseCity: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
  conversationType: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  // Flags de handoff/automação
  automationBlockedByHandoff: Annotation<boolean>({
    reducer: (_current, update) => update,
    default: () => false,
  }),
  handoffBlockedReason: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  // Estado comercial espelhado (persistido em conversations.commercial_flow_state)
  commercialFlowState: Annotation<CommercialFlowState>({
    reducer: mergeCommercialFlowState,
    default: () => ({}),
  }),

  // Saída do turno (preenchida pelos nós de ramificação/finalização)
  assistantReplyText: Annotation<string | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),

  /**
   * Marca quando assistantReplyText === null é intencional (ex.: sendMaterial
   * já respondeu via mídia, sem necessidade de texto extra) — distingue esse
   * caso do "não conseguimos responder", que deve rotear para humanHandoff em
   * vez de terminar em silêncio puro.
   */
  replyIntentionallyEmpty: Annotation<boolean>({
    reducer: (_current, update) => update,
    default: () => false,
  }),

  /**
   * Marca quando assistantReplyText veio de um nó determinístico
   * (visitScheduling, via handleVisitSchedulingDeterministically) em vez de
   * texto livre gerado pelo LLM — finalizeReplyNode usa isso pra pular o
   * pipeline de sanitização/"rescue" pensado pra texto de RAG (ver
   * finalizeReply.ts para o bug real que isso corrige: uma resposta de
   * agendamento com 2 perguntas virava, silenciosamente, um fallback fixo
   * de localização/corretor sem relação nenhuma com o agendamento).
   */
  replyIsDeterministic: Annotation<boolean>({
    reducer: (_current, update) => update,
    default: () => false,
  }),

  /** Resultado da fase 4 (decisionPolicy) — carregado para a edge condicional decidir o roteamento da fase 5. */
  lastDecision: Annotation<AnaDecisionPolicyResult | null>({
    reducer: (_current, update) => update,
    default: () => null,
  }),
});

export type AnaGraphState = typeof AnaGraphStateAnnotation.State;
