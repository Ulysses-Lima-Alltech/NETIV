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
  /**
   * true quando o rascunho veio de um nó determinístico (hoje só
   * visitScheduling — handleVisitSchedulingDeterministically) em vez de uma
   * resposta livre do LLM (ragAnswer/knowledgeGapReply). Causa raiz real de
   * "agendamento sempre volta pra localização/corretor", achada via CloudWatch
   * + consulta direta no banco: finalizeAnaReplyText roda
   * sanitizeTooManyQuestionsReply sempre que a resposta tem 2+ "?" — e o
   * fallback dessa função quando sobra texto vazio é um texto FIXO sobre
   * localização/corretor, sem nenhuma noção de agendamento. Uma resposta de
   * agendamento perfeitamente válida (ex.: "Prefere quinta às 10h ou outro
   * horário?") virava, silenciosamente, essa frase genérica e destruía o
   * estado real (que continuava sendo atualizado corretamente por trás —
   * só o TEXTO enviado é que ficava errado). Respostas determinísticas
   * pulam esse pipeline inteiro (construído pra texto livre do RAG) e vão
   * direto pra validação de segurança (evaluateAnaOutboundText).
   */
  isDeterministicReply?: boolean;
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
 * Pool de perguntas de fechamento genéricas — usadas SÓ quando o BANT já
 * terminou (nextOpenQuestion null) e o próprio modelo não fechou com
 * pergunta. Antes disso era uma frase fixa única ("Posso te ajudar com mais
 * alguma coisa?"), repetida em praticamente toda mensagem depois que o
 * ciclo de qualificação zerava — ficava mecânico e óbvio que era fallback.
 * Inclui, de propósito, uma sugestão de visita — não em toda mensagem, mas
 * como uma das opções do rodízio (pedido explícito: oferecer visita "às
 * vezes" ao longo da conversa, não só quando o cliente pede).
 */
const FALLBACK_CLOSING_QUESTIONS: readonly string[] = [
  'Tem mais alguma coisa que eu possa te ajudar a esclarecer?',
  'Ficou alguma dúvida ou quer que eu te conte sobre outro ponto do Évora?',
  'Quer que eu detalhe melhor algum desses pontos?',
  'Tem outra coisa que pesa pra você antes de decidir?',
  'Já pensou em agendar uma visita pra conhecer o Évora pessoalmente?',
  'Posso te ajudar com mais alguma informação sobre o empreendimento?',
];

/** Evita repetir a mesma pergunta de fechamento da mensagem anterior. */
function pickFallbackClosingQuestion(lastAssistantSnippet: string | null | undefined): string {
  const lastNorm = (lastAssistantSnippet ?? '').toLowerCase();
  const candidates = FALLBACK_CLOSING_QUESTIONS.filter((q) => !lastNorm.includes(q.toLowerCase()));
  const pool = candidates.length > 0 ? candidates : FALLBACK_CLOSING_QUESTIONS;
  return pool[Math.floor(Math.random() * pool.length)]!;
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
  nextOpenQuestion: { question: string } | null,
  lastAssistantSnippet: string | null | undefined
): string {
  if (!text.trim()) return text;
  if (endsWithQuestion(text)) return text;
  if (looksLikeConversationCloser(userMessage)) return text;

  const followup = nextOpenQuestion?.question ?? pickFallbackClosingQuestion(lastAssistantSnippet);
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

  const evaluated = params.isDeterministicReply
    ? evaluateAnaOutboundText({
        reply: draft,
        conversationType: params.conversationType,
        enterpriseName: params.enterpriseName,
      })
    : evaluateAnaOutboundText({
        reply: applyAnaHardLengthGuard({
          text: finalizeAnaReplyText(draft, {
            userMessage: state.userMessage,
            lastAssistantMessage: params.lastAssistantMessage ?? null,
            conversationMode: params.conversationMode,
            isFirstAnaReply: params.isFirstAnaReply,
            enterpriseName: params.enterpriseName,
            isKnowledgeGapTurn: params.isKnowledgeGapTurn,
          }),
          enterpriseName: params.enterpriseName,
          maxChars: params.maxChars,
        }),
        conversationType: params.conversationType,
        enterpriseName: params.enterpriseName,
      });

  if (!evaluated.valid) {
    return { assistantReplyText: null };
  }

  const nextOpenQuestion = resolveNextOpenQuestion(state);
  let finalText = ensureEndsWithQuestion(
    evaluated.text,
    state.userMessage,
    nextOpenQuestion,
    state.commercialFlowState.lastAssistantSnippet
  );

  // Nome deve ser SEMPRE a primeira pergunta feita ao cliente: na primeira
  // resposta da Ana, se o nome ainda não é conhecido, força a pergunta de
  // fechamento a ser sobre o nome, mesmo que o modelo tenha preferido
  // perguntar outra coisa (ex.: morar/investir).
  if (params.isFirstAnaReply && !((state.customerName ?? '').trim()) && nextOpenQuestion?.question) {
    finalText = forceNameAsFirstQuestion(finalText, nextOpenQuestion.question);
  }

  return { assistantReplyText: finalText };
}
