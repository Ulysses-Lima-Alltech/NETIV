import type { AnaGraphState } from './state.js';

export interface NextOpenQuestion {
  instruction: string;
  question: string;
}

/**
 * Sequência de qualificação estilo BANT (Budget/Need/Timing — a mesma usada
 * por corretores de verdade), uma pergunta em aberto por vez: pedir tudo
 * junto (nome + interesse + orçamento + responder a pergunta atual)
 * sobrecarrega a resposta. budgetRangeKnown/buyingTimeline só existem se já
 * foram capturados antes (hidratado do motor legado); o grafo ainda não
 * extrai/persiste esses dois sozinho — só evita perguntar de novo se já
 * souber.
 *
 * Compartilhado entre ragAnswerNode (guia o prompt) e finalizeReplyNode
 * (fallback determinístico pós-guards) para não duplicar a sequência em
 * dois lugares com risco de divergir.
 */
export function resolveNextOpenQuestion(state: AnaGraphState): NextOpenQuestion | null {
  const flowState = state.commercialFlowState;
  const knownName = (state.customerName ?? '').trim();
  const leadQualification = flowState.dialoguePolicy?.leadQualification;

  if (!knownName) {
    return { instruction: 'Pergunte o nome do cliente.', question: 'Como posso te chamar?' };
  }
  if (!flowState.purchaseIntent) {
    return {
      instruction: 'Pergunte se o interesse é para morar, investir, ou se ainda não sabe.',
      question: 'É pra morar, investir, ou você ainda está avaliando?',
    };
  }
  if (!leadQualification?.budgetRangeKnown) {
    return {
      instruction: 'Pergunte qual a faixa de orçamento disponível pro imóvel.',
      question: 'Qual faixa de orçamento você tem disponível pra esse imóvel?',
    };
  }
  if (!leadQualification?.buyingTimeline) {
    return {
      instruction: 'Pergunte o prazo que o cliente tem pra decidir/comprar.',
      question: 'Qual o prazo que você tem em mente pra decidir?',
    };
  }
  return null;
}
