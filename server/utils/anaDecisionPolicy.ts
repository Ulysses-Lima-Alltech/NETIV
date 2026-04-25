import type { RequestedProductType } from './anaRequestedProductType.js';
import type { CommercialAxis } from './anaCommercialAxisGuard.js';
import { hasAnaEvidenceForNeed, type AnaEnterpriseEvidence } from './anaEnterpriseEvidence.js';

export const ANA_DECISION_POLICY_VERSION = 'v2';

export const ANA_MISSING_INFORMATION_REPLY =
  'No momento nao localizei essa informacao especifica. Posso te ajudar com outras informacoes do empreendimento.';

export type AnaDecisionResponseMode = 'short' | 'structured';
export type AnaDecisionCurrentAxis = CommercialAxis | 'material' | 'geral' | 'outro';

export interface AnaDecisionPolicyInput {
  detectedIntent: string | null;
  requestedAxis: CommercialAxis | null;
  lastAxis?: CommercialAxis | null;
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
  detectedIntent: string | null;
  currentAxis: AnaDecisionCurrentAxis;
  lastAxis: CommercialAxis | null;
  isDirectInfoRequest: boolean;
  isGenericOpenQuestion: boolean;
  isRepeatOfLastAxis: boolean;
  isAskingForMoreOnSameAxis: boolean;
  evidenceFound: boolean;
  shouldAnswerDirectly: boolean;
  shouldAskClarifyingQuestion: boolean;
  shouldAvoidGenericFallback: boolean;
}

function norm(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isCommercialAxis(axis: AnaDecisionCurrentAxis | null | undefined): axis is CommercialAxis {
  return (
    axis === 'preco' ||
    axis === 'metragem_tipologia' ||
    axis === 'localizacao' ||
    axis === 'lazer' ||
    axis === 'financiamento' ||
    axis === 'disponibilidade' ||
    axis === 'visita_agendamento' ||
    axis === 'intencao_compra'
  );
}

function detectAxisFallbackFromMessage(userMessage: string): CommercialAxis | null {
  const n = norm(userMessage);
  if (!n) return null;

  if (/\b(quanto|custa|valor|preco|r\$)\b/.test(n)) return 'preco';
  if (
    /\b(metragem|tamanho|quantos metros|m2|m²|metros quadrados|area do lote|area do apartamento|area util)\b/.test(
      n
    )
  ) {
    return 'metragem_tipologia';
  }
  if (/\b(onde fica|localizacao|endereco|bairro|cidade|regiao|proximo)\b/.test(n)) return 'localizacao';
  if (/\b(lazer|areas de lazer|area de lazer|amenidades|areas comuns|piscina|academia)\b/.test(n)) return 'lazer';
  if (
    /\b(formas de pagamento|forma de pagamento|pagamento|financiamento|condicao de pagamento|condicoes de pagamento|parcelamento|parcela|entrada)\b/.test(
      n
    )
  ) {
    return 'financiamento';
  }
  if (/\b(disponibilidade|tem unidade|unidades disponiveis)\b/.test(n)) return 'disponibilidade';
  if (/\b(visita|agendar|agendamento)\b/.test(n)) return 'visita_agendamento';
  if (/\b(morar|investir|investimento|moradia)\b/.test(n)) return 'intencao_compra';
  return null;
}

function detectAskingForMoreOnSameAxis(userMessage: string): boolean {
  const n = norm(userMessage);
  if (!n) return false;
  if (/^(mais|tem mais|tem outras|outras)\??$/.test(n)) return true;
  return (
    /\b(tem mais|mais alguma|mais algum|mais areas?|tem outras?|outras opcoes|outros itens)\b/.test(n) ||
    /\b(quero mais|tem mais informacao|tem mais detalhes)\b/.test(n)
  );
}

function detectGenericOpenQuestion(userMessage: string): boolean {
  const n = norm(userMessage);
  if (!n) return false;
  return (
    /\b(quero saber mais|me fala mais|me fale mais|mais informacoes|mais detalhes|me explica|explica melhor)\b/.test(
      n
    ) ||
    /\b(o que voce tem|quais opcoes|me conta mais)\b/.test(n)
  );
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
    /\b(lista|quais|itens|diferenciais|amenidades|lazer|opcoes|comparar|areas|area comum|areas comuns)\b/.test(n) ||
    /\b(tem mais|mais areas|mais area|tem outras|outras areas|outros itens)\b/.test(n) ||
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

function resolveCurrentAxis(input: AnaDecisionPolicyInput): AnaDecisionCurrentAxis {
  if (input.turnFlags.explicitMaterialRequest) return 'material';
  if (input.requestedAxis != null) return input.requestedAxis;

  const asksMore = detectAskingForMoreOnSameAxis(input.userMessage);
  if (asksMore && input.lastAxis != null) return input.lastAxis;

  const fallbackAxis = detectAxisFallbackFromMessage(input.userMessage);
  if (fallbackAxis != null) return fallbackAxis;

  if (detectGenericOpenQuestion(input.userMessage) || input.turnFlags.isShortFollowUp) return 'geral';
  return 'outro';
}

function resolveEvidenceFound(axis: AnaDecisionCurrentAxis, evidence: AnaEnterpriseEvidence): boolean {
  if (axis === 'material') return hasAnaEvidenceForNeed(evidence, 'material');
  if (axis === 'geral' || axis === 'outro') return evidence.hasUsableKnowledgeChunks;
  return hasAnaEvidenceForNeed(evidence, axis);
}

function resolveMissingInformationSubject(params: {
  currentAxis: AnaDecisionCurrentAxis;
  turnFlags: AnaDecisionPolicyInput['turnFlags'];
  evidence: AnaEnterpriseEvidence;
  isDirectInfoRequest: boolean;
  evidenceFound: boolean;
}): string | null {
  const { currentAxis, turnFlags, evidence, isDirectInfoRequest, evidenceFound } = params;
  if (!isDirectInfoRequest) return null;

  if (turnFlags.explicitExactLocationRequest && !hasAnaEvidenceForNeed(evidence, 'localizacao_exata')) {
    if (hasAnaEvidenceForNeed(evidence, 'localizacao')) return null;
    return 'localizacao_exata';
  }
  if (currentAxis === 'material') return null;
  if (evidenceFound) return null;

  if (currentAxis === 'financiamento') return 'financiamento';
  if (currentAxis === 'metragem_tipologia') return 'metragem_tipologia';
  if (isCommercialAxis(currentAxis)) return currentAxis;
  return 'geral';
}

function resolvePrimaryAxis(currentAxis: AnaDecisionCurrentAxis): AnaDecisionPolicyResult['primaryAxis'] {
  if (currentAxis === 'material') return 'material';
  if (isCommercialAxis(currentAxis)) return currentAxis;
  return 'geral';
}

export function buildAnaDecisionPolicy(input: AnaDecisionPolicyInput): AnaDecisionPolicyResult {
  const lastAxis = input.lastAxis ?? null;
  const currentAxis = resolveCurrentAxis(input);
  const primaryAxis = resolvePrimaryAxis(currentAxis);
  const asksForMoreOnSameAxis = detectAskingForMoreOnSameAxis(input.userMessage);
  const isGenericOpenQuestion = currentAxis === 'geral' || currentAxis === 'outro'
    ? detectGenericOpenQuestion(input.userMessage) || input.turnFlags.isShortFollowUp
    : false;
  const isDirectInfoRequest =
    currentAxis === 'material' ||
    isCommercialAxis(currentAxis) ||
    input.turnFlags.explicitExactLocationRequest ||
    input.turnFlags.explicitPaymentSimulationRequest;
  const isRepeatOfLastAxis = isCommercialAxis(currentAxis) && lastAxis != null && currentAxis === lastAxis;
  const isAskingForMoreOnSameAxis = asksForMoreOnSameAxis && isRepeatOfLastAxis;
  const evidenceFound = resolveEvidenceFound(currentAxis, input.enterpriseEvidence);
  const shouldSendMaterial =
    currentAxis === 'material' &&
    input.enterpriseResolved &&
    hasAnaEvidenceForNeed(input.enterpriseEvidence, 'material');

  const missingInformationSubject = resolveMissingInformationSubject({
    currentAxis,
    turnFlags: input.turnFlags,
    evidence: input.enterpriseEvidence,
    isDirectInfoRequest,
    evidenceFound,
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
    requestedAxis: isCommercialAxis(currentAxis) ? currentAxis : null,
    enterpriseResolved: input.enterpriseResolved,
    hasOpenAppointment: input.conversationContext.hasOpenAppointment,
    conversationPhase: input.conversationContext.phase,
    historyCount: input.conversationContext.historyCount,
  });
  const shouldAskClarifyingQuestion =
    !isDirectInfoRequest &&
    isGenericOpenQuestion &&
    !shouldUseMissingInformationReply &&
    !input.turnFlags.explicitMaterialRequest;
  const shouldAskQuestion = shouldAskClarifyingQuestion;
  const shouldAnswerDirectly =
    isDirectInfoRequest &&
    evidenceFound &&
    !shouldUseMissingInformationReply &&
    !shouldSendMaterial;
  const shouldAvoidGenericFallback =
    isDirectInfoRequest ||
    isRepeatOfLastAxis ||
    isAskingForMoreOnSameAxis ||
    currentAxis !== 'geral';

  const responseMode: AnaDecisionResponseMode =
    input.turnFlags.asksListStyleInfo || (currentAxis === 'lazer' && isAskingForMoreOnSameAxis)
      ? 'structured'
      : 'short';

  return {
    policyVersion: ANA_DECISION_POLICY_VERSION,
    resolvedIntent: input.detectedIntent || (isCommercialAxis(currentAxis) ? currentAxis : 'geral'),
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
    detectedIntent: input.detectedIntent,
    currentAxis,
    lastAxis,
    isDirectInfoRequest,
    isGenericOpenQuestion,
    isRepeatOfLastAxis,
    isAskingForMoreOnSameAxis,
    evidenceFound,
    shouldAnswerDirectly,
    shouldAskClarifyingQuestion,
    shouldAvoidGenericFallback,
  };
}
