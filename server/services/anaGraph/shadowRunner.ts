import { randomUUID } from 'crypto';
import { compileAnaGraph, type AnaGraphRuntimeDeps } from './graph.js';
import { getOpenAIConfig } from '../../repositories/openaiConfigRepository.js';
import type { AnaGraphState } from './state.js';
import type { ConversationRow } from '../../repositories/conversationRepository.js';
import type { DecisionPolicyNodeExternalInput } from './nodes/decisionPolicy.js';

const SHADOW_TAG = '[ANA_GRAPH_SHADOW]';

/** Flag global, nasce desligada por padrão. Nenhuma empresa é ativada automaticamente. */
export function isAnaGraphShadowEnabled(): boolean {
  return String(process.env.ANA_GRAPH_SHADOW_ENABLED ?? '').trim().toLowerCase() === 'true';
}

/**
 * turnFlags/enterpriseEvidence hoje só existem como variáveis privadas em
 * conversationEngine.ts (gap documentado desde a fase 4). Em modo sombra
 * usamos defaults conservadores — o objetivo aqui é medir se o grafo roda
 * sem erro e logar sua saída para comparação futura (fase 10), não obter
 * fidelidade total de roteamento ainda.
 */
function shadowDecisionPolicyExternalInput(): DecisionPolicyNodeExternalInput {
  return {
    requestedAxis: null,
    lastAxis: null,
    enterpriseResolved: false,
    enterpriseEvidence: {
      hasSendableBook: false,
      hasSendableFloorplan: false,
      hasAnySendableMaterial: false,
      hasExactLocation: false,
      hasPricingInfo: false,
      hasFinancingInfo: false,
      hasUsableKnowledgeChunks: false,
    },
    conversationContext: { phase: 'shadow', historyCount: 0, hasOpenAppointment: false },
    conversationContextText: '',
    detectedIntent: null,
    isShortFollowUp: false,
    isFirstAnaReply: false,
    explicitMaterialRequest: false,
    explicitExactLocationRequest: false,
    explicitPaymentSimulationRequest: false,
    asksListStyleInfo: false,
    asksSpecificInfoWithoutEvidence: false,
  };
}

/**
 * Deps do modo sombra: todo ponto de envio/escrita real recebe um mock que
 * apenas loga — nenhuma chamada real ao WhatsApp ou escrita em
 * commercial_flow_state/appointments/corretores parte daqui.
 *
 * Exceção conhecida: classifyLeadTurnNode (classifyLeadConversation) e
 * ragAnswerNode (generateChatCompletion) fazem chamadas reais à API da
 * OpenAI com custo/rastreamento real — são funções já reaproveitadas sem
 * alteração desde as fases 3 e 5c, e não têm um modo "dry run" embutido.
 * Ativar a flag roda essas chamadas para cada turno processado. Ficar
 * ciente do custo antes de ligar a flag, mesmo em empresa piloto única.
 */
function buildShadowDeps(runId: string): AnaGraphRuntimeDeps {
  return {
    decisionPolicyExternalInput: async () => shadowDecisionPolicyExternalInput(),
    ragAnswerContext: async () => {
      const aiConfig = await getOpenAIConfig();
      return {
        enterpriseEvidence: {
          hasSendableBook: false,
          hasSendableFloorplan: false,
          hasAnySendableMaterial: false,
          hasExactLocation: false,
          hasPricingInfo: false,
          hasFinancingInfo: false,
          hasUsableKnowledgeChunks: false,
        },
        aiConfig: {
          apiKey: aiConfig?.openaiApiKey ?? '',
          baseUrl: aiConfig?.openaiBaseUrl ?? null,
          model: aiConfig?.modelColdLead || 'gpt-4.1-mini',
          maxTokens: aiConfig?.maxTokens ?? 500,
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
