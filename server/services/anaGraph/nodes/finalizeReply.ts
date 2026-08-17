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
  /** Quantas mensagens (cliente + Ana) já existem na conversa antes deste turno. */
  messageCountSoFar?: number;
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
 * Regra explícita do produto: nas primeiras 8 mensagens da conversa, a Ana
 * NUNCA responde sem terminar em pergunta (mantém o cliente engajado
 * enquanto ela ainda está qualificando o lead). Roda por último, depois de
 * finalizeAnaReplyText/applyAnaHardLengthGuard/evaluateAnaOutboundText —
 * esses guards de tamanho/sanitização podem truncar a resposta do modelo
 * (ex.: applyAnaHardLengthGuard mantém no máx. 2 frases) e derrubar uma
 * pergunta que tivesse sido anexada mais cedo no pipeline. Este é o único
 * ponto depois do qual nada mais mexe no texto antes do envio.
 */
function ensureEndsWithQuestionWithinFirstMessages(
  text: string,
  userMessage: string,
  messageCountSoFar: number | undefined,
  nextOpenQuestion: { question: string } | null
): string {
  if (!text.trim()) return text;
  if (endsWithQuestion(text)) return text;
  if (looksLikeConversationCloser(userMessage)) return text;
  // messageCountSoFar indeterminado (dep não fornecida): erra pro lado de
  // aplicar a regra, já que o custo de uma pergunta extra é baixo e o bug
  // que motivou isso (resposta sem nenhuma pergunta) é pior.
  if (messageCountSoFar != null && messageCountSoFar >= 8) return text;

  const followup = nextOpenQuestion?.question ?? 'Posso te ajudar com mais alguma coisa?';
  return `${text} ${followup}`;
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

  const withQuestion = ensureEndsWithQuestionWithinFirstMessages(
    evaluated.text,
    state.userMessage,
    params.messageCountSoFar,
    resolveNextOpenQuestion(state)
  );

  return { assistantReplyText: withQuestion };
}
