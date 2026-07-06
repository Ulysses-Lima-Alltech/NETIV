export const EVORA_VISIT_OFFER_MESSAGES = [
  'Se fizer sentido para você, posso te ajudar a agendar uma visita.',
] as const;

const EVORA_CANONICAL_LOCATION_REPLY =
  'O Évora fica em Atibaia, na região da Pedreira/Rio Abaixo, com acesso pela Rodovia Dom Pedro I, a cerca de 50 minutos de São Paulo.';

function normalizeText(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeCompare(value: string | null | undefined): string {
  return normalizeText(value).replace(/[.!?,;:()"'`´]/g, '').trim();
}

function isGratitudeOnlyMessage(text: string | null | undefined): boolean {
  const n = normalizeText(text);
  return /^(obrigad[oa]|muito obrigad[oa]|ok obrigad[oa]|valeu|vlw|agradeco|agradeço)[.! ]*$/.test(n);
}

const EXPLICIT_VISIT_CTA_PATTERNS: RegExp[] = [
  /agendar uma visita/,
  /marcar uma visita/,
  /conhecer pessoalmente/,
  /conhecer o stand/,
  /visitar o lote/,
  /conhecer o andamento pessoalmente/,
  /que tal marcarmos uma visita/,
];

export function hasRecentExplicitVisitCta(recentAssistantReplies: string[]): boolean {
  const recent = recentAssistantReplies.slice(-4).map((msg) => normalizeText(msg));
  return recent.some((msg) => EXPLICIT_VISIT_CTA_PATTERNS.some((re) => re.test(msg)));
}

function isEvoraEnterprise(enterpriseName: string | null | undefined): boolean {
  const n = normalizeText(enterpriseName);
  return n === 'evora' || n.includes('evora');
}

function hasLucasAsAccessLeak(answer: string): boolean {
  const n = normalizeText(answer);
  return (
    n.includes('lucas nogueira garces') &&
    /(acesso|acessar|rota|caminho|endereco|chegar|localizacao exata|acesso facilitado)/.test(n)
  );
}

function hasCampinasRegionLeak(answer: string): boolean {
  const n = normalizeText(answer);
  return /\bcampinas\b/.test(n);
}

function hasVisitOffer(text: string): boolean {
  const n = normalizeText(text);
  return /(agendar uma visita|marcar uma visita|conhecer pessoalmente|vamos marcar)/.test(n);
}

const LEGACY_AGGRESSIVE_VISIT_CTA_PATTERNS: RegExp[] = [
  /que tal voce marcar uma visita/,
  /aproveita pra conhecer nosso stand/,
  /55%\s*de\s*obras executadas/,
  /vale a pena a visita/,
  /vamos marcar\?/,
];

export function containsLegacyAggressiveVisitCta(text: string): boolean {
  const n = normalizeText(text);
  return LEGACY_AGGRESSIVE_VISIT_CTA_PATTERNS.some((re) => re.test(n));
}

export function blockLegacyAggressiveVisitCtaByIntent(params: {
  text: string;
  intent: string | null;
  hasRecentVisitCta: boolean;
}): { text: string; changed: boolean; reason: string | null } {
  const nIntent = normalizeText(params.intent ?? '');
  const disallowByIntent =
    nIntent === 'localizacao_endereco' ||
    nIntent === 'preco_valor_lote' ||
    nIntent === 'valor_condominio' ||
    nIntent === 'entrega_empreendimento' ||
    nIntent === 'esclarecimento';

  if (!containsLegacyAggressiveVisitCta(params.text)) {
    return { text: params.text, changed: false, reason: null };
  }
  if (!disallowByIntent && !params.hasRecentVisitCta) {
    return { text: params.text, changed: false, reason: null };
  }

  const stripped = params.text
    .replace(/que tal voce marcar uma visita\??/gi, '')
    .replace(/aproveita pra conhecer nosso stand\??/gi, '')
    .replace(/55%\s*de\s*obras executadas[.!?]?/gi, '')
    .replace(/vale a pena a visita[.!?]?/gi, '')
    .replace(/vamos marcar\??/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!stripped || stripped === params.text) {
    return { text: params.text, changed: false, reason: null };
  }

  return {
    text: stripped,
    changed: true,
    reason: 'legacy_visit_cta_removed',
  };
}

function isCommercialInterestQuestion(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  return /(localizacao|regiao|endereco|acesso|valor|metro quadrado|pagamento|parcela|financiamento|lote|lazer|condominio|obra|disponibilidade|investimento|moradia|book|foto|estrutura|seguranca|portaria|controle de acesso|tranquilidade)/.test(n);
}

function isGenericInitialInterest(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  if (!/(tenho interesse|gostaria de saber mais|quero mais informac|quero saber mais)/.test(n)) return false;
  return !/(lazer|seguranca|portaria|localizacao|regiao|endereco|acesso|valor|metro quadrado|pagamento|financiamento|parcela|lote|condominio|investimento|obra|disponibilidade|estrutura|book|foto)/.test(n);
}

function isClarificationOnlyAnswer(answer: string): boolean {
  const n = normalizeText(answer);
  if (!n) return true;
  if (!n.endsWith('?')) return false;
  if (n.length > 140) return false;
  return /(qual|quais|prefere|pode me|me passa|me diz|para qual|que horario)/.test(n);
}

function isFallbackOrBlockedAnswer(answer: string): boolean {
  const n = normalizeText(answer);
  return /(desculpa, me perdi|nao consegui continuar|encaminhar seu atendimento|fallback|blocked|handoff)/.test(n);
}

function countAnsweredCommercialQuestions(rows: Array<{ role: string; content?: string | null }>): {
  answeredBeforeCurrent: number;
  currentUserCommercialQuestionPendingAnswer: boolean;
} {
  let awaitingCommercialAnswer = false;
  let answered = 0;

  for (const row of rows) {
    const content = (row.content ?? '').trim();
    if (row.role === 'user') {
      const commercialQuestion =
        content.length > 0 && isCommercialInterestQuestion(content) && !isGenericInitialInterest(content);
      awaitingCommercialAnswer = commercialQuestion;
      continue;
    }
    if (row.role === 'assistant' && awaitingCommercialAnswer) {
      answered += 1;
      awaitingCommercialAnswer = false;
    }
  }

  return {
    answeredBeforeCurrent: answered,
    currentUserCommercialQuestionPendingAnswer: awaitingCommercialAnswer,
  };
}

export function applyEvoraLocationGuard(params: {
  conversationId: number;
  enterpriseId: number | null;
  enterpriseName: string | null | undefined;
  userMessage: string;
  answer: string;
}): { text: string; changed: boolean; reason: string | null } {
  void params.userMessage;
  if (!isEvoraEnterprise(params.enterpriseName)) {
    return { text: params.answer, changed: false, reason: null };
  }

  if (hasCampinasRegionLeak(params.answer)) {
    const sanitized = params.answer
      .split(/(?<=[.!?])\s+/)
      .map((sentence) => sentence.trim())
      .filter((sentence) => sentence.length > 0 && !hasCampinasRegionLeak(sentence))
      .join(' ')
      .trim();
    const finalAnswer = sanitized
      ? `${sanitized}\n\n${EVORA_CANONICAL_LOCATION_REPLY}`
      : EVORA_CANONICAL_LOCATION_REPLY;
    console.log('[ANA_EVORA_LOCATION_GUARD]', {
      conversationId: params.conversationId,
      enterpriseId: params.enterpriseId,
      reason: 'campinas_region_leak_rewritten',
      originalAnswer: params.answer,
      finalAnswer,
    });
    return { text: finalAnswer, changed: true, reason: 'campinas_region_leak_rewritten' };
  }

  if (!hasLucasAsAccessLeak(params.answer)) {
    return { text: params.answer, changed: false, reason: null };
  }

  const sanitized = params.answer
    .replace(/[^.!?]*lucas nogueira garces[^.!?]*[.!?]?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  if (!sanitized || sanitized === params.answer.trim()) {
    console.log('[ANA_EVORA_LOCATION_GUARD]', {
      conversationId: params.conversationId,
      enterpriseId: params.enterpriseId,
      reason: 'lucas_garces_access_detected_no_rewrite',
      originalAnswer: params.answer,
      finalAnswer: params.answer,
    });
    return { text: params.answer, changed: false, reason: null };
  }

  console.log('[ANA_EVORA_LOCATION_GUARD]', {
    conversationId: params.conversationId,
    enterpriseId: params.enterpriseId,
    reason: 'lucas_garces_access_sentence_removed',
    originalAnswer: params.answer,
    finalAnswer: sanitized,
  });
  return { text: sanitized, changed: true, reason: 'lucas_garces_access_sentence_removed' };
}

export function applyAnaVisitOfferGuard(params: {
  conversationId: number;
  enterpriseId: number | null;
  enterpriseName: string | null | undefined;
  userMessage: string;
  answer: string;
  rowsBeforeSend: Array<{ role: string; content?: string | null }>;
  isSchedulingFlow: boolean;
  isHandoff: boolean;
  isMaterialOnlyFlow: boolean;
}): {
  text: string;
  changed: boolean;
  reason: string | null;
  appendedVisitOffer: boolean;
  appendedVisitOfferMessages: string[];
  commercialAnsweredQuestionsCount: number;
} {
  if (!isEvoraEnterprise(params.enterpriseName)) {
    return {
      text: params.answer,
      changed: false,
      reason: null,
      appendedVisitOffer: false,
      appendedVisitOfferMessages: [],
      commercialAnsweredQuestionsCount: 0,
    };
  }

  const alreadyOfferedVisit = params.rowsBeforeSend
    .filter((row) => row.role === 'assistant')
    .some((row) => hasVisitOffer(row.content ?? ''));

  const hasCurrentVisitOffer = hasVisitOffer(params.answer);
  const { answeredBeforeCurrent, currentUserCommercialQuestionPendingAnswer } = countAnsweredCommercialQuestions(
    params.rowsBeforeSend
  );

  const currentAnswerIsClarificationOnly = isClarificationOnlyAnswer(params.answer);
  const currentAnswerIsFallbackOrBlocked = isFallbackOrBlockedAnswer(params.answer);
  const currentCountsAsAnsweredCommercialQuestion =
    currentUserCommercialQuestionPendingAnswer &&
    !currentAnswerIsClarificationOnly &&
    !currentAnswerIsFallbackOrBlocked;

  const commercialAnsweredQuestionsCount =
    answeredBeforeCurrent + (currentCountsAsAnsweredCommercialQuestion ? 1 : 0);

  const canAppend =
    currentCountsAsAnsweredCommercialQuestion &&
    commercialAnsweredQuestionsCount >= 2 &&
    !alreadyOfferedVisit &&
    !hasCurrentVisitOffer &&
    !params.isSchedulingFlow &&
    !params.isHandoff &&
    !params.isMaterialOnlyFlow &&
    !currentAnswerIsClarificationOnly &&
    !currentAnswerIsFallbackOrBlocked;

  if (!canAppend) {
    return {
      text: params.answer,
      changed: false,
      reason: null,
      appendedVisitOffer: false,
      appendedVisitOfferMessages: [],
      commercialAnsweredQuestionsCount,
    };
  }

  const appendedVisitOfferMessages = [...EVORA_VISIT_OFFER_MESSAGES];
  console.log('[ANA_VISIT_OFFER_GUARD]', {
    conversationId: params.conversationId,
    enterpriseId: params.enterpriseId,
    commercialAnsweredQuestionsCount,
    alreadyOfferedVisit,
    appendedVisitOfferMessages,
    reason: 'commercial_interest_after_two_answers',
  });

  return {
    text: params.answer,
    changed: true,
    reason: 'commercial_interest_after_two_answers',
    appendedVisitOffer: true,
    appendedVisitOfferMessages,
    commercialAnsweredQuestionsCount,
  };
}

export function applyAnaNoRepeatMessageGuard(params: {
  conversationId: number;
  enterpriseId: number | null;
  enterpriseName: string | null | undefined;
  userMessage?: string;
  answer: string;
  recentAssistantReplies: string[];
  semanticallySimilar: (a: string, b: string) => boolean;
}): { text: string; changed: boolean; reason: string | null } {
  if (isGratitudeOnlyMessage(params.userMessage)) {
    return { text: params.answer, changed: false, reason: null };
  }

  const targetNorm = normalizeCompare(params.answer);
  const alreadyExact = params.recentAssistantReplies.some((msg) => normalizeCompare(msg) === targetNorm);
  const alreadySimilar =
    !alreadyExact && params.recentAssistantReplies.some((msg) => params.semanticallySimilar(msg, params.answer));

  if (!alreadyExact && !alreadySimilar) {
    return { text: params.answer, changed: false, reason: null };
  }

  const reason = alreadyExact ? 'exact_duplicate_detected_no_rewrite' : 'semantic_duplicate_detected_no_rewrite';
  console.log('[ANA_NO_REPEAT_MESSAGE_GUARD]', {
    conversationId: params.conversationId,
    enterpriseId: params.enterpriseId,
    reason,
    originalAnswer: params.answer,
    finalAnswer: params.answer,
  });
  return { text: params.answer, changed: false, reason };
}
