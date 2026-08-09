import { loadRankedKnowledgeChunksForPromptWithMeta } from '../../../repositories/enterpriseKnowledgeChunkRepository.js';
import { generateChatCompletion } from '../../openaiService.js';
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

  const systemPrompt = [
    `Você é a Ana, assistente comercial do empreendimento ${params.enterpriseName}.`,
    'Responda apenas com base no CONTEXTO abaixo. Se a informação não estiver no contexto, não responda — não invente.',
    'Seja objetiva e curta (2-4 frases).',
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
