export type AnaDialogueTopic =
  | 'lazer'
  | 'seguranca'
  | 'localizacao'
  | 'valores'
  | 'pagamento'
  | 'visita'
  | 'corretor'
  | 'outro';

export interface AnaNextFollowupSelection {
  question: string | null;
  selectedTopic: AnaDialogueTopic | null;
  suppressedByRepeat: boolean;
  topicRepeatAvoided: boolean;
  usedFallbackQuestion: boolean;
}

interface TopicQuestionOption {
  question: string;
  mentions: AnaDialogueTopic[];
}

const TOPIC_QUESTION_MAP: Record<AnaDialogueTopic, TopicQuestionOption[]> = {
  lazer: [
    { question: 'Quer que eu te fale também sobre segurança ou localização?', mentions: ['seguranca', 'localizacao'] },
    { question: 'Se quiser, também te explico localização ou formas de pagamento.', mentions: ['localizacao', 'pagamento'] },
  ],
  seguranca: [
    { question: 'Quer que eu te explique também sobre lazer ou formas de pagamento?', mentions: ['lazer', 'pagamento'] },
    { question: 'Se quiser, também te conto sobre localização ou lazer.', mentions: ['localizacao', 'lazer'] },
  ],
  localizacao: [
    { question: 'Quer saber também sobre valores ou áreas de lazer?', mentions: ['valores', 'lazer'] },
    { question: 'Se quiser, também te explico sobre segurança ou formas de pagamento.', mentions: ['seguranca', 'pagamento'] },
  ],
  valores: [
    { question: 'Quer que eu te explique as formas de pagamento?', mentions: ['pagamento'] },
    { question: 'Se quiser, também te falo sobre localização ou lazer.', mentions: ['localizacao', 'lazer'] },
  ],
  pagamento: [
    { question: 'Quer saber também sobre localização ou áreas de lazer?', mentions: ['localizacao', 'lazer'] },
    { question: 'Se quiser, também te explico sobre segurança do empreendimento.', mentions: ['seguranca'] },
  ],
  visita: [
    { question: 'Prefere que eu te explique valores ou localização antes da visita?', mentions: ['valores', 'localizacao'] },
    { question: 'Quer que eu te explique também as formas de pagamento?', mentions: ['pagamento'] },
  ],
  corretor: [
    { question: 'Enquanto isso, quer que eu te adiante localização ou lazer?', mentions: ['localizacao', 'lazer'] },
    { question: 'Quer que eu te adiante também as formas de pagamento?', mentions: ['pagamento'] },
  ],
  outro: [
    { question: 'Quer que eu te explique também sobre localização, lazer ou formas de pagamento?', mentions: ['localizacao', 'lazer', 'pagamento'] },
  ],
};

const TOPIC_PATTERNS: Array<{ topic: AnaDialogueTopic; pattern: RegExp }> = [
  { topic: 'lazer', pattern: /\b(lazer|área de lazer|area de lazer|piscina|academia|playground|quadra|coworking|espaço zen|espaco zen)\b/ },
  { topic: 'seguranca', pattern: /\b(segurança|seguranca|portaria|controle de acesso|monitoramento)\b/ },
  { topic: 'localizacao', pattern: /\b(localização|localizacao|onde fica|bairro|região|regiao|acesso|endereço|endereco)\b/ },
  { topic: 'valores', pattern: /\b(valor|valores|preço|preco|quanto custa|r\$)\b/ },
  { topic: 'pagamento', pattern: /\b(pagamento|entrada|parcela|parcelamento|financiamento|condição|condicao)\b/ },
  { topic: 'visita', pattern: /\b(visita|agendar|agendamento|marcar visita)\b/ },
  { topic: 'corretor', pattern: /\b(corretor|consultor|encaminhar)\b/ },
];

const FALLBACK_SPECIFIC_DETAIL_QUESTION = 'Tem algum ponto específico que você quer que eu detalhe melhor?';

function norm(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
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

export function selectAnaNextFollowupQuestion(input: {
  currentTopic: AnaDialogueTopic;
  recentlyDiscussedTopics: string[];
  recentlyAskedTopics: string[];
  recentAssistantReplies: string[];
}): AnaNextFollowupSelection {
  const options = TOPIC_QUESTION_MAP[input.currentTopic] ?? TOPIC_QUESTION_MAP.outro;
  const recentDiscussed = new Set((input.recentlyDiscussedTopics ?? []).map((x) => String(x).toLowerCase()));
  const recentAsked = new Set((input.recentlyAskedTopics ?? []).map((x) => String(x).toLowerCase()));
  const recentRepliesNorm = (input.recentAssistantReplies ?? []).map((x) => norm(x));
  let suppressedByRepeat = false;

  const scoreOption = (opt: TopicQuestionOption): number => {
    let score = 0;
    for (const topic of opt.mentions) {
      if (!recentDiscussed.has(topic)) score += 2;
      if (!recentAsked.has(topic)) score += 1;
    }
    return score;
  };

  let best: TopicQuestionOption | null = null;
  let bestScore = -1;
  for (const option of options) {
    const qNorm = norm(option.question);
    if (recentRepliesNorm.some((reply) => reply.includes(qNorm))) {
      suppressedByRepeat = true;
      continue;
    }
    const score = scoreOption(option);
    if (score > bestScore) {
      best = option;
      bestScore = score;
    }
  }
  if (!best) {
    const fallbackNorm = norm(FALLBACK_SPECIFIC_DETAIL_QUESTION);
    if (recentRepliesNorm.some((reply) => reply.includes(fallbackNorm))) {
      return {
        question: null,
        selectedTopic: null,
        suppressedByRepeat: true,
        topicRepeatAvoided: false,
        usedFallbackQuestion: false,
      };
    }
    return {
      question: FALLBACK_SPECIFIC_DETAIL_QUESTION,
      selectedTopic: null,
      suppressedByRepeat,
      topicRepeatAvoided: true,
      usedFallbackQuestion: true,
    };
  }
  const firstUntouched = best.mentions.find((topic) => !recentDiscussed.has(topic)) ?? best.mentions[0] ?? null;
  const selectedTopic = firstUntouched ?? null;
  const topicRepeatAvoided = selectedTopic != null && !recentDiscussed.has(selectedTopic);
  return {
    question: best.question,
    selectedTopic,
    suppressedByRepeat,
    topicRepeatAvoided,
    usedFallbackQuestion: false,
  };
}
