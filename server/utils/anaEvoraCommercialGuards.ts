const EVORA_REGION_BLOCK = `Atibaia faz parte da região bragantina, que é uma das regiões mais valorizadas e desenvolvidas do estado. Fica a 50 minutos de São Paulo, tornando o Évora um condomínio para casas de veraneio ou até mesmo moradia.

A cidade de Atibaia é rica em gastronomia, contendo os melhores restaurantes da região, sem contar com a avenida Lucas Nogueira Garces, que além de ser um verdadeiro centro gastronômico contém também as principais grifes, bares renomados se tornando um charmoso shopping a céu aberto.

Não podemos deixar de destacar que Atibaia foi considerada a cidade com o segundo melhor clima do mundo pela ONU.`;

const EVORA_ADDRESS_BLOCK =
  'Fica na Região da Pedreira, no bairro do Rio Abaixo. Um bairro já conceituado com diversos condomínios de médio e alto padrão.';

const EVORA_ACCESS_BLOCK =
  'Fica perto da área da Pedreira, com fácil acesso pela Rodovia Dom Pedro I.';

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
  return /(onde fica|endereco|bairro|localizacao exata|ponto de referencia|como chegar|entrada|acesso|rota|caminho)/.test(n);
}

function isAccessIntent(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  return /(como e o acesso|como eh o acesso|acesso|como chegar|rota|entrada|caminho)/.test(n);
}

function isRegionIntent(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  return /(regiao|atibaia|cidade|gastronomia|qualidade de vida|pontos positivos|clima)/.test(n);
}

function hasLucasAsAccessLeak(answer: string): boolean {
  const n = normalizeText(answer);
  return (
    n.includes('lucas nogueira garces') &&
    /(acesso|acessar|rota|entrada|caminho|endereco|chegar|localizacao exata|acesso facilitado)/.test(n)
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
    text = EVORA_ADDRESS_BLOCK;
    reason = 'lucas_garces_used_as_access';
  } else if (isAccessIntent(params.userMessage)) {
    text = EVORA_ACCESS_BLOCK;
    reason = 'access_intent_forced_access_block';
  } else if (isAddressIntent(params.userMessage)) {
    text = EVORA_ADDRESS_BLOCK;
    reason = 'address_intent_forced_address_block';
  } else if (isRegionIntent(params.userMessage)) {
    text = EVORA_REGION_BLOCK;
    reason = 'region_intent_forced_region_block';
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
  const targetNorm = normalizeCompare(params.answer);
  const alreadyExact = params.recentAssistantReplies.some((msg) => normalizeCompare(msg) === targetNorm);
  const alreadySimilar =
    !alreadyExact && params.recentAssistantReplies.some((msg) => params.semanticallySimilar(msg, params.answer));

  if (!alreadyExact && !alreadySimilar) {
    return { text: params.answer, changed: false, reason: null };
  }

  const nUser = normalizeText(params.userMessage ?? '');
  let text = 'Posso te responder de forma mais objetiva nesse ponto.';
  if (/(entrega|obra|prazo|lotes|construir|libera)/.test(nUser)) {
    text = 'Você está perguntando sobre a previsão de entrega do empreendimento. Ainda não tenho a previsão exata liberada por aqui, mas o corretor confirma certinho pra você.';
  } else if (/(entrada)/.test(nUser)) {
    text = 'A entrada mínima é 20% do valor do lote, e o valor exato depende da unidade escolhida.';
  } else if (/(preco|valor|quanto custa|lote)/.test(nUser)) {
    text = 'Esse é o valor inicial mesmo. Se quiser, o corretor pode simular conforme o lote disponível.';
  } else if (/(condominio|taxa condominial)/.test(nUser)) {
    text = 'Essa estimativa pode variar conforme as definições da associação. Se quiser, o corretor te explica no detalhe.';
  } else if (/(localizacao|endereco|onde fica|como chegar)/.test(nUser)) {
    text = 'Se quiser, te passo a referência de acesso de forma mais direta para sua rota.';
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

