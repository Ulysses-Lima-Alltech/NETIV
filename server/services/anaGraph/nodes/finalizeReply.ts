import {
  finalizeAnaReplyText,
  applyAnaHardLengthGuard,
  evaluateAnaOutboundText,
  type FinalizeAnaReplyOptions,
} from '../../../utils/anaReplyFinalize.js';
import { isGratitudeOnlyMessage } from '../../../utils/anaEvoraGreetingAndFollowup.js';
import { resolveNextOpenQuestion } from '../nextOpenQuestion.js';
import type { AnaGraphState } from '../state.js';

export interface FinalizeReplyNodeParams {
  enterpriseName?: string | null;
  conversationType?: 'CLIENT' | 'CORRETOR' | 'ADMIN' | string | null;
  conversationMode?: FinalizeAnaReplyOptions['conversationMode'];
  isFirstAnaReply?: boolean;
  isKnowledgeGapTurn?: boolean;
  lastAssistantMessage?: string | null;
  maxChars?: number;
}

const CONVERSATION_CLOSER_RE =
  /^(tchau|até mais|até logo|falou|flw|xau|adeus|bjs?|beijos?|abra[cç]os?)\b/i;

function endsWithQuestion(text: string): boolean {
  return /[?？]\s*$/.test(text.trim());
}

function looksLikeConversationCloser(userMessage: string): boolean {
  const n = userMessage.trim();
  return isGratitudeOnlyMessage(n) || CONVERSATION_CLOSER_RE.test(n);
}

/**
 * Regra explícita do produto: a Ana NUNCA responde sem terminar em pergunta
 * (mantém o cliente engajado), a menos que o cliente já tenha encerrado a
 * conversa. Roda por último, depois de finalizeAnaReplyText/
 * applyAnaHardLengthGuard/evaluateAnaOutboundText — esses guards de tamanho/
 * sanitização podem truncar a resposta do modelo (ex.: applyAnaHardLengthGuard
 * mantém no máx. 2 frases) e derrubar uma pergunta que tivesse sido anexada
 * mais cedo no pipeline. Este é o único ponto depois do qual nada mais mexe
 * no texto antes do envio.
 */
function ensureEndsWithQuestion(
  text: string,
  userMessage: string,
  nextOpenQuestion: { question: string } | null
): string {
  if (!text.trim()) return text;
  if (endsWithQuestion(text)) return text;
  if (looksLikeConversationCloser(userMessage)) return text;

  const followup = nextOpenQuestion?.question ?? 'Posso te ajudar com mais alguma coisa?';
  return `${text} ${followup}`;
}

/**
 * "O nome deve ser a primeira pergunta": na primeira resposta da Ana, se
 * ainda não sabemos o nome do cliente, a pergunta de fechamento TEM que ser
 * sobre o nome — não outra pergunta que o modelo tenha decidido fazer por
 * conta própria (ex.: morar/investir). Troca a última frase-pergunta da
 * resposta (se houver) pela pergunta do nome, em vez de só anexar mais uma
 * (o que deixaria duas perguntas na mesma mensagem).
 */
function forceNameAsFirstQuestion(text: string, nameQuestion: string): string {
  const trimmed = text.trim();
  if (!trimmed) return text;
  if (trimmed.toLowerCase().includes(nameQuestion.toLowerCase())) return text;

  const sentences = trimmed.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);
  const last = sentences[sentences.length - 1];
  const kept = last && last.includes('?') ? sentences.slice(0, -1) : sentences;
  const base = kept.join(' ').trim();
  return (base ? `${base} ${nameQuestion}` : nameQuestion).replace(/\s{2,}/g, ' ').trim();
}

/**
 * Nó de finalização: consolida finalizeAnaReplyText, applyAnaHardLengthGuard
 * e evaluateAnaOutboundText (anaReplyFinalize.ts) na mesma ordem hoje aplicada
 * pelo motor legado — sem alteração de nenhuma das sanitizações internas.
 */
export function finalizeReplyNode(
  state: AnaGraphState,
  params: FinalizeReplyNodeParams
): Partial<AnaGraphState> {
  const draft = state.assistantReplyText ?? '';
  if (!draft.trim()) {
    return { assistantReplyText: null };
  }

  const finalized = finalizeAnaReplyText(draft, {
    userMessage: state.userMessage,
    lastAssistantMessage: params.lastAssistantMessage ?? null,
    conversationMode: params.conversationMode,
    isFirstAnaReply: params.isFirstAnaReply,
    enterpriseName: params.enterpriseName,
    isKnowledgeGapTurn: params.isKnowledgeGapTurn,
  });

  const lengthGuarded = applyAnaHardLengthGuard({
    text: finalized,
    enterpriseName: params.enterpriseName,
    maxChars: params.maxChars,
  });

  const evaluated = evaluateAnaOutboundText({
    reply: lengthGuarded,
    conversationType: params.conversationType,
    enterpriseName: params.enterpriseName,
  });

  if (!evaluated.valid) {
    return { assistantReplyText: null };
  }

  const nextOpenQuestion = resolveNextOpenQuestion(state);
  let finalText = ensureEndsWithQuestion(evaluated.text, state.userMessage, nextOpenQuestion);

  // Nome deve ser SEMPRE a primeira pergunta feita ao cliente: na primeira
  // resposta da Ana, se o nome ainda não é conhecido, força a pergunta de
  // fechamento a ser sobre o nome, mesmo que o modelo tenha preferido
  // perguntar outra coisa (ex.: morar/investir).
  if (params.isFirstAnaReply && !((state.customerName ?? '').trim()) && nextOpenQuestion?.question) {
    finalText = forceNameAsFirstQuestion(finalText, nextOpenQuestion.question);
  }

  return { assistantReplyText: finalText };
}
