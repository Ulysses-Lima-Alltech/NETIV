import { Annotation } from '@langchain/langgraph';
import type { CommercialFlowState } from '../../utils/commercialFlowState.js';

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
});

export type AnaGraphState = typeof AnaGraphStateAnnotation.State;
