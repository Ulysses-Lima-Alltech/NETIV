const EVORA_CANONICAL_LOCATION_REPLY =
  'O Évora fica em Atibaia, na região da Pedreira, próximo ao bairro Rio Abaixo, com fácil acesso pela Rodovia Dom Pedro I.';
const EVORA_DIRECT_LOCATION_NO_REPEAT_REPLY =
  'Ele fica em Atibaia, na região da Pedreira, próximo ao bairro Rio Abaixo, com acesso pela Rodovia Dom Pedro I.';

export const EVORA_VISIT_OFFER_MESSAGES = [
  'Se fizer sentido para você, posso te ajudar a agendar uma visita.',
] as const;

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

function isAddressIntent(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  return /(localizacao|onde fica|endereco|bairro|regiao|localizacao exata|ponto de referencia)/.test(n);
}

function isAccessIntent(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  return /(como e o acesso|como eh o acesso|acesso)/.test(n);
}

function isRegionIntent(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  return /(regiao|atibaia|cidade|gastronomia|qualidade de vida|pontos positivos|clima)/.test(n);
}

function isExplicitLocationLinkIntent(userMessage: string | null | undefined): boolean {
  const n = normalizeText(userMessage);
  if (!n) return false;
  return /(tem o link da localizacao|tem link da localizacao|link da localizacao|link de localizacao|google maps|maps|mapa|rota|como chegar|manda localizacao|manda a localizacao|me envia a localizacao|me envia localizacao|me manda localizacao|me manda a localizacao)/.test(
    n
  );
}

function isDirectLocationIntent(userMessage: string | null | undefined): boolean {
  const n = normalizeText(userMessage);
  if (!n) return false;
  return /(localizacao|onde fica|endereco|regiao|bairro|pedreira|rio abaixo)/.test(n);
}

function hasLucasAsAccessLeak(answer: string): boolean {
  const n = normalizeText(answer);
  return (
    n.includes('lucas nogueira garces') &&
    /(acesso|acessar|rota|caminho|endereco|chegar|localizacao exata|acesso facilitado)/.test(n)
  );
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
  if (nIntent === 'localizacao_endereco') {
    return {
      text: 'Você vem de São Paulo ou de Atibaia?',
      changed: true,
      reason: 'legacy_visit_cta_blocked_for_location',
    };
  }
  if (nIntent === 'entrega_empreendimento') {
    return {
      text: 'Quer saber também como está a infraestrutura prevista?',
      changed: true,
      reason: 'legacy_visit_cta_blocked_for_delivery',
    };
  }
  return {
    text: 'Se você quiser, posso te explicar esse ponto com mais detalhe.',
    changed: true,
    reason: 'legacy_visit_cta_blocked',
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
  if (!isEvoraEnterprise(params.enterpriseName)) {
    return { text: params.answer, changed: false, reason: null };
  }

  let text = params.answer.trim();
  let reason: string | null = null;

  if (hasLucasAsAccessLeak(text)) {
    text = EVORA_CANONICAL_LOCATION_REPLY;
    reason = 'lucas_garces_used_as_access';
  } else if (isAccessIntent(params.userMessage)) {
    text = EVORA_CANONICAL_LOCATION_REPLY;
    reason = 'access_intent_forced_canonical_location';
  } else if (isAddressIntent(params.userMessage)) {
    text = EVORA_CANONICAL_LOCATION_REPLY;
    reason = 'address_intent_forced_canonical_location';
  } else if (isRegionIntent(params.userMessage)) {
    text = EVORA_CANONICAL_LOCATION_REPLY;
    reason = 'region_intent_forced_canonical_location';
  }

  if (reason) {
    console.log('[ANA_EVORA_LOCATION_GUARD]', {
      conversationId: params.conversationId,
      enterpriseId: params.enterpriseId,
      reason,
      originalAnswer: params.answer,
      finalAnswer: text,
    });
    return { text, changed: true, reason };
  }

  return { text: params.answer, changed: false, reason: null };
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

  const nUser = normalizeText(params.userMessage ?? '');
  let text =
    'Me confirma só qual ponto você quer que eu detalhe: lazer, segurança, localização ou formas de pagamento?';
  if (/(quantos?\s+lotes?|numero\s+de\s+lotes?|vai\s+ter\s+quantos?\s+lotes?)/.test(nUser)) {
    text =
      'Ainda não tenho essa informação exata liberada por aqui.\nQuer que eu encaminhe para um corretor te passar certinho?';
  } else if (isExplicitLocationLinkIntent(params.userMessage)) {
    text =
      'Não tenho um link de localização liberado para envio por aqui.\nO Évora fica em Atibaia, na região da Pedreira, próximo ao bairro Rio Abaixo, com fácil acesso pela Rodovia Dom Pedro I.';
  } else if (isDirectLocationIntent(params.userMessage)) {
    text = EVORA_DIRECT_LOCATION_NO_REPEAT_REPLY;
    console.log('[ANA_LOCATION_DIRECT_NO_REPEAT_SAFE_REWRITE]', {
      conversationId: params.conversationId,
      enterpriseId: params.enterpriseId,
      originalAnswer: params.answer,
      finalAnswer: text,
    });
  } else if (/(seguranca|portaria|controle de acesso)/.test(nUser)) {
    text = 'O Évora conta com portaria 24 horas com controle de acesso.';
  } else if (/(lazer|areas? de lazer|piscina|academia|playground|quadra|coworking)/.test(nUser)) {
    text = [
      'As áreas de lazer do Évora incluem:',
      'Piscina adulto',
      'Academia',
      'Salão de festas',
      'Playground',
      'Coworking',
      'Espaço zen',
      'Fireplace',
      'Quadra de beach tennis',
      'Campo society',
      '',
      'Também conta com estação de carregamento para carros elétricos e portaria 24 horas com controle de acesso.',
    ].join('\n');
  } else if (/(entrega|obra|prazo|construir|libera)/.test(nUser)) {
    text = 'A previsão de entrega do Évora é dezembro de 2027, e as obras estão avançadas com 55% executado.';
  } else if (/(entrada)/.test(nUser)) {
    text = 'Temos planos estendidos em até 120x, parcelamento sem juros em até 48x e financiamento direto com a construtora.';
  } else if (/(condominio|taxa condominial)/.test(nUser)) {
    text = 'O condomínio tem estimativa entre R$400 e R$700, conforme definições da associação.';
  } else if (/(preco|valor|quanto custa|\blote\b)/.test(nUser)) {
    text = 'Esse é o valor inicial mesmo. Se quiser, o corretor pode simular conforme o lote disponível.';
  }

  const reason = alreadyExact ? 'exact_duplicate_blocked' : 'semantic_duplicate_blocked';
  console.log('[ANA_NO_REPEAT_MESSAGE_GUARD]', {
    conversationId: params.conversationId,
    enterpriseId: params.enterpriseId,
    reason,
    originalAnswer: params.answer,
    finalAnswer: text,
  });
  return { text, changed: true, reason };
}


