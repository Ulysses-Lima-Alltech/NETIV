import { loadRankedKnowledgeChunksForPromptWithMeta } from '../../../repositories/enterpriseKnowledgeChunkRepository.js';
import { getRecentConversationMessages } from '../../../repositories/messageRepository.js';
import { generateChatCompletion, type ChatMessage } from '../../openaiService.js';
import { hasAnaEvidenceForNeed, type AnaEnterpriseEvidence } from '../../../utils/anaEnterpriseEvidence.js';
import type { AnaGraphState } from '../state.js';

export interface RagAnswerNodeParams {
  conversationId: number;
  contactId: number | string | null;
  enterpriseId: number;
  enterpriseName: string;
  enterpriseEvidence: AnaEnterpriseEvidence;
  aiConfig: {
    apiKey: string;
    baseUrl: string | null;
    model: string;
    maxTokens: number;
  };
}

/**
 * Nó de resposta via RAG: reaproveita loadRankedKnowledgeChunksForPromptWithMeta
 * (busca de trechos) e generateChatCompletion (openaiService.ts) sem alterar a
 * lógica de recuperação/geração. O texto do system prompt aqui é orquestração
 * nova do grafo (não existe builder exportável equivalente em
 * conversationEngine.ts para reaproveitar) — mantido mínimo e deliberadamente
 * conservador (recusa quando não há evidência) até validação em modo sombra.
 */
export async function ragAnswerNode(
  state: AnaGraphState,
  params: RagAnswerNodeParams
): Promise<Partial<AnaGraphState>> {
  const chunkMeta = await loadRankedKnowledgeChunksForPromptWithMeta(
    params.enterpriseId,
    `${params.enterpriseName}\n${state.userMessage}`.slice(0, 4000),
    {}
  );

  const hasGeneralEvidence = hasAnaEvidenceForNeed(params.enterpriseEvidence, 'geral');
  if (!hasGeneralEvidence || chunkMeta.selectedChunkCount === 0) {
    return { assistantReplyText: null };
  }

  const recentMessages = await getRecentConversationMessages(params.conversationId, 12);
  const currentUserMessageNorm = state.userMessage.trim();
  const historyMessages: ChatMessage[] = recentMessages
    .filter((m, index) => !(index === recentMessages.length - 1 && m.role === 'user' && m.content === currentUserMessageNorm))
    .map((m) => ({ role: m.role, content: m.content }));

  const flowState = state.commercialFlowState;
  const knownCustomerContextLines: string[] = [];
  const knownName = (state.customerName ?? '').trim();
  if (knownName) {
    knownCustomerContextLines.push(
      `O nome do cliente é ${knownName}. Não pergunte o nome de novo. Use o nome ÀS VEZES pra deixar a conversa mais pessoal — não em toda mensagem.`
    );
  }
  if (flowState.purchaseIntent === 'MORADIA') {
    knownCustomerContextLines.push('O cliente já disse que busca o imóvel para MORAR. Não pergunte de novo se é para morar ou investir.');
  } else if (flowState.purchaseIntent === 'INVESTIMENTO') {
    knownCustomerContextLines.push('O cliente já disse que busca o imóvel para INVESTIR. Não pergunte de novo se é para morar ou investir.');
  }
  const knownCustomerContext =
    knownCustomerContextLines.length > 0
      ? `\n\nO QUE JÁ SABEMOS SOBRE O CLIENTE (não repita essas perguntas):\n${knownCustomerContextLines.join('\n')}`
      : '';

  const openQuestionLines: string[] = [];
  if (!knownName) {
    openQuestionLines.push('Ainda não sabemos o nome do cliente — se ainda não perguntou nesta conversa, pergunte o nome dele.');
  }
  if (!flowState.purchaseIntent) {
    openQuestionLines.push(
      'Ainda não sabemos o interesse do cliente — se ainda não perguntou nesta conversa, pergunte se ele busca o imóvel para morar, investir, ou se ainda não sabe.'
    );
  }
  const openQuestionsContext =
    openQuestionLines.length > 0
      ? `\n\nPERGUNTAS EM ABERTO (priorize uma destas antes de outras perguntas, se ainda não foi feita nesta conversa):\n${openQuestionLines.join('\n')}`
      : '';

  const systemPrompt = [
    `Você é a Ana, assistente comercial do empreendimento ${params.enterpriseName}.`,
    'Responda apenas com base no CONTEXTO abaixo. Se a informação não estiver no contexto, não responda — não invente.',
    'Use o HISTÓRICO da conversa para não repetir perguntas já respondidas pelo cliente e para interpretar respostas curtas (ex.: "morar", "sim") no contexto da última pergunta feita.',
    'Seja objetiva e curta (2-4 frases).',
    'Pode informar valores/preços exatos se estiverem no CONTEXTO. NUNCA prometa ou confirme condições de pagamento, descontos ou condições especiais específicas — isso o corretor confirma certinho na visita ou no atendimento.',
    'Termine a resposta com uma pergunta objetiva que ajude a conversa avançar (ex.: sobre nome, interesse morar/investir, prazo, ou o próximo tópico natural) — a não ser que a mensagem do cliente já tenha encerrado a conversa (ex.: agradecimento, despedida).',
    knownCustomerContext,
    openQuestionsContext,
    '',
    'CONTEXTO:',
    chunkMeta.promptText,
  ].join('\n');

  const result = await generateChatCompletion({
    apiKey: params.aiConfig.apiKey,
    baseUrl: params.aiConfig.baseUrl,
    model: params.aiConfig.model,
    temperature: 0.2,
    maxTokens: params.aiConfig.maxTokens,
    messages: [
      { role: 'system', content: systemPrompt },
      ...historyMessages,
      { role: 'user', content: state.userMessage },
    ],
    costTracking: {
      purpose: 'ana_graph_rag_answer',
      conversationId: params.conversationId,
      contactId: typeof params.contactId === 'number' ? params.contactId : null,
      enterpriseId: params.enterpriseId,
      requestType: 'ana_graph_rag_answer',
    },
  });

  if (!result.success || !result.content?.trim()) {
    return { assistantReplyText: null };
  }

  return { assistantReplyText: result.content.trim() };
}
