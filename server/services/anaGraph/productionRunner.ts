import { randomUUID } from 'crypto';
import { compileAnaGraph } from './graph.js';
import { buildProductionDeps } from './productionDeps.js';

const PROD_TAG = '[ANA_GRAPH_PRODUCTION]';

export interface RunAnaGraphProductionParams {
  conversationId: number;
  contactId: number | string | null;
  enterpriseId: number | null;
  userMessage: string;
  metaMessageId: string | null;
  phoneNumberId: string | null;
}

/**
 * Roda o grafo novo respondendo o cliente de verdade — só deve ser chamado
 * quando isAnaGraphProductionEnabledForEnterprise(enterpriseId) já foi
 * checado pelo chamador (productionRollout.ts). Usa o checkpointer real
 * (PostgresSaver, via compileAnaGraph sem argumento) com thread_id estável
 * por conversa (String(conversationId)) — o LangGraph resolve a
 * continuidade de commercialFlowState entre turnos sozinho a partir daí;
 * automationGateNode ainda hidrata a partir de
 * conversations.commercial_flow_state no primeiro turno em que o grafo
 * assume uma conversa que já existia (ver nodes/automationGate.ts).
 *
 * Nunca deve lançar para o chamador — qualquer erro aqui significa que o
 * turno fica sem resposta (pior caso), então erro é logado e reportado
 * como não-tratado pro chamador decidir o fallback (hoje: nenhum, mas o
 * chamador pode optar por cair pro motor legado nesse caso específico).
 */
export async function runAnaGraphProduction(
  params: RunAnaGraphProductionParams
): Promise<{ handled: boolean; error: string | null }> {
  const runId = randomUUID();
  const startedAt = Date.now();
  console.log(PROD_TAG, 'run_start', {
    runId,
    conversationId: params.conversationId,
    metaMessageId: params.metaMessageId,
  });

  try {
    const app = compileAnaGraph(buildProductionDeps());
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
    console.log(PROD_TAG, 'run_complete', {
      runId,
      conversationId: params.conversationId,
      durationMs: Date.now() - startedAt,
      automationBlockedByHandoff: result.automationBlockedByHandoff,
      sentText: result.assistantReplyText != null,
      primaryAxis: result.lastDecision?.primaryAxis ?? null,
    });
    return { handled: true, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(PROD_TAG, 'run_error', {
      runId,
      conversationId: params.conversationId,
      durationMs: Date.now() - startedAt,
      errorMessage: message,
    });
    return { handled: false, error: message };
  }
}
