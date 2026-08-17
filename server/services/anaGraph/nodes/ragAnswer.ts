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
  const knownName = (state.customerName ?? '').trim();
  const isFirstReply = !recentMessages.some((m) => m.role === 'assistant');

  const knownFactsLines: string[] = [];
  if (knownName) knownFactsLines.push(`- Nome do cliente: ${knownName}. Não pergunte o nome de novo.`);
  if (flowState.purchaseIntent === 'MORADIA') knownFactsLines.push('- Interesse do cliente: MORAR. Não pergunte de novo se é morar ou investir.');
  else if (flowState.purchaseIntent === 'INVESTIMENTO') knownFactsLines.push('- Interesse do cliente: INVESTIR. Não pergunte de novo se é morar ou investir.');
  const knownFactsBlock = knownFactsLines.length > 0 ? `\n\nO QUE JÁ SABEMOS (não repita estas perguntas):\n${knownFactsLines.join('\n')}` : '';

  // Uma coisa em aberto por vez, em ordem de prioridade — pedir tudo junto
  // (nome + interesse + responder a pergunta atual) sobrecarrega a resposta.
  const nextOpenQuestion = !knownName
    ? 'Pergunte o nome do cliente.'
    : !flowState.purchaseIntent
      ? 'Pergunte se o interesse é para morar, investir, ou se ainda não sabe.'
      : null;

  const systemPrompt = [
    `Você é a Ana, assistente comercial do empreendimento ${params.enterpriseName}.`,
    '',
    'REGRAS:',
    '1. Responda apenas com base no CONTEXTO abaixo. Se a informação não estiver lá, não invente.',
    '2. Use o HISTÓRICO pra não repetir perguntas já respondidas e pra interpretar respostas curtas (ex.: "morar", "sim") no contexto da última pergunta feita.',
    '3. Seja objetiva e curta (2-3 frases no total, incluindo a pergunta final).',
    '4. Pode informar valores/preços exatos se estiverem no CONTEXTO. NUNCA prometa ou confirme condições de pagamento, descontos ou condições especiais — isso o corretor confirma na visita ou no atendimento.',
    '5. Sempre termine com UMA pergunta objetiva, a não ser que o cliente já tenha encerrado o assunto (ex.: agradecimento, despedida).',
    isFirstReply
      ? '6. Esta é a primeira mensagem da conversa: cumprimente rápido, confirme que pode ajudar com o empreendimento, e já pergunte o nome do cliente — não despeje muitos fatos de uma vez.'
      : nextOpenQuestion
        ? `6. Responda a pergunta do cliente primeiro. Se a pergunta final da sua resposta puder ser sobre isto, use-a: ${nextOpenQuestion}`
        : '6. Use o nome do cliente ÀS VEZES na resposta (não em toda mensagem), se soubermos o nome.',
    knownFactsBlock,
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
