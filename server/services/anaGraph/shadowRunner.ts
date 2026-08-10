import { randomUUID } from 'crypto';
import { compileAnaGraph, type AnaGraphRuntimeDeps } from './graph.js';
import { resolveAiSettingsForEnterprise } from '../enterpriseAiSettingsService.js';
import { buildDecisionContextNode } from './nodes/buildDecisionContext.js';
import type { AnaGraphState } from './state.js';
import type { ConversationRow } from '../../repositories/conversationRepository.js';

const SHADOW_TAG = '[ANA_GRAPH_SHADOW]';

/** Flag global, nasce desligada por padrão. Nenhuma empresa é ativada automaticamente. */
export function isAnaGraphShadowEnabled(): boolean {
  return String(process.env.ANA_GRAPH_SHADOW_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/**
 * Deps do modo sombra: todo ponto de envio/escrita real recebe um mock que
 * apenas loga — nenhuma chamada real ao WhatsApp ou escrita em
 * commercial_flow_state/appointments/corretores parte daqui.
 *
 * Exceção conhecida: classifyLeadTurnNode (classifyLeadConversation) e
 * ragAnswerNode (generateChatCompletion) fazem chamadas reais ao Bedrock
 * com custo/rastreamento real — são funções já reaproveitadas sem alteração
 * desde as fases 3 e 5c, e não têm um modo "dry run" embutido. Ativar a
 * flag roda essas chamadas para cada turno processado. Ficar ciente do
 * custo antes de ligar a flag, mesmo em empresa piloto única.
 */
/**
 * Exportado para reuso pelo harness de comparação (fase 10) — garante que
 * qualquer execução do grafo fora da produção real (sombra ou harness) usa
 * exatamente os mesmos mocks "somente log", nunca duas implementações
 * divergentes de "não escrever/enviar de verdade".
 */
export function buildShadowDeps(runId: string): AnaGraphRuntimeDeps {
  return {
    ragAnswerContext: async (state: AnaGraphState, conversation: ConversationRow) => {
      // Mesma resolução usada pelo motor legado (enterpriseAiSettingsService.ts) —
      // força Bedrock via ANA_PROVIDER, com fallback determinístico ao model/
      // maxTokens do Bedrock em vez da config OpenAI global órfã.
      const resolved = await resolveAiSettingsForEnterprise(state.enterpriseId);
      // Reaproveita buildDecisionContextNode em vez de recalcular evidência aqui
      // pela terceira vez (decisionPolicy já monta isso com knowledgeText real) —
      // custa um fetch de RAG a mais por turno; consolidar num único fetch
      // compartilhado via AnaGraphState fica como otimização futura.
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
    knowledgeGapContext: async () => ({ officialData: '' }),
    finalizeReplyContext: async (state: AnaGraphState, conversation: ConversationRow) => ({
      enterpriseName: state.enterpriseName,
      conversationType: conversation.conversation_type ?? 'CLIENT',
    }),
    handoffReason: () => 'ana_graph_shadow_gap_default',

    persistAppointment: async (data) => {
      console.log(SHADOW_TAG, 'persistAppointment_skipped', { runId, enterpriseId: data.enterpriseId });
      return {
        appointment: {
          id: -1,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          enterpriseId: data.enterpriseId,
          brokerId: data.brokerId ?? null,
          city: data.city,
          startAt: data.startAt.toISOString(),
          endAt: data.endAt.toISOString(),
          status: 'SHADOW_SKIPPED',
          source: 'ANA_GRAPH_SHADOW',
          notes: '',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
        broker: null,
        empreendimento: null,
        dataHora: data.startAt.toISOString(),
        cliente: data.customerName,
      };
    },
    sendMaterial: async ({ file }) => {
      console.log(SHADOW_TAG, 'sendMaterial_skipped', { runId, fileId: file.id, category: file.category });
      return { sent: false };
    },
    sendEmergencyHandoffText: async () => {
      console.log(SHADOW_TAG, 'sendEmergencyHandoffText_skipped', { runId });
      return { success: false, error: 'shadow_mode_skipped' };
    },
    insertAssistantMessage: async () => {
      console.log(SHADOW_TAG, 'insertAssistantMessage_skipped', { runId });
      return null;
    },
    assignBroker: async (args) => {
      console.log(SHADOW_TAG, 'assignBroker_skipped', { runId, conversationId: args.conversationId });
      return null;
    },
    sendWhatsappText: async () => {
      console.log(SHADOW_TAG, 'sendWhatsappText_skipped', { runId });
      return { success: false, error: 'shadow_mode_skipped' };
    },
    persistCommercialFlowState: async () => {
      console.log(SHADOW_TAG, 'persistCommercialFlowState_skipped', { runId });
    },
  };
}

export interface RunAnaGraphShadowParams {
  conversationId: number;
  contactId: number | string | null;
  enterpriseId: number | null;
  userMessage: string;
  metaMessageId: string | null;
  phoneNumberId: string | null;
}

/**
 * Roda o grafo novo em paralelo ao motor legado, apenas para log/comparação
 * (fase 10). Nunca deve lançar para o chamador — qualquer erro é capturado e
 * logado como parte do próprio experimento.
 */
export async function runAnaGraphShadow(params: RunAnaGraphShadowParams): Promise<void> {
  if (!isAnaGraphShadowEnabled()) return;

  const runId = randomUUID();
  const startedAt = Date.now();
  console.log(SHADOW_TAG, 'run_start', {
    runId,
    conversationId: params.conversationId,
    metaMessageId: params.metaMessageId,
  });

  try {
    const app = compileAnaGraph(buildShadowDeps(runId));
    const result = await app.invoke(
      {
        conversationId: params.conversationId,
        contactId: params.contactId,
        enterpriseId: params.enterpriseId,
        userMessage: params.userMessage,
        metaMessageId: params.metaMessageId,
        phoneNumberId: params.phoneNumberId,
      },
      { configurable: { thread_id: String(params.conversationId) } }
    );
    console.log(SHADOW_TAG, 'run_complete', {
      runId,
      conversationId: params.conversationId,
      durationMs: Date.now() - startedAt,
      automationBlockedByHandoff: result.automationBlockedByHandoff,
      wouldSendText: result.assistantReplyText,
      primaryAxis: result.lastDecision?.primaryAxis ?? null,
    });
  } catch (error) {
    console.error(SHADOW_TAG, 'run_error', {
      runId,
      conversationId: params.conversationId,
      durationMs: Date.now() - startedAt,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }
}
