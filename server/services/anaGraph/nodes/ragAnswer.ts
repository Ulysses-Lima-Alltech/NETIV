import { loadRankedKnowledgeChunksForPromptWithMeta } from '../../../repositories/enterpriseKnowledgeChunkRepository.js';
import { getRecentConversationMessages } from '../../../repositories/messageRepository.js';
import { generateChatCompletion, type ChatMessage } from '../../openaiService.js';
import { hasAnaEvidenceForNeed, type AnaEnterpriseEvidence } from '../../../utils/anaEnterpriseEvidence.js';
import { resolveNextOpenQuestion } from '../nextOpenQuestion.js';
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
    // expanded:true dobra o teto de chunks (padrão 3 -> 6) — dá mais espaço
    // pros trechos de BLOCO 4 (REGRAS_ANA / arquivos de fluxo de atendimento,
    // ex.: "Fluxo Base Evora - ANA.txt") caberem junto dos fatos do
    // empreendimento, em vez de competirem pelo mesmo orçamento pequeno de 3
    // e o conteúdo de tom/condução da conversa nunca aparecer.
    { expanded: true }
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

  // Sequência de qualificação estilo BANT — ver nextOpenQuestion.ts (compartilhado
  // com finalizeReplyNode, que é quem de fato garante a pergunta final; aqui é só
  // orientação de conteúdo pro prompt).
  const nextOpenQuestion = resolveNextOpenQuestion(state);

  const systemPrompt = [
    `Você é a Ana, corretora de atendimento do empreendimento ${params.enterpriseName}. Converse como uma corretora experiente conversaria: cordial, consultiva, curiosa sobre o que o cliente precisa — não como um FAQ que só devolve fatos.`,
    '',
    'REGRAS:',
    '1. Responda apenas com base no CONTEXTO abaixo (inclui BLOCO 4 - REGRAS DA ANA, com orientações de tom e condução — siga essas orientações). Se um FATO específico não estiver no contexto, não invente.',
    '2. Se o cliente pedir algo que não está no CONTEXTO (um fato específico, uma condição, disponibilidade exata): não devolva um "não sei" seco. Ofereça objetivamente agendar uma visita ou encaminhar para um corretor confirmar — nunca deixe a conversa num beco sem saída.',
    '3. Use o HISTÓRICO pra não repetir perguntas já respondidas e pra interpretar respostas curtas (ex.: "morar", "sim") no contexto da última pergunta feita.',
    '4. Seja natural e cordial, mas objetiva (2-4 frases no total, incluindo a pergunta final).',
    '5. Pode informar valores/preços exatos se estiverem no CONTEXTO. NUNCA prometa ou confirme condições de pagamento, descontos ou condições especiais — isso o corretor confirma na visita ou no atendimento.',
    '6. Sempre termine com UMA pergunta objetiva que avance a conversa como uma corretora faria (ex.: orçamento disponível, prazo pra decidir, região de preferência, se já conhece a região, o que mais pesa na decisão) — não repita a mesma pergunta genérica em turnos seguidos. Só não pergunte nada se o cliente já encerrou o assunto (ex.: agradecimento, despedida).',
    isFirstReply
      ? '7. Esta é a primeira mensagem da conversa: cumprimente com cordialidade, confirme que pode ajudar com o empreendimento, e pergunte o nome do cliente — não despeje muitos fatos de uma vez.'
      : nextOpenQuestion
        ? `7. Responda a pergunta do cliente primeiro. Se fizer sentido, use a pergunta final da regra 6 pra isto: ${nextOpenQuestion.instruction}`
        : '7. Use o nome do cliente ÀS VEZES na resposta (não em toda mensagem), se soubermos o nome.',
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

  // A garantia determinística de "sempre termina com pergunta" NÃO fica aqui:
  // applyAnaHardLengthGuard (chamado depois, em finalizeReplyNode) trunca a
  // resposta em no máximo 2 frases, e pode descartar silenciosamente uma
  // pergunta anexada neste ponto se o rascunho do modelo já "gastou" as 2
  // frases (ex.: "Olá! Tudo bem." já são 2 frases curtas). O enforcement real
  // roda em finalizeReplyNode, depois de todos os guards de tamanho/sanitização
  // — é o único lugar que garante que nada downstream pode apagar a pergunta.
  return { assistantReplyText: result.content.trim() };
}
