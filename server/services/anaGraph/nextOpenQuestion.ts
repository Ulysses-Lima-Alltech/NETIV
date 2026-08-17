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

const MONETARY_VALUE_RE = /(?:r\$\s*)?\d{1,3}(?:[.,]\d{3}){0,3}(?:\s*(?:mil|k|milh(?:a|õ)o|milhões))?/i;
const BUDGET_UNKNOWN_RE = /\b(nao sei|não sei|nao tenho|não tenho|ainda nao|ainda não|sem ideia|nao faco ideia|não faço ideia)\b/i;

/**
 * Detecta se a mensagem ATUAL do cliente responde à pergunta de orçamento —
 * só quando essa é de fato a pergunta em aberto (evita capturar um número
 * qualquer fora de contexto). Sem isso, budgetRangeKnown nunca era marcado
 * pelo grafo (só o motor legado tinha esse detector, em
 * extractLeadQualificationSignals/anaLeadQualificationPolicy.ts, que exige
 * uma palavra de contexto tipo "orçamento" junto do número — uma resposta
 * seca como "400 mil" ou "R$400.000,00" a essa pergunta específica não
 * batia lá também). Usado no MESMO turno em que o cliente responde (igual
 * ao padrão de captura de nome/purchaseIntent), pra não repetir a mesma
 * pergunta de novo no turno seguinte.
 */
export function inferBudgetAnswerFromCurrentTurn(state: AnaGraphState): { known: true; text: string | null } | null {
  const activeQuestion = resolveNextOpenQuestion(state);
  if (!activeQuestion || !/orçamento/i.test(activeQuestion.question)) return null;

  const msg = state.userMessage;
  const match = MONETARY_VALUE_RE.exec(msg);
  if (match) return { known: true, text: match[0].trim() };
  if (BUDGET_UNKNOWN_RE.test(msg)) return { known: true, text: null };
  return null;
}
