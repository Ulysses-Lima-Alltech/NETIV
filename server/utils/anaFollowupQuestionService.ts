export type AnaDialogueTopic =
  | 'lazer'
  | 'seguranca'
  | 'localizacao'
  | 'valores'
  | 'pagamento'
  | 'visita'
  | 'corretor'
  | 'outro';

export interface AnaSafeTopicAvailability {
  lazer?: boolean;
  seguranca?: boolean;
  localizacao?: boolean;
  valores?: boolean;
  pagamento?: boolean;
}

export interface AnaSingleSafeTopicSelection {
  topic: AnaDialogueTopic | null;
  question: string | null;
  suppressedByRepeat: boolean;
  suppressedUnsupported: boolean;
}

export interface AnaNextFollowupSelection {
  question: string | null;
  selectedTopic: AnaDialogueTopic | null;
  suppressedByRepeat: boolean;
  topicRepeatAvoided: boolean;
  usedFallbackQuestion: boolean;
  suppressedUnsupported: boolean;
}

const TOPIC_PATTERNS: Array<{ topic: AnaDialogueTopic; pattern: RegExp }> = [
  {
    topic: 'lazer',
    pattern:
      /\b(lazer|area de lazer|areas de lazer|piscina|academia|playground|quadra|coworking|espaco zen|fireplace)\b/,
  },
  {
    topic: 'seguranca',
    pattern: /\b(seguranca|portaria|controle de acesso|monitoramento)\b/,
  },
  {
    topic: 'localizacao',
    pattern: /\b(localizacao|onde fica|bairro|regiao|acesso|endereco|rodovia)\b/,
  },
  {
    topic: 'valores',
    pattern: /\b(valor|valores|preco|quanto custa|r\$)\b/,
  },
  {
    topic: 'pagamento',
    pattern: /\b(pagamento|entrada|parcela|parcelamento|financiamento|condicao|condicoes)\b/,
  },
  { topic: 'visita', pattern: /\b(visita|agendar|agendamento|marcar visita)\b/ },
  { topic: 'corretor', pattern: /\b(corretor|consultor|encaminhar)\b/ },
];

const CANDIDATE_ORDER_BY_CURRENT_TOPIC: Record<AnaDialogueTopic, AnaDialogueTopic[]> = {
  lazer: ['seguranca', 'localizacao', 'pagamento', 'valores'],
  seguranca: ['lazer', 'localizacao', 'pagamento', 'valores'],
  localizacao: ['valores', 'pagamento', 'lazer', 'seguranca'],
  valores: ['pagamento', 'localizacao', 'lazer', 'seguranca'],
  pagamento: ['valores', 'localizacao', 'lazer', 'seguranca'],
  visita: ['valores', 'pagamento', 'localizacao'],
  corretor: ['localizacao', 'valores', 'pagamento'],
  outro: ['valores', 'localizacao', 'lazer', 'pagamento', 'seguranca'],
};

const TOPIC_QUESTION_LABEL: Record<AnaDialogueTopic, string | null> = {
  lazer: 'Quer que eu te explique as areas de lazer?',
  seguranca: 'Quer que eu te explique a seguranca do empreendimento?',
  localizacao: 'Quer que eu te fale sobre localizacao?',
  valores: 'Quer saber tambem sobre valores?',
  pagamento: 'Quer que eu te explique as formas de pagamento?',
  visita: null,
  corretor: null,
  outro: null,
};

const FALLBACK_SPECIFIC_DETAIL_QUESTION = 'Voce esta buscando o lote para morar, investir ou construir?';

function norm(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isTopicAllowed(
  topic: AnaDialogueTopic,
  allowedTopics: AnaSafeTopicAvailability | null | undefined
): boolean {
  if (
    topic !== 'lazer' &&
    topic !== 'seguranca' &&
    topic !== 'localizacao' &&
    topic !== 'valores' &&
    topic !== 'pagamento'
  ) {
    return false;
  }
  if (!allowedTopics) return true;
  const key = topic as keyof AnaSafeTopicAvailability;
  const value = allowedTopics[key];
  return value !== false;
}

export function detectAnaDialogueTopics(text: string): AnaDialogueTopic[] {
  const n = norm(text);
  if (!n) return [];
  const out: AnaDialogueTopic[] = [];
  for (const item of TOPIC_PATTERNS) {
    if (item.pattern.test(n)) out.push(item.topic);
  }
  return out.length > 0 ? out : ['outro'];
}

export function selectSingleSafeNextTopic(input: {
  currentTopic: AnaDialogueTopic;
  recentlyDiscussedTopics: string[];
  recentlyAskedTopics: string[];
  recentAssistantReplies: string[];
  allowedTopics?: AnaSafeTopicAvailability | null;
}): AnaSingleSafeTopicSelection {
  const recentDiscussed = new Set((input.recentlyDiscussedTopics ?? []).map((x) => String(x).toLowerCase()));
  const recentAsked = new Set((input.recentlyAskedTopics ?? []).map((x) => String(x).toLowerCase()));
  const recentRepliesNorm = (input.recentAssistantReplies ?? []).map((x) => norm(x));
  const candidates = CANDIDATE_ORDER_BY_CURRENT_TOPIC[input.currentTopic] ?? CANDIDATE_ORDER_BY_CURRENT_TOPIC.outro;

  let bestTopic: AnaDialogueTopic | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let suppressedByRepeat = false;
  let suppressedUnsupported = false;

  for (const topic of candidates) {
    if (!isTopicAllowed(topic, input.allowedTopics)) {
      suppressedUnsupported = true;
      continue;
    }
    const question = TOPIC_QUESTION_LABEL[topic];
    if (!question) continue;
    const qNorm = norm(question);
    if (recentRepliesNorm.some((reply) => reply.includes(qNorm))) {
      suppressedByRepeat = true;
      continue;
    }
    let score = 0;
    if (!recentDiscussed.has(topic)) score += 3;
    if (!recentAsked.has(topic)) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestTopic = topic;
    }
  }

  if (!bestTopic) {
    return {
      topic: null,
      question: null,
      suppressedByRepeat,
      suppressedUnsupported,
    };
  }
  return {
    topic: bestTopic,
    question: TOPIC_QUESTION_LABEL[bestTopic],
    suppressedByRepeat,
    suppressedUnsupported,
  };
}

export function selectAnaNextFollowupQuestion(input: {
  currentTopic: AnaDialogueTopic;
  recentlyDiscussedTopics: string[];
  recentlyAskedTopics: string[];
  recentAssistantReplies: string[];
  allowedTopics?: AnaSafeTopicAvailability | null;
}): AnaNextFollowupSelection {
  const selected = selectSingleSafeNextTopic(input);
  if (selected.question) {
    return {
      question: selected.question,
      selectedTopic: selected.topic,
      suppressedByRepeat: selected.suppressedByRepeat,
      topicRepeatAvoided:
        selected.topic != null &&
        !(input.recentlyDiscussedTopics ?? []).map((x) => String(x).toLowerCase()).includes(selected.topic),
      usedFallbackQuestion: false,
      suppressedUnsupported: selected.suppressedUnsupported,
    };
  }

  const fallbackNorm = norm(FALLBACK_SPECIFIC_DETAIL_QUESTION);
  const recentRepliesNorm = (input.recentAssistantReplies ?? []).map((x) => norm(x));
  if (recentRepliesNorm.some((reply) => reply.includes(fallbackNorm))) {
    return {
      question: null,
      selectedTopic: null,
      suppressedByRepeat: true,
      topicRepeatAvoided: false,
      usedFallbackQuestion: false,
      suppressedUnsupported: selected.suppressedUnsupported,
    };
  }
  return {
    question: FALLBACK_SPECIFIC_DETAIL_QUESTION,
    selectedTopic: null,
    suppressedByRepeat: selected.suppressedByRepeat,
    topicRepeatAvoided: false,
    usedFallbackQuestion: true,
    suppressedUnsupported: selected.suppressedUnsupported,
  };
}
