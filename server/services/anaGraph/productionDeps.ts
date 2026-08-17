import type { AnaGraphRuntimeDeps } from './graph.js';
import type { AnaGraphState } from './state.js';
import { resolveAiSettingsForEnterprise } from '../enterpriseAiSettingsService.js';
import { buildDecisionContextNode } from './nodes/buildDecisionContext.js';
import { hasExplicitHandoffIntent } from '../../utils/anaInstructionLeakAndHandoffIntent.js';
import { getVariablesMap } from '../../repositories/enterpriseRepository.js';
import { logSentFile } from '../../repositories/enterpriseRepository.js';
import { loadRankedKnowledgeChunksForPromptWithMeta } from '../../repositories/enterpriseKnowledgeChunkRepository.js';
import { sendAnaLocalMediaToWhatsAppWithQuota } from '../anaOutboundQuotaService.js';
import { sendTextMessage } from '../whatsappMetaService.js';
import { insertMessage } from '../../repositories/messageRepository.js';
import type { ConversationRow } from '../../repositories/conversationRepository.js';

/**
 * Deps de produção real do anaGraph — usadas quando o grafo novo responde
 * clientes de verdade (gate: anaGraphProductionRollout.ts). Espelha
 * buildShadowDeps (shadowRunner.ts) na estrutura, mas troca cada mock "só
 * loga" pela função real correspondente, reaproveitando o que o motor
 * legado já usa (nenhuma lógica de negócio nova).
 *
 * Vários campos ficam ausentes de propósito: os próprios nós do grafo já
 * têm como default a função real quando o dep não é fornecido
 * (assignBroker -> assignConversationToNextBroker, persistAppointment ->
 * assignAppointment, updateHandoffClassification -> updateClassification,
 * persistCommercialFlowState -> mergeConversationCommercialFlowState,
 * sendWhatsappText -> sendAnaTextMessageWithQuota) — ver cada nodes/*.ts.
 * Só os campos sem default (obrigatórios na interface) são preenchidos aqui.
 */
export function buildProductionDeps(): AnaGraphRuntimeDeps {
  return {
    ragAnswerContext: async (state: AnaGraphState, conversation: ConversationRow) => {
      const resolved = await resolveAiSettingsForEnterprise(state.enterpriseId);
      const decisionContext = await buildDecisionContextNode(state, conversation);
      return {
        enterpriseEvidence: decisionContext.enterpriseEvidence,
        aiConfig: {
          apiKey: resolved.openaiApiKey ?? '',
          baseUrl: resolved.openaiBaseUrl,
          model: resolved.modelColdLead || resolved.modelHotLead,
          maxTokens: resolved.maxTokens,
        },
      };
    },

    // officialData = valores das variáveis do empreendimento + knowledgeText,
    // mesma construção que conversationEngine.ts usa antes de
    // applyOperationalFactGuard (~linha 11189) — é o que impede
    // buildLeadQualificationBridgeReply de passar por cima do guard de
    // "nunca inventar" quando não há evidência real.
    knowledgeGapContext: async (state: AnaGraphState) => {
      if (state.enterpriseId == null) return { officialData: '' };
      const [variablesMap, chunkMeta] = await Promise.all([
        getVariablesMap(state.enterpriseId),
        loadRankedKnowledgeChunksForPromptWithMeta(
          state.enterpriseId,
          `${state.enterpriseName ?? ''}\n${state.userMessage}`.slice(0, 4000),
          {}
        ),
      ]);
      const officialData = [...Object.values(variablesMap), chunkMeta.promptText.slice(0, 12_000)]
        .filter(Boolean)
        .join('\n');
      return { officialData };
    },

    finalizeReplyContext: async (state: AnaGraphState, conversation: ConversationRow) => ({
      enterpriseName: state.enterpriseName,
      conversationType: conversation.conversation_type ?? 'CLIENT',
    }),

    // Pedido explícito de corretor usa o mesmo motivo que o motor legado
    // (aceito pela whitelist ALLOWED_ASSIGNMENT_REASONS em
    // brokerAssignmentService.ts, então o corretor é notificado de
    // verdade). Qualquer outro handoff (sem resposta segura) usa um motivo
    // fora da whitelist de propósito — o status ainda vira Handoff
    // (updateClassification, sempre incondicional em humanHandoffNode),
    // só não dispara notificação automática de corretor, que é o
    // comportamento correto pra não reintroduzir o loop de reengajamento.
    handoffReason: (state: AnaGraphState) =>
      hasExplicitHandoffIntent(state.userMessage) ? 'explicit_broker_request' : 'ana_graph_no_safe_answer',

    // `file` já vem totalmente resolvido do sendMaterialNode (categoria única
    // via getFileForSend, ou a foto/vídeo específico já filtrado por título
    // pra fotos/vídeos) — manda exatamente esse arquivo, sem re-resolver por
    // categoria (isso ignorava qual instância específica tinha sido escolhida).
    sendMaterial: async ({ to, file, conversationId }) => {
      const result = await sendAnaLocalMediaToWhatsAppWithQuota({
        conversationId,
        to,
        filePath: file.path,
        filename: file.originalName,
        mimeFromDb: file.mime,
        phase: 'ana_graph_send_material',
      });
      if (!result.success) return { sent: false };
      await logSentFile(conversationId, file.id);
      return { sent: true };
    },

    sendEmergencyHandoffText: sendTextMessage,

    insertAssistantMessage: async (conversationId, text, metaMessageId) =>
      insertMessage(conversationId, 'assistant', text, metaMessageId),
  };
}
