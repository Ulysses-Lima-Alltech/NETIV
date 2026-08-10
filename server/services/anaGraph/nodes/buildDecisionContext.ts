import type { ConversationRow } from '../../../repositories/conversationRepository.js';
import { getRecentConversationMessages } from '../../../repositories/messageRepository.js';
import { getEnterpriseById } from '../../../repositories/enterpriseRepository.js';
import { listEnterpriseFiles, getVariablesMap } from '../../../repositories/enterpriseRepository.js';
import { findOpenAppointmentForConversationAndEnterprise } from '../../../repositories/appointmentRepository.js';
import { getLastAnaTurnAuditByConversation } from '../../../repositories/anaTurnAuditRepository.js';
import { computeAppointmentPreflight, buildUserUtterancesContext } from '../../../utils/anaAppointmentIntent.js';
import { inferUserRequestedAxis } from '../../../utils/anaCommercialAxisGuard.js';
import { inferAxisFromAssistantText, isCommercialAxis } from '../../../utils/anaCommercialAxisDetection.js';
import { isShortGenericFollowUpMessage } from '../../../utils/anaFollowupContinuationDetection.js';
import { userExplicitlyAskedForMaterial, isBareGreetingOnly } from '../../../utils/anaDocSendIntent.js';
import {
  detectExplicitExactLocationRequest,
  detectExplicitPaymentSimulationRequest,
  detectStructuredListIntent,
} from '../../../utils/anaDecisionPolicy.js';
import { buildAnaEnterpriseEvidence } from '../../../utils/anaEnterpriseEvidence.js';
import { loadRankedKnowledgeChunksForPromptWithMeta } from '../../../repositories/enterpriseKnowledgeChunkRepository.js';
import type { AnaGraphState } from '../state.js';
import type { DecisionPolicyNodeExternalInput } from './decisionPolicy.js';

/**
 * Monta o DecisionPolicyNodeExternalInput de verdade, chamando os mesmos
 * detectores exportados que o motor legado (conversationEngine.ts) usa —
 * nenhuma regex de negócio nova foi escrita aqui.
 *
 * `enterpriseEvidence.knowledgeText` vem de loadRankedKnowledgeChunksForPromptWithMeta
 * (mesma busca de chunks que ragAnswerNode já faz para montar o prompt) — mesma
 * fonte que o motor legado usa antes de chamar buildAnaEnterpriseEvidence numa
 * resposta real. Isso duplica a busca de RAG (decisionPolicy busca pra decidir
 * se há evidência, ragAnswerNode busca de novo pra montar o prompt) — consolidar
 * num único fetch compartilhado via AnaGraphState fica como otimização futura,
 * não é trivial sem também mudar a assinatura de ragAnswerNode/graph.ts.
 *
 * Gap conhecido (fidelidade parcial): `conversationContext.phase` aqui é uma
 * aproximação (`scoped` vs `triage`) — o motor legado tem um enum mais fino
 * (inactive/appointment/triage_location/triage_ask_type/triage_catalog) que
 * depende de `locationQueryContext` e `triageRequestedProductType`, ainda não
 * replicados no grafo novo.
 */
export async function buildDecisionContextNode(
  state: AnaGraphState,
  conversation: ConversationRow
): Promise<DecisionPolicyNodeExternalInput> {
  const recentMessages = await getRecentConversationMessages(conversation.id, 12);
  const isFirstAnaReply = !recentMessages.some((m) => m.role === 'assistant');
  const lastAssistantMessage = [...recentMessages].reverse().find((m) => m.role === 'assistant')?.content ?? null;
  const conversationContextText = buildUserUtterancesContext(recentMessages);

  const requestedAxis = inferUserRequestedAxis(state.userMessage);

  const previousTurnAudit = await getLastAnaTurnAuditByConversation(conversation.id);
  const lastAxisFromAudit = isCommercialAxis(previousTurnAudit?.primary_axis ?? null)
    ? (previousTurnAudit!.primary_axis as DecisionPolicyNodeExternalInput['lastAxis'])
    : null;
  const lastAxis = lastAxisFromAudit ?? inferAxisFromAssistantText(lastAssistantMessage);

  const enterprise = state.enterpriseId != null ? await getEnterpriseById(state.enterpriseId) : null;
  const files = state.enterpriseId != null ? await listEnterpriseFiles(state.enterpriseId) : [];
  const variablesMap = state.enterpriseId != null ? await getVariablesMap(state.enterpriseId) : {};
  const knowledgeText =
    state.enterpriseId != null
      ? (
          await loadRankedKnowledgeChunksForPromptWithMeta(
            state.enterpriseId,
            `${state.enterpriseName ?? ''}\n${state.userMessage}`.slice(0, 4000),
            {}
          )
        ).promptText
      : '';
  const enterpriseEvidence = buildAnaEnterpriseEvidence({
    enterprise,
    files,
    variablesMap,
    knowledgeText,
  });

  const appointmentPreflight = computeAppointmentPreflight(state.userMessage, conversationContextText);
  const openAppointment =
    state.enterpriseId != null
      ? await findOpenAppointmentForConversationAndEnterprise(conversation.id, state.enterpriseId)
      : null;
  const hasOpenAppointment = appointmentPreflight.active || openAppointment != null;

  const bareGreeting = isBareGreetingOnly(state.userMessage);
  const materialAsk = userExplicitlyAskedForMaterial(state.userMessage);
  const explicitMaterialRequest = materialAsk.explicit && !bareGreeting;
  const explicitExactLocationRequest = detectExplicitExactLocationRequest(state.userMessage);
  const explicitPaymentSimulationRequest = detectExplicitPaymentSimulationRequest(state.userMessage);
  const asksListStyleInfo = detectStructuredListIntent(state.userMessage, requestedAxis);
  const asksSpecificInfoWithoutEvidence = explicitExactLocationRequest || requestedAxis != null;

  const detectedIntent = explicitMaterialRequest
    ? 'pedir_material'
    : requestedAxis ?? (appointmentPreflight.active ? 'agendar' : 'geral');

  return {
    requestedAxis,
    lastAxis,
    enterpriseResolved: state.enterpriseId != null,
    enterpriseEvidence,
    conversationContext: {
      phase: state.enterpriseId != null ? 'scoped' : 'triage',
      historyCount: recentMessages.length,
      hasOpenAppointment,
    },
    conversationContextText,
    detectedIntent,
    isShortFollowUp: isShortGenericFollowUpMessage(state.userMessage),
    isFirstAnaReply,
    explicitMaterialRequest,
    explicitExactLocationRequest,
    explicitPaymentSimulationRequest,
    asksListStyleInfo,
    asksSpecificInfoWithoutEvidence,
  };
}
