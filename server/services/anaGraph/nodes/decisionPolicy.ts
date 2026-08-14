import {
  buildAnaDecisionPolicy,
  type AnaDecisionPolicyInput,
  type AnaDecisionPolicyResult,
} from '../../../utils/anaDecisionPolicy.js';
import { inferRequestedProductType } from '../../../utils/anaRequestedProductType.js';
import { isBareGreetingOnly } from '../../../utils/anaDocSendIntent.js';
import type { AnaEnterpriseEvidence } from '../../../utils/anaEnterpriseEvidence.js';
import type { CommercialAxis } from '../../../utils/anaCommercialAxisGuard.js';
import type { AnaShortConfirmationKind } from '../../../utils/anaShortConfirmationContext.js';
import type { AnaGraphState } from '../state.js';

/**
 * Montado por buildDecisionContextNode (buildDecisionContext.ts), reaproveitando
 * os mesmos detectores exportados que o motor legado usa (inferUserRequestedAxis,
 * detectExplicitExactLocationRequest, buildAnaEnterpriseEvidence, etc.) — sem
 * regex de negócio nova. Continua como parâmetro explícito do nó (em vez de
 * chamado direto aqui) para manter decisionPolicyNode puro/testável isoladamente.
 *
 * Gaps remanescentes documentados em buildDecisionContext.ts: `enterpriseEvidence
 * .knowledgeText` fica vazio (depende do subsistema de RAG, não é função pura) e
 * `conversationContext.phase` é uma aproximação simplificada.
 */
export interface DecisionPolicyNodeExternalInput {
  requestedAxis: CommercialAxis | null;
  lastAxis: CommercialAxis | null;
  enterpriseResolved: boolean;
  enterpriseEvidence: AnaEnterpriseEvidence;
  conversationContext: {
    phase: string;
    historyCount: number;
    hasOpenAppointment: boolean;
  };
  conversationContextText: string;
  detectedIntent: string | null;
  isShortFollowUp: boolean;
  isFirstAnaReply: boolean;
  explicitMaterialRequest: boolean;
  explicitExactLocationRequest: boolean;
  explicitPaymentSimulationRequest: boolean;
  asksListStyleInfo: boolean;
  asksSpecificInfoWithoutEvidence: boolean;
  lastAssistantMessage: string | null;
  confirmationContext: {
    kind: AnaShortConfirmationKind;
    isShortConfirmation: boolean;
  } | null;
}

export function decisionPolicyNode(
  state: AnaGraphState,
  external: DecisionPolicyNodeExternalInput
): AnaDecisionPolicyResult {
  const requestedProductType = inferRequestedProductType(state.userMessage, external.conversationContextText);
  const isBareGreeting = isBareGreetingOnly(state.userMessage);

  const input: AnaDecisionPolicyInput = {
    detectedIntent: external.detectedIntent,
    requestedAxis: external.requestedAxis,
    lastAxis: external.lastAxis,
    requestedProductType,
    enterpriseResolved: external.enterpriseResolved,
    enterpriseId: state.enterpriseId,
    enterpriseEvidence: external.enterpriseEvidence,
    conversationContext: external.conversationContext,
    turnFlags: {
      isBareGreeting,
      isShortFollowUp: external.isShortFollowUp,
      isFirstAnaReply: external.isFirstAnaReply,
      explicitMaterialRequest: external.explicitMaterialRequest,
      explicitExactLocationRequest: external.explicitExactLocationRequest,
      explicitPaymentSimulationRequest: external.explicitPaymentSimulationRequest,
      asksListStyleInfo: external.asksListStyleInfo,
      asksSpecificInfoWithoutEvidence: external.asksSpecificInfoWithoutEvidence,
    },
    userMessage: state.userMessage,
    flowState: state.commercialFlowState,
    lastAssistantMessage: external.lastAssistantMessage,
    confirmationContext: external.confirmationContext,
  };

  return buildAnaDecisionPolicy(input);
}

/** Edge condicional: decide o próximo nó de ramificação (fase 5) a partir do resultado da política. */
export function routeAfterDecisionPolicy(
  decision: AnaDecisionPolicyResult
): 'visitScheduling' | 'sendMaterial' | 'ragAnswer' | 'knowledgeGapReply' | 'humanHandoff' {
  if (decision.primaryAxis === 'visita_agendamento' || decision.hasDirectVisitSchedulingIntent) return 'visitScheduling';
  if (decision.shouldSendMaterial || decision.primaryAxis === 'material') return 'sendMaterial';
  if (decision.shouldCreateInfoGapFlag || !decision.evidenceFound) return 'knowledgeGapReply';
  if (!decision.canRespond || !decision.outboundAllowed) return 'humanHandoff';
  return 'ragAnswer';
}
