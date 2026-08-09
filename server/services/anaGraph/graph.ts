import { StateGraph, START, END } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { getPool } from '../../db/pg.js';
import { getConversationById, type ConversationRow } from '../../repositories/conversationRepository.js';
import { getEnterpriseById } from '../../repositories/enterpriseRepository.js';
import { AnaGraphStateAnnotation, type AnaGraphState } from './state.js';
import { automationGateNode } from './nodes/automationGate.js';
import { resolveEnterpriseNode } from './nodes/resolveEnterprise.js';
import { classifyLeadTurnNode } from './nodes/classifyLeadTurn.js';
import {
  decisionPolicyNode,
  routeAfterDecisionPolicy,
  type DecisionPolicyNodeExternalInput,
} from './nodes/decisionPolicy.js';
import { visitSchedulingNode, type PersistAppointmentFn } from './nodes/visitScheduling.js';
import { sendMaterialNode, type SendMaterialFn } from './nodes/sendMaterial.js';
import { ragAnswerNode, type RagAnswerNodeParams } from './nodes/ragAnswer.js';
import { knowledgeGapReplyNode, type KnowledgeGapReplyNodeParams } from './nodes/knowledgeGapReply.js';
import {
  humanHandoffNode,
  type SendEmergencyHandoffTextFn,
  type InsertAssistantMessageFn,
  type AssignBrokerFn,
} from './nodes/humanHandoff.js';
import { finalizeReplyNode, type FinalizeReplyNodeParams } from './nodes/finalizeReply.js';
import { sendWhatsappNode, type SendWhatsappTextFn } from './nodes/sendWhatsapp.js';
import { persistStateNode, type PersistCommercialFlowStateFn } from './nodes/persistState.js';

/**
 * Dependências que hoje só existem como lógica embutida em
 * conversationEngine.ts (sem detector/builder exportável) — gap documentado
 * nas fases 4/5c/5d. Ficam como funções injetadas pelo chamador do grafo em
 * vez de recomputadas aqui, evitando reescrever regex de negócio às cegas.
 */
export interface AnaGraphRuntimeDeps {
  decisionPolicyExternalInput: (
    state: AnaGraphState,
    conversation: ConversationRow
  ) => Promise<DecisionPolicyNodeExternalInput>;
  ragAnswerContext: (
    state: AnaGraphState,
    conversation: ConversationRow
  ) => Promise<Pick<RagAnswerNodeParams, 'enterpriseEvidence' | 'aiConfig'>>;
  knowledgeGapContext: (
    state: AnaGraphState,
    conversation: ConversationRow
  ) => Promise<KnowledgeGapReplyNodeParams>;
  finalizeReplyContext: (state: AnaGraphState, conversation: ConversationRow) => Promise<FinalizeReplyNodeParams>;
  handoffReason: (state: AnaGraphState) => string;

  // Envio/escrita reais — sempre injetáveis, nunca chamados direto pelo grafo.
  // Ausentes aqui = os nós usam o default real (ver cada nodes/*.ts); o modo
  // sombra (fase 9) DEVE sempre fornecer mocks para os campos abaixo.
  persistAppointment?: PersistAppointmentFn;
  sendMaterial: SendMaterialFn;
  sendEmergencyHandoffText: SendEmergencyHandoffTextFn;
  insertAssistantMessage: InsertAssistantMessageFn;
  assignBroker?: AssignBrokerFn;
  sendWhatsappText?: SendWhatsappTextFn;
  persistCommercialFlowState?: PersistCommercialFlowStateFn;
}

async function loadConversationOrThrow(conversationId: number): Promise<ConversationRow> {
  const conversation = await getConversationById(conversationId);
  if (!conversation) throw new Error(`[anaGraph] conversation ${conversationId} not found`);
  return conversation;
}

export function buildAnaGraph(deps: AnaGraphRuntimeDeps) {
  const graph = new StateGraph(AnaGraphStateAnnotation)
    .addNode('automationGate', (state) => automationGateNode(state))
    .addNode('resolveEnterprise', async (state) => {
      const conversation = await loadConversationOrThrow(state.conversationId);
      return resolveEnterpriseNode(state, conversation);
    })
    .addNode('loadTurnContext', async (state) => {
      const conversation = await loadConversationOrThrow(state.conversationId);
      const enterprise = state.enterpriseId != null ? await getEnterpriseById(state.enterpriseId) : null;
      return {
        customerName: conversation.customer_name ?? null,
        customerPhone: conversation.contact_phone ?? null,
        conversationType: conversation.conversation_type ?? null,
        enterpriseName: enterprise?.name ?? null,
        enterpriseCity: enterprise?.city ?? null,
      };
    })
    .addNode('classifyLeadTurn', async (state) => {
      const conversation = await loadConversationOrThrow(state.conversationId);
      const { leadClassifierDecision: _decision, ...patch } = await classifyLeadTurnNode(state, conversation);
      return patch;
    })
    .addNode('decisionPolicy', async (state) => {
      const conversation = await loadConversationOrThrow(state.conversationId);
      const external = await deps.decisionPolicyExternalInput(state, conversation);
      const decision = decisionPolicyNode(state, external);
      return { lastDecision: decision };
    })
    .addNode('visitScheduling', (state) =>
      visitSchedulingNode(state, {
        conversationId: state.conversationId,
        enterpriseId: state.enterpriseId,
        enterpriseCity: state.enterpriseCity ?? '',
        customerName: state.customerName,
        customerPhone: state.customerPhone,
        persistAppointment: deps.persistAppointment,
      })
    )
    .addNode('sendMaterial', (state) =>
      sendMaterialNode(state, {
        conversationId: state.conversationId,
        enterpriseId: state.enterpriseId,
        customerPhone: state.customerPhone ?? '',
        sendMaterial: deps.sendMaterial,
      })
    )
    .addNode('ragAnswer', async (state) => {
      if (state.enterpriseId == null) return { assistantReplyText: null };
      const conversation = await loadConversationOrThrow(state.conversationId);
      const ctx = await deps.ragAnswerContext(state, conversation);
      return ragAnswerNode(state, {
        conversationId: state.conversationId,
        contactId: state.contactId,
        enterpriseId: state.enterpriseId,
        enterpriseName: state.enterpriseName ?? '',
        enterpriseEvidence: ctx.enterpriseEvidence,
        aiConfig: ctx.aiConfig,
      });
    })
    .addNode('knowledgeGapReply', async (state) => {
      const conversation = await loadConversationOrThrow(state.conversationId);
      const ctx = await deps.knowledgeGapContext(state, conversation);
      return knowledgeGapReplyNode(state, ctx);
    })
    .addNode('humanHandoff', (state) =>
      humanHandoffNode(state, {
        conversationId: state.conversationId,
        toPhoneNumber: state.customerPhone ?? '',
        reason: deps.handoffReason(state),
        sendTextMessage: deps.sendEmergencyHandoffText,
        insertAssistantMessage: deps.insertAssistantMessage,
        assignBroker: deps.assignBroker,
      })
    )
    .addNode('finalizeReply', async (state) => {
      const conversation = await loadConversationOrThrow(state.conversationId);
      const ctx = await deps.finalizeReplyContext(state, conversation);
      return finalizeReplyNode(state, ctx);
    })
    .addNode('sendWhatsapp', (state) =>
      sendWhatsappNode(state, {
        conversationId: state.conversationId,
        toPhoneNumber: state.customerPhone ?? '',
        phase: 'ana_graph_turn',
        sendText: deps.sendWhatsappText,
      })
    )
    .addNode('persistState', (state) =>
      persistStateNode(state, {
        conversationId: state.conversationId,
        persist: deps.persistCommercialFlowState,
      })
    )
    .addEdge(START, 'automationGate')
    .addConditionalEdges('automationGate', (state) => (state.automationBlockedByHandoff ? END : 'resolveEnterprise'), {
      resolveEnterprise: 'resolveEnterprise',
      [END]: END,
    })
    .addEdge('resolveEnterprise', 'loadTurnContext')
    .addEdge('loadTurnContext', 'classifyLeadTurn')
    .addEdge('classifyLeadTurn', 'decisionPolicy')
    .addConditionalEdges(
      'decisionPolicy',
      (state) => (state.lastDecision ? routeAfterDecisionPolicy(state.lastDecision) : 'humanHandoff'),
      {
        visitScheduling: 'visitScheduling',
        sendMaterial: 'sendMaterial',
        ragAnswer: 'ragAnswer',
        knowledgeGapReply: 'knowledgeGapReply',
        humanHandoff: 'humanHandoff',
      }
    )
    .addEdge('visitScheduling', 'finalizeReply')
    .addEdge('sendMaterial', 'finalizeReply')
    .addEdge('ragAnswer', 'finalizeReply')
    .addEdge('knowledgeGapReply', 'finalizeReply')
    .addEdge('humanHandoff', 'finalizeReply')
    .addEdge('finalizeReply', 'sendWhatsapp')
    .addEdge('sendWhatsapp', 'persistState')
    .addEdge('persistState', END);

  return graph;
}

/**
 * Checkpointer Postgres usando o mesmo pool de conexão de db/pg.ts.
 * `.setup()` cria as tabelas de controle do LangGraph — deve ser chamado
 * explicitamente uma vez (nunca automaticamente no import) para não aplicar
 * schema novo sem intenção clara do chamador.
 */
export function createAnaGraphCheckpointer(): PostgresSaver {
  return new PostgresSaver(getPool());
}

export function compileAnaGraph(deps: AnaGraphRuntimeDeps, checkpointer?: PostgresSaver) {
  const graph = buildAnaGraph(deps);
  return graph.compile({ checkpointer: checkpointer ?? createAnaGraphCheckpointer() });
}
