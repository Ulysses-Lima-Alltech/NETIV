import { StateGraph, START, END, type BaseCheckpointSaver } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { getPool } from '../../db/pg.js';
import { getConversationById, type ConversationRow } from '../../repositories/conversationRepository.js';
import { getEnterpriseById } from '../../repositories/enterpriseRepository.js';
import { AnaGraphStateAnnotation, type AnaGraphState } from './state.js';
import { automationGateNode } from './nodes/automationGate.js';
import { resolveEnterpriseNode } from './nodes/resolveEnterprise.js';
import { classifyLeadTurnNode } from './nodes/classifyLeadTurn.js';
import { decisionPolicyNode, routeAfterDecisionPolicy } from './nodes/decisionPolicy.js';
import { buildDecisionContextNode } from './nodes/buildDecisionContext.js';
import { visitSchedulingNode, type PersistAppointmentFn } from './nodes/visitScheduling.js';
import { sendMaterialNode, type SendMaterialFn } from './nodes/sendMaterial.js';
import { ragAnswerNode, type RagAnswerNodeParams } from './nodes/ragAnswer.js';
import { knowledgeGapReplyNode, type KnowledgeGapReplyNodeParams } from './nodes/knowledgeGapReply.js';
import {
  humanHandoffNode,
  type SendEmergencyHandoffTextFn,
  type InsertAssistantMessageFn,
  type AssignBrokerFn,
  type UpdateHandoffClassificationFn,
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
  updateHandoffClassification?: UpdateHandoffClassificationFn;
  sendWhatsappText?: SendWhatsappTextFn;
  persistCommercialFlowState?: PersistCommercialFlowStateFn;
}

/**
 * Roteamento estrutural pós-nó de ramificação: só segue adiante quando há
 * texto real pra enviar, ou quando a ausência de texto é intencional
 * (replyIntentionallyEmpty — ex.: sendMaterial já respondeu via mídia).
 * Qualquer outro "sem resposta" vira humanHandoff em vez de silêncio puro.
 */
export function routeAfterReplyOrHandoff(state: AnaGraphState): 'finalizeReply' | 'humanHandoff' {
  return state.assistantReplyText != null || state.replyIntentionallyEmpty ? 'finalizeReply' : 'humanHandoff';
}

/** Mesma regra que routeAfterReplyOrHandoff, mas pro destino pós-finalizeReply (sendWhatsapp em vez de finalizeReply). */
export function routeAfterFinalizeReply(state: AnaGraphState): 'sendWhatsapp' | 'humanHandoff' {
  return state.assistantReplyText != null || state.replyIntentionallyEmpty ? 'sendWhatsapp' : 'humanHandoff';
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
      const external = await buildDecisionContextNode(state, conversation);
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
        updateHandoffClassification: deps.updateHandoffClassification,
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
    // sendMaterial pode legitimamente não ter texto (mídia já enviada é a
    // resposta) — routeAfterReplyOrHandoff só rotea pra handoff quando
    // replyIntentionallyEmpty for false, isto é, quando de fato não
    // conseguiu responder.
    .addConditionalEdges('sendMaterial', routeAfterReplyOrHandoff, {
      finalizeReply: 'finalizeReply',
      humanHandoff: 'humanHandoff',
    })
    // ragAnswer/knowledgeGapReply: contrato é sempre "responde com texto real
    // ou falha" — null aqui é sempre "não sabemos responder", nunca ok.
    .addConditionalEdges('ragAnswer', routeAfterReplyOrHandoff, {
      finalizeReply: 'finalizeReply',
      humanHandoff: 'humanHandoff',
    })
    .addConditionalEdges('knowledgeGapReply', routeAfterReplyOrHandoff, {
      finalizeReply: 'finalizeReply',
      humanHandoff: 'humanHandoff',
    })
    // humanHandoff sempre produz um texto fixo pré-aprovado (ANA_EMERGENCY_HANDOFF_MESSAGE)
    // — vai direto pro envio, sem passar de novo por finalizeReply (evita ciclo
    // finalizeReply -> humanHandoff -> finalizeReply e sanitização desnecessária
    // de uma mensagem operacional já controlada).
    .addEdge('humanHandoff', 'sendWhatsapp')
    // finalizeReply pode zerar um rascunho não vazio (guard de segurança/tamanho) —
    // isso também é "não conseguimos responder com segurança", vira handoff.
    .addConditionalEdges('finalizeReply', routeAfterFinalizeReply, {
      sendWhatsapp: 'sendWhatsapp',
      humanHandoff: 'humanHandoff',
    })
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

export function compileAnaGraph(deps: AnaGraphRuntimeDeps, checkpointer?: BaseCheckpointSaver) {
  const graph = buildAnaGraph(deps);
  return graph.compile({ checkpointer: checkpointer ?? createAnaGraphCheckpointer() });
}
