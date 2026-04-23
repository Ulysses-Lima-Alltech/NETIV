import type { RequestedProductType } from './anaRequestedProductType.js';
import type { CommercialAxis } from './anaCommercialAxisGuard.js';
import { hasAnaEvidenceForNeed, type AnaEnterpriseEvidence } from './anaEnterpriseEvidence.js';

export const ANA_DECISION_POLICY_VERSION = 'v1';

export const ANA_MISSING_INFORMATION_REPLY =
  'Essa informação eu não tenho aqui agora, mas vou buscar e te retorno com os detalhes o quanto antes. Enquanto isso, posso te ajudar com outras informações?';

export type AnaDecisionResponseMode = 'short' | 'structured';

export interface AnaDecisionPolicyInput {
  detectedIntent: string | null;
  requestedAxis: CommercialAxis | null;
  requestedProductType: RequestedProductType;
  enterpriseResolved: boolean;
  enterpriseId: number | null;
  enterpriseEvidence: AnaEnterpriseEvidence;
  conversationContext: {
    phase: string;
    historyCount: number;
    hasOpenAppointment: boolean;
  };
  turnFlags: {
    isBareGreeting: boolean;
    isShortFollowUp: boolean;
    isFirstAnaReply: boolean;
    explicitMaterialRequest: boolean;
    explicitExactLocationRequest: boolean;
    explicitPaymentSimulationRequest: boolean;
    asksListStyleInfo: boolean;
    asksSpecificInfoWithoutEvidence: boolean;
  };
  userMessage: string;
}

export interface AnaDecisionPolicyResult {
  policyVersion: string;
  resolvedIntent: string;
  canRespond: boolean;
  shouldAskQuestion: boolean;
  shouldSendMaterial: boolean;
  shouldCreateInfoGapFlag: boolean;
  shouldSuggestVisit: boolean;
  responseMode: AnaDecisionResponseMode;
  primaryAxis: CommercialAxis | 'material' | 'geral';
  canMentionExactLocation: boolean;
  canMentionPaymentSimulation: boolean;
  outboundAllowed: boolean;
  blockedReason: string | null;
  shouldUseMissingInformationReply: boolean;
  shouldUsePaymentSimulationRedirect: boolean;
  missingInformationSubject: string | null;
}

function norm(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function detectExplicitExactLocationRequest(userMessage: string): boolean {
  const n = norm(userMessage);
  if (!n) return false;
  return (
    /\b(endereco|endereco exato|localizacao exata|rua|avenida|numero|cep|mapa|google maps|pin)\b/.test(n) ||
    /\b(onde fica exatamente|qual o endereco|passa o endereco)\b/.test(n)
  );
}

export function detectExplicitPaymentSimulationRequest(userMessage: string): boolean {
  const n = norm(userMessage);
  if (!n) return false;
  return (
    /\b(simulac|simular|pre simulac|cenario financeiro|fluxo de pagamento)\b/.test(n) ||
    /\b(entrada|parcela|parcelas|prazo|juros|desconto)\b/.test(n)
  );
}

export function detectStructuredListIntent(
  userMessage: string,
  requestedAxis: CommercialAxis | null
): boolean {
  const n = norm(userMessage);
  if (!n) return false;
  if (requestedAxis === 'lazer') return true;
  return (
    /\b(lista|quais|itens|diferenciais|amenidades|lazer|opcoes|comparar)\b/.test(n) ||
    /\b(me mostra|quero ver)\b/.test(n)
  );
}

function detectVisitOpportunity(params: {
  userMessage: string;
  requestedAxis: CommercialAxis | null;
  enterpriseResolved: boolean;
  hasOpenAppointment: boolean;
  conversationPhase: string;
  historyCount: number;
}): boolean {
  if (!params.enterpriseResolved || params.hasOpenAppointment) return false;
  const n = norm(params.userMessage);
  if (!n) return false;
  if (params.requestedAxis === 'visita_agendamento') return true;

  // Evita sugerir visita cedo demais: exige algum contexto de maturidade.
  const contextLooksMature =
    params.historyCount >= 2 ||
    params.conversationPhase === 'scoped' ||
    params.conversationPhase === 'appointment';
  if (!contextLooksMature) return false;

  return (
    /\b(visitar|visita|conhecer pessoalmente|agendar)\b/.test(n) ||
    /\b(gostei|tenho interesse|quero fechar|quero avancar)\b/.test(n)
  );
}

function resolveMissingInformationSubject(params: {
  requestedAxis: CommercialAxis | null;
  turnFlags: AnaDecisionPolicyInput['turnFlags'];
  evidence: AnaEnterpriseEvidence;
}): string | null {
  const { requestedAxis, turnFlags, evidence } = params;
  if (!turnFlags.asksSpecificInfoWithoutEvidence) return null;

  if (turnFlags.explicitExactLocationRequest && !hasAnaEvidenceForNeed(evidence, 'localizacao_exata')) {
    // Com localizacao generica valida, responde com limite em vez de fallback de lacuna.
    if (hasAnaEvidenceForNeed(evidence, 'localizacao')) return null;
    return 'localizacao_exata';
  }
  if (requestedAxis === 'preco' && !hasAnaEvidenceForNeed(evidence, 'preco')) {
    return 'preco';
  }
  if (requestedAxis === 'financiamento' && !hasAnaEvidenceForNeed(evidence, 'financiamento')) {
    return 'financiamento';
  }
  if (requestedAxis != null && !hasAnaEvidenceForNeed(evidence, requestedAxis)) {
    return requestedAxis;
  }
  return null;
}

function resolvePrimaryAxis(input: AnaDecisionPolicyInput): AnaDecisionPolicyResult['primaryAxis'] {
  if (input.turnFlags.explicitMaterialRequest) return 'material';
  if (input.requestedAxis) return input.requestedAxis;
  return 'geral';
}

export function buildAnaDecisionPolicy(input: AnaDecisionPolicyInput): AnaDecisionPolicyResult {
  const primaryAxis = resolvePrimaryAxis(input);
  const responseMode: AnaDecisionResponseMode = input.turnFlags.asksListStyleInfo ? 'structured' : 'short';
  const shouldSendMaterial =
    input.turnFlags.explicitMaterialRequest &&
    input.enterpriseResolved &&
    hasAnaEvidenceForNeed(input.enterpriseEvidence, 'material');

  const missingInformationSubject = resolveMissingInformationSubject({
    requestedAxis: input.requestedAxis,
    turnFlags: input.turnFlags,
    evidence: input.enterpriseEvidence,
  });
  const shouldUseMissingInformationReply = missingInformationSubject != null;
  const shouldCreateInfoGapFlag = shouldUseMissingInformationReply;
  const canMentionExactLocation = hasAnaEvidenceForNeed(input.enterpriseEvidence, 'localizacao_exata');
  const canMentionPaymentSimulation = false;
  const shouldUsePaymentSimulationRedirect = input.turnFlags.explicitPaymentSimulationRequest;

  const blockedReason = input.userMessage.trim() ? null : 'empty_user_message';
  const canRespond = blockedReason == null;
  const outboundAllowed = canRespond;
  const shouldSuggestVisit = detectVisitOpportunity({
    userMessage: input.userMessage,
    requestedAxis: input.requestedAxis,
    enterpriseResolved: input.enterpriseResolved,
    hasOpenAppointment: input.conversationContext.hasOpenAppointment,
    conversationPhase: input.conversationContext.phase,
    historyCount: input.conversationContext.historyCount,
  });
  const shouldAskQuestion = shouldUseMissingInformationReply;

  return {
    policyVersion: ANA_DECISION_POLICY_VERSION,
    resolvedIntent: input.detectedIntent || (input.requestedAxis ?? 'geral'),
    canRespond,
    shouldAskQuestion,
    shouldSendMaterial,
    shouldCreateInfoGapFlag,
    shouldSuggestVisit,
    responseMode,
    primaryAxis,
    canMentionExactLocation,
    canMentionPaymentSimulation,
    outboundAllowed,
    blockedReason,
    shouldUseMissingInformationReply,
    shouldUsePaymentSimulationRedirect,
    missingInformationSubject,
  };
}
