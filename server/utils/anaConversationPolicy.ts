import type { CommercialFlowState } from './commercialFlowState.js';
import {
  detectAnaDialogueTopics,
  selectAnaNextFollowupQuestion,
  type AnaSafeTopicAvailability,
  type AnaDialogueTopic,
} from './anaFollowupQuestionService.js';
import {
  getAnaDialoguePolicyState,
  mergeAnaDialoguePolicyState,
  pushAnaDialogueTopics,
} from './anaDialogueState.js';

const BROKER_HANDOFF_ASK =
  'Esses detalhes podem variar conforme disponibilidade. Quer que eu encaminhe para um corretor te passar certinho?';
const VISIT_SLOT_WINDOW = 'Temos disponibilidade de segunda a sabado, das 09h as 18h.';

const SPECIFIC_DETAIL_FALLBACK_STATEMENT = 'Posso te ajudar com mais detalhes do empreendimento.';

const GENERIC_SINGLE_FOLLOWUP_FALLBACK =
  'Posso seguir com o ponto que fizer mais sentido para voce.';
const BANNED_GENERIC_FALLBACK = 'Posso te responder de forma mais objetiva nesse ponto.';
const GENERIC_LOOP_PATTERNS: RegExp[] = [
  /tem algum ponto espec[ií]fico que voc[eê] quer que eu detalhe melhor\??/i,
  /tem algum ponto espec[ií]fico que voc[eê] quer saber\??/i,
  /me conta,?\s*qual ponto voc[eê] quer entender primeiro\??/i,
  /me conta,?\s*qual ponto voc[eê] quer entender\??/i,
  /posso te contar sobre os valores,\s*a localizacao,\s*o lazer ou as formas de pagamento(?: do evora)?\.?\s*qual desses pontos voc[eê] quer ver primeiro\??/i,
  /claro\.\s*voce quer saber mais sobre valores,\s*lazer,\s*localizacao,\s*seguranca ou formas de pagamento\??/i,
];
const ME_CONTA_GENERIC_LOOP_PATTERN = /me conta,?\s*qual ponto voc[eê] quer entender primeiro\??/i;

type RequestedTopicActionType =
  | 'direct_topic_request'
  | 'accepted_topic_offer'
  | 'proactive_next_topic_offer'
  | 'ambiguous_followup';

type DeterministicTopic = 'lazer' | 'seguranca' | 'localizacao' | 'valores' | 'pagamento' | 'lot_count';

type RequestedTopicAction = {
  type: RequestedTopicActionType;
  topic: DeterministicTopic | null;
  offeredTopics: AnaDialogueTopic[];
};

function norm(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsGenericLoopQuestion(text: string | null | undefined): boolean {
  const normalized = norm(text || '');
  if (!normalized) return false;
  return GENERIC_LOOP_PATTERNS.some((pattern) => pattern.test(normalized));
}

function stripGenericLoopQuestion(text: string | null | undefined): string {
  const raw = String(text || '').trim();
  if (!raw) return raw;
  let next = raw;
  for (const pattern of GENERIC_LOOP_PATTERNS) {
    next = next.replace(new RegExp(pattern.source, 'gi'), '').trim();
  }
  return next
    .replace(/\s{2,}/g, ' ')
    .replace(/^[,.;:!?-]+\s*/g, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();
}

function isLocationRequestUserMessage(userMessage: string): boolean {
  const n = norm(userMessage);
  if (!n) return false;
  return /\b(manda a localizacao|manda localizacao|link da localizacao|link de localizacao|me envia a localizacao|me envia localizacao|como chegar|onde fica|nao entendi onde fica|endereco|localizacao|rota)\b/.test(
    n
  );
}

function buildLocationProgressBridgeReply(): string {
  return [
    'O Evora fica em Atibaia, na regiao da Pedreira/Rio Abaixo, com acesso pela Rodovia Dom Pedro I, a cerca de 50 minutos de Sao Paulo, em uma regiao com qualidade de vida e contato com a natureza.',
    'Quer que eu te mande tambem o link do mapa?',
  ].join(' ');
}

function startsWithGreeting(text: string): boolean {
  return /^(oi|ol[aá]|bom dia|boa tarde|boa noite)\b/i.test((text || '').trim());
}

function startsWithComposedCordialGreeting(text: string): boolean {
  const n = norm(text || '');
  return /^(oi|ola)\s*[!,.]?\s*(bom dia|boa tarde|boa noite)\s*[!,.]?\s*tudo bem\s*\?/.test(n);
}

function greetingByHour(referenceNow?: Date): 'Bom dia' | 'Boa tarde' | 'Boa noite' {
  const d = referenceNow instanceof Date ? referenceNow : new Date();
  const hourText = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hour12: false,
  }).format(d);
  const hour = Number(hourText.replace(/\D/g, ''));
  if (Number.isFinite(hour) && hour >= 5 && hour < 12) return 'Bom dia';
  if (Number.isFinite(hour) && hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

function stripLeadingGreetingPrefix(text: string): string {
  let next = (text || '').trim();
  next = next.replace(/^(oi|ol[aá])(?:[!,. ]+)?/i, '').trim();
  next = next.replace(/^(bom dia|boa tarde|boa noite)(?:[!,. ]+)?/i, '').trim();
  next = next.replace(/^tudo bem\s*\?\s*/i, '').trim();
  return next;
}

function stripLeadingStaleTopicCta(text: string): { text: string; changed: boolean } {
  const raw = (text || '').trim();
  if (!raw) return { text: raw, changed: false };
  const next = raw
    .replace(
      /^(quer\s+(?:que eu te explique|saber tambem sobre)[^?]*\?\s*)+/i,
      ''
    )
    .replace(/^\s*vou responder todas\.?\s*/i, '')
    .replace(/\s*vou responder todas\.?\s*$/i, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (!next) {
    return {
      text: 'O Evora e um loteamento fechado em Atibaia, com lotes a partir de 360 m2, infraestrutura planejada, lazer completo e seguranca 24 horas.',
      changed: true,
    };
  }
  return { text: next, changed: next !== raw };
}

function periodHumanLabel(period: string | null | undefined): string | null {
  const n = norm(period || '');
  if (n === 'manha') return 'de manhã';
  if (n === 'tarde') return 'à tarde';
  if (n === 'noite') return 'à noite';
  return null;
}

function displayTime(hm: string | null | undefined): string | null {
  const value = String(hm || '').trim();
  if (!/^\d{2}:\d{2}$/.test(value)) return null;
  const hh = Number.parseInt(value.slice(0, 2), 10);
  const mm = value.slice(3, 5);
  if (!Number.isFinite(hh)) return null;
  return mm === '00' ? `${hh}h` : `${hh}h${mm}`;
}

function combineDateAndPeriodLabel(dateLabel: string | null | undefined, period: string | null | undefined): string | null {
  const d = (dateLabel || '').trim();
  const p = periodHumanLabel(period);
  if (d && p) return `${d} ${p}`;
  if (d) return d;
  return p;
}

function isConfusionVisitMessage(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return /^(ue|ueh|como assim|nao entendi|o que|oxi)$/.test(n);
}

function askVisitMissingSlotQuestion(
  flowState: CommercialFlowState,
  hasKnownName: boolean,
  userMessage?: string
): string {
  const pendingDate = (flowState.pendingVisitDate || '').trim();
  const pendingDateLabel = flowState.pendingVisitDateLabel ?? null;
  const pendingPeriod = flowState.pendingVisitPeriod ?? null;
  const pendingTime = (flowState.pendingVisitTime || '').trim();
  const pendingInvalidTime = (flowState.pendingVisitInvalidTime || '').trim();
  const pendingMissingSlot = flowState.pendingVisitMissingSlot ?? null;
  const invalidTimeFlow = pendingMissingSlot === 'valid_time' || pendingInvalidTime.length > 0;
  if (invalidTimeFlow) {
    const invalidTimeLabel = pendingInvalidTime || 'Esse horário';
    if (isConfusionVisitMessage(userMessage || '')) {
      return `Você tem razão, eu me expressei mal. ${invalidTimeLabel} fica fora do horário disponível para visitas. Consigo seguir com um horário entre 09h e 18h. Qual fica melhor?`;
    }
    if (isAckLikeMessage(userMessage || '')) {
      return 'Certo. Qual horário entre 09h e 18h você prefere?';
    }
    return `${invalidTimeLabel} fica fora do horário de visitas. Posso seguir com um horário entre 09h e 18h. Qual prefere?`;
  }
  const label = combineDateAndPeriodLabel(pendingDateLabel, pendingPeriod);
  if (!pendingDate) {
    return 'Perfeito. Para qual dia você prefere agendar a visita?';
  }
  if (!pendingTime) {
    if (label) return `Perfeito, ${label}. Qual horário fica melhor para você? ${VISIT_SLOT_WINDOW}`;
    return `Perfeito. Qual horário fica melhor para você? ${VISIT_SLOT_WINDOW}`;
  }
  if (!hasKnownName) {
    const hm = displayTime(pendingTime);
    if (hm && label) return `Perfeito, ${label} às ${hm}. Como posso te chamar para confirmar o agendamento?`;
    return 'Perfeito. Como posso te chamar para confirmar o agendamento?';
  }
  const hm = displayTime(pendingTime);
  if (hm && label) return `Perfeito. Posso confirmar sua visita para ${label} às ${hm}?`;
  return 'Perfeito. Posso confirmar sua visita?';
}

function looksLikeVisitFlowReply(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return /\b(visita|agendar|agendamento|qual horario|qual horário|para qual dia|como posso te chamar|confirmar o agendamento|ficou agendada)\b/.test(n);
}

function containsMediaOffer(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return /\b(video|vídeo|book|fotos|foto|imagens|galeria|te envio|posso te enviar)\b/.test(n);
}

function containsVisitOffer(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return /\b(agendar uma visita|marcar uma visita|conhecer pessoalmente|vamos marcar uma visita)\b/.test(n);
}

function containsBrokerAsk(text: string): boolean {
  const n = norm(text);
  return /\b(encaminh|corretor)\b/.test(n) && /\?/.test(text);
}

function isAckLikeMessage(text: string): boolean {
  const n = norm(text).replace(/[.!?]+$/g, '').trim();
  return /^(sim|ok|perfeito|ta bom|tá bom|pode ser|pode sim|fechado|claro|beleza|isso|pode|quero)$/.test(n);
}

function stripVisitOffer(text: string): string {
  return (text || '')
    .replace(/que tal marcarmos uma visita\??/gi, '')
    .replace(/quer que eu te ajude a agendar uma visita\??/gi, '')
    .replace(/posso te ajudar a agendar uma visita\??/gi, '')
    .replace(/se quiser,?\s*posso te ajudar a agendar uma visita\??/gi, '')
    .replace(/prefere agendar uma visita\??/gi, '')
    .replace(/vamos marcar uma visita\??/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripMediaOffer(text: string): string {
  return (text || '')
    .replace(/posso te enviar (?:o )?(?:book|vídeo|video|fotos?|imagens?)\??/gi, '')
    .replace(/tamb[eé]m posso te mostrar[\s\S]*?(?:\.|$)/gi, '')
    .replace(/se preferir[\s\S]*?(?:\.|$)/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function stripBrokerAsk(text: string): string {
  return (text || '')
    .replace(
      /esses detalhes podem variar conforme disponibilidade\.?\s*quer que eu encaminhe para um corretor te passar certinho\??/gi,
      ''
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function ensureFirstReplyGreeting(text: string, referenceNow?: Date): { text: string; changed: boolean } {
  const raw = (text || '').trim();
  if (!raw) return { text: raw, changed: false };
  if (startsWithComposedCordialGreeting(raw)) {
    return { text: raw, changed: false };
  }
  const greeting = greetingByHour(referenceNow).toLowerCase();
  const desiredPrefix = `Olá, ${greeting}, tudo bem?`;
  const withoutLeadingGreeting = stripLeadingGreetingPrefix(raw) || raw;
  const separator = /\r?\n/.test(withoutLeadingGreeting) ? '\n\n' : ' ';
  const merged = `${desiredPrefix}${separator}${withoutLeadingGreeting}`;
  const next =
    separator === '\n\n'
      ? merged.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
      : merged.replace(/\s{2,}/g, ' ').trim();
  return { text: next, changed: next !== raw };
}

function stripMidConversationGreeting(text: string): { text: string; changed: boolean } {
  const raw = (text || '').trim();
  if (!raw) return { text: raw, changed: false };
  if (!startsWithGreeting(raw)) return { text: raw, changed: false };
  const next = stripLeadingGreetingPrefix(raw);
  if (!next) return { text: raw, changed: false };
  return { text: next, changed: next !== raw };
}

function isUncertainDisplayName(name: string | null | undefined): boolean {
  const n = norm(name || '');
  if (!n) return false;
  if (/\b(kkk|rs|haha|hehe)\b/.test(n)) return true;
  if (/\b(mestre|meu idolo|meu idol|chefe|patrao|patrao|boss|amigo|parceiro)\b/.test(n)) return true;
  return false;
}

function removeUnconfirmedVocativeName(text: string): string {
  return (text || '')
    .replace(
      /^(oi|ol[aá]|bom dia|boa tarde|boa noite)[,! ]+([a-zà-ÿ'-]{2,24})[,! ]+/i,
      '$1! ',
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function userAskedDetailedCommercialTopic(userMessage: string): boolean {
  const n = norm(userMessage);
  return /\b(simulac|simular|parcela|entrada|prazo|juros|desconto|condicao personalizada|condicoes personalizadas)\b/.test(n);
}

function userAskedForHuman(userMessage: string): boolean {
  const n = norm(userMessage);
  return /\b(corretor|consultor|atendente|humano|pessoa)\b/.test(n);
}

function buildContextAwareSanitizedFallback(args: {
  userMessage: string;
  isKnowledgeGapTurn: boolean;
  replyBeforeSanitize: string;
}): string {
  if (isLocationRequestUserMessage(args.userMessage)) {
    return buildLocationProgressBridgeReply();
  }
  if (
    args.isKnowledgeGapTurn ||
    userAskedDetailedCommercialTopic(args.userMessage) ||
    userAskedForHuman(args.userMessage) ||
    replyLooksInfoGap(args.replyBeforeSanitize)
  ) {
    return 'Nao tenho esse detalhe validado por aqui. Posso te encaminhar para o corretor responsavel ou te ajudar a agendar uma visita. Qual prefere?';
  }
  return SPECIFIC_DETAIL_FALLBACK_STATEMENT;
}

function replyLooksInfoGap(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  const hasMissingDataCue =
    /\b(ainda nao tenho|nao tenho|nao consegui localizar|sem essa informacao|sem essa previsao)\b/.test(n);
  const hasSpecificityCue =
    /\b(informacao|previsao|dado|detalhe|liberad|exat|disponibilidade|quantidade)\b/.test(n);
  return hasMissingDataCue && hasSpecificityCue;
}

function isAffirmativeUserReply(userMessage: string): boolean {
  const n = norm(userMessage).replace(/[.!?]+$/g, '').trim();
  return /^(sim|pode ser|pode sim|quero sim|quero|ok|perfeito|fechado|claro|ta bom|tá bom|isso|pode)$/.test(n);
}

function isContinuationDemandUserReply(userMessage: string): boolean {
  const n = norm(userMessage);
  if (!n) return false;
  return (
    /\b(vc disse que ia falar mais|voce disse que ia falar mais|você disse que ia falar mais)\b/.test(n) ||
    /\b(fala mais|me explica melhor|voce falou que ia explicar|você falou que ia explicar|quero saber mais)\b/.test(n)
  );
}
function isInsistenceOrClarificationUserReply(userMessage: string): boolean {
  const n = norm(userMessage);
  if (!n) return false;
  if (isContinuationDemandUserReply(userMessage)) return true;
  return (
    /\b(nao entendi|nao ficou claro|nao ajudou|explica de novo|explica melhor|me manda certinho|onde exatamente|onde fica exatamente)\b/.test(
      n
    ) ||
    /\b(n[ãa]o entendi|n[ãa]o ficou claro|n[ãa]o ajudou)\b/.test(n)
  );
}

function isGenericDetailPromiseReply(replyText: string): boolean {
  const n = norm(replyText);
  if (!n) return false;
  return (
    /\b(vou detalhar um pouco mais|vou falar mais sobre o empreendimento|com certeza vou detalhar)\b/.test(n) ||
    /\b(com certeza)\b/.test(n) && /\b(vou detalhar|vou falar mais)\b/.test(n)
  );
}

function dedupeTopics(topics: AnaDialogueTopic[]): AnaDialogueTopic[] {
  const out: AnaDialogueTopic[] = [];
  for (const topic of topics) {
    if (out.includes(topic)) continue;
    out.push(topic);
  }
  return out;
}

function extractFollowupOfferedTopicsFromQuestion(text: string | null | undefined): AnaDialogueTopic[] {
  const raw = (text || '').trim();
  if (!raw || !/\?/.test(raw)) return [];
  const detected = detectAnaDialogueTopics(raw).filter(
    (topic) => topic !== 'outro' && topic !== 'visita' && topic !== 'corretor'
  );
  return dedupeTopics(detected);
}

function topicLabel(topic: AnaDialogueTopic): string {
  if (topic === 'lazer') return 'lazer';
  if (topic === 'seguranca') return 'seguranca';
  if (topic === 'localizacao') return 'localizacao';
  if (topic === 'valores') return 'valores';
  if (topic === 'pagamento') return 'formas de pagamento';
  return 'detalhes';
}

function buildFollowupTopicChoiceQuestion(topics: AnaDialogueTopic[], includeReminder: boolean): string {
  const unique = dedupeTopics(topics).slice(0, 2);
  if (unique.length === 0) {
    return GENERIC_SINGLE_FOLLOWUP_FALLBACK;
  }
  if (unique.length === 1) {
    return `Claro. Quer que eu te explique mais sobre ${topicLabel(unique[0] ?? 'outro')}?`;
  }
  const first = topicLabel(unique[0] ?? 'outro');
  const second = topicLabel(unique[1] ?? 'outro');
  if (includeReminder) {
    return `Claro. Eu tinha comentado que poderia te explicar mais sobre ${first} ou ${second}. Qual dos dois voce prefere ver agora?`;
  }
  return `Claro. Voce prefere que eu te explique sobre ${first} ou ${second}?`;
}

function isAssistantVisitOfferQuestion(text: string | null | undefined): boolean {
  const raw = (text || '').trim();
  const n = norm(raw);
  if (!raw || !/\?/.test(raw)) return false;
  if (containsVisitOffer(raw)) return true;
  return /\b(agendar|agendamento|marcar visita|conhecer pessoalmente|reservar horario|reservar horário)\b/.test(n);
}

type LastAssistantQuestionContext = {
  questionType:
    | 'visit_offer'
    | 'broker_handoff'
    | 'single_topic_offer'
    | 'multi_topic_offer'
    | 'followup_topics'
    | 'followup_topic'
    | 'other';
  offeredTopics: AnaDialogueTopic[];
  questionText: string | null;
  askedVisitOffer: boolean;
  askedBrokerHandoff: boolean;
  askedFollowupTopics: boolean;
};

function resolveLastAssistantQuestionContext(
  recentAssistantQuestionText: string | null,
  stateQuestionText: string | null,
  stateQuestionType: string | null,
  stateOfferedTopics: string[] | null | undefined
): LastAssistantQuestionContext {
  const fallbackTopics = dedupeTopics(
    (stateOfferedTopics ?? [])
      .map((topic) => {
        const normalized = String(topic || '').toLowerCase().trim();
        if (normalized === 'formas_pagamento') return 'pagamento';
        return normalized;
      })
      .filter(
        (topic) =>
          topic === 'lazer' ||
          topic === 'seguranca' ||
          topic === 'localizacao' ||
          topic === 'valores' ||
          topic === 'pagamento'
      ) as AnaDialogueTopic[]
  );
  const questionText = (recentAssistantQuestionText || stateQuestionText || '').trim() || null;
  const offeredTopics = questionText ? extractFollowupOfferedTopicsFromQuestion(questionText) : fallbackTopics;
  const askedVisitOffer = isAssistantVisitOfferQuestion(questionText);
  const askedBrokerHandoff = containsBrokerAsk(questionText || '');
  const askedFollowupTopics = !askedVisitOffer && !askedBrokerHandoff && offeredTopics.length > 0;
  let questionType: LastAssistantQuestionContext['questionType'] = 'other';
  if (askedVisitOffer) questionType = 'visit_offer';
  else if (askedBrokerHandoff) questionType = 'broker_handoff';
  else if (askedFollowupTopics) questionType = 'followup_topics';
  else if (
    stateQuestionType === 'visit_offer' ||
    stateQuestionType === 'broker_handoff' ||
    stateQuestionType === 'broker_offer' ||
    stateQuestionType === 'broker_or_visit_offer' ||
    stateQuestionType === 'single_topic_offer' ||
    stateQuestionType === 'multi_topic_offer' ||
    stateQuestionType === 'contextual_followup' ||
    stateQuestionType === 'clarification' ||
    stateQuestionType === 'followup_topics' ||
    stateQuestionType === 'followup_topic'
  ) {
    questionType =
      stateQuestionType === 'broker_offer'
        ? 'broker_handoff'
        : stateQuestionType === 'contextual_followup'
          ? 'followup_topic'
          : stateQuestionType === 'broker_or_visit_offer'
            ? 'followup_topics'
            : stateQuestionType === 'clarification'
              ? 'other'
              : stateQuestionType;
  }
  return {
    questionType,
    offeredTopics,
    questionText,
    askedVisitOffer,
    askedBrokerHandoff,
    askedFollowupTopics,
  };
}

function brokerAskAlreadyPresent(replyText: string): boolean {
  const n = norm(replyText);
  return /\b(encaminhe|encaminhar|encaminho)\b/.test(n) && /\bcorretor\b/.test(n) && /\?/.test(replyText);
}

function rewriteToBrokerAsk(replyText: string): string {
  const raw = (replyText || '').trim();
  if (!raw) return BROKER_HANDOFF_ASK;
  const replaced = raw
    .replace(
      /\b(esses detalhes variam[\s\S]*?)(que tal marcarmos uma visita\??|o corretor te passa tudo certinho no atendimento\.?)/gi,
      BROKER_HANDOFF_ASK,
    )
    .replace(
      /\bo corretor (pode|te passa|consegue)[\s\S]*?(?:\.|$)/gi,
      `${BROKER_HANDOFF_ASK} `,
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (brokerAskAlreadyPresent(replaced)) return replaced;
  if (/\?\s*$/.test(replaced)) return replaced;
  return `${replaced} ${BROKER_HANDOFF_ASK}`.replace(/\s{2,}/g, ' ').trim();
}

function resolveCurrentTopic(userMessage: string, replyText: string): AnaDialogueTopic {
  const topics = detectAnaDialogueTopics(`${userMessage}\n${replyText}`);
  return topics[0] ?? 'outro';
}

type AnaOfferTopic = 'lazer' | 'seguranca' | 'localizacao' | 'valores' | 'pagamento' | 'fotos' | 'video' | 'book';

type AnaOfferAvailability = AnaSafeTopicAvailability & {
  fotos?: boolean;
  video?: boolean;
  book?: boolean;
};

type AnaQuestionSentence = {
  raw: string;
  normalized: string;
  topics: AnaOfferTopic[];
};

function extractQuestionSentences(text: string): AnaQuestionSentence[] {
  const raw = String(text || '');
  const matches = raw.match(/[^?]*\?/g) ?? [];
  const out: AnaQuestionSentence[] = [];
  for (const piece of matches) {
    const sentence = piece.trim();
    if (!sentence) continue;
    out.push({
      raw: sentence,
      normalized: norm(sentence),
      topics: detectOfferedTopicsInSentence(sentence),
    });
  }
  return out;
}

function detectOfferedTopicsInSentence(text: string): AnaOfferTopic[] {
  const n = norm(text);
  const topics: AnaOfferTopic[] = [];
  if (/\b(lazer|areas? de lazer|piscina|academia|playground|quadra)\b/.test(n)) topics.push('lazer');
  if (/\b(seguranca|portaria|controle de acesso|monitoramento)\b/.test(n)) topics.push('seguranca');
  if (/\b(localizacao|onde fica|bairro|regiao|acesso|endereco|rodovia)\b/.test(n)) topics.push('localizacao');
  if (/\b(valores?|preco|quanto custa|r\$)\b/.test(n)) topics.push('valores');
  if (/\b(formas? de pagamento|pagamento|entrada|parcela|parcelamento|financiamento)\b/.test(n)) topics.push('pagamento');
  if (/\b(fotos?|imagens?|galeria)\b/.test(n)) topics.push('fotos');
  if (/\b(video|videos|v[�i]deo|v[�i]deos)\b/.test(n)) topics.push('video');
  if (/\b(book|catalogo|cat[�a]logo|pdf|material)\b/.test(n)) topics.push('book');
  return [...new Set(topics)];
}

function isGenericQuestionSentence(sentence: string): boolean {
  const normalized = norm(sentence);
  return (
    /\b(me conta|quais sao suas duvidas|quais sao as suas duvidas|vou responder todas|qualquer duvida)\b/.test(normalized) ||
    /\b(quer saber mais|o que mais)\b/.test(normalized) ||
    containsGenericLoopQuestion(sentence)
  );
}

function isOfferTopicAllowed(topic: AnaOfferTopic, availability: AnaOfferAvailability | null | undefined): boolean {
  if (!availability) return true;
  if (topic === 'lazer') return availability.lazer !== false;
  if (topic === 'seguranca') return availability.seguranca !== false;
  if (topic === 'localizacao') return availability.localizacao !== false;
  if (topic === 'valores') return availability.valores !== false;
  if (topic === 'pagamento') return availability.pagamento !== false;
  if (topic === 'fotos') return availability.fotos !== false;
  if (topic === 'video') return availability.video !== false;
  return availability.book !== false;
}

function buildQuestionForOfferTopic(topic: AnaOfferTopic): string {
  if (topic === 'lazer') return 'Quer que eu te explique as areas de lazer?';
  if (topic === 'seguranca') return 'Quer que eu te explique a seguranca do empreendimento?';
  if (topic === 'localizacao') return 'Quer que eu te fale sobre localizacao?';
  if (topic === 'valores') return 'Quer saber tambem sobre valores?';
  if (topic === 'pagamento') return 'Quer que eu te explique as formas de pagamento?';
  if (topic === 'fotos') return 'Quer que eu te envie algumas fotos?';
  if (topic === 'video') return 'Quer que eu te envie o video?';
  return 'Quer que eu te envie o Book?';
}

function topicFromFollowupLabel(topic: string | null | undefined): DeterministicTopic | null {
  const n = norm(topic || '');
  if (!n) return null;
  if (n === 'lazer') return 'lazer';
  if (n === 'seguranca') return 'seguranca';
  if (n === 'localizacao') return 'localizacao';
  if (n === 'valores') return 'valores';
  if (n === 'pagamento' || n === 'formas_pagamento' || n === 'formas de pagamento') return 'pagamento';
  return null;
}

function normalizeOfferedTopics(topics: AnaDialogueTopic[]): DeterministicTopic[] {
  const out: DeterministicTopic[] = [];
  for (const topic of topics) {
    const mapped = topicFromFollowupLabel(topic);
    if (!mapped || out.includes(mapped)) continue;
    out.push(mapped);
  }
  return out;
}

function detectLotCountInfoGapRequest(userMessage: string): boolean {
  const n = norm(userMessage);
  if (!n) return false;
  return (
    /\bquantos?\s+lotes?\b/.test(n) ||
    /\bnumero\s+de\s+lotes?\b/.test(n) ||
    /\bvai\s+ter\s+quantos?\s+lotes?\b/.test(n)
  );
}

function detectDirectDeterministicTopicRequest(userMessage: string): DeterministicTopic | null {
  if (detectLotCountInfoGapRequest(userMessage)) return 'lot_count';
  if (isAffirmativeUserReply(userMessage) || isAckLikeMessage(userMessage)) return null;
  const n = norm(userMessage);
  if (!n) return null;
  if (isContinuationDemandUserReply(userMessage)) return null;

  if (/\b(seguranca|portaria|controle de acesso|monitoramento)\b/.test(n)) return 'seguranca';
  if (/\b(lazer|areas? de lazer|piscina|academia|playground|quadra|coworking|espaco zen|fireplace)\b/.test(n)) {
    return 'lazer';
  }
  if (/\b(localizacao|onde fica|bairro|regiao|acesso|endereco|rodovia)\b/.test(n)) return 'localizacao';
  if (/\b(formas? de pagamento|pagamento|entrada|parcela|parcelamento|financiamento)\b/.test(n)) {
    return 'pagamento';
  }
  if (/\b(valores?|preco|quanto custa|r\$)\b/.test(n)) return 'valores';
  return null;
}

function replyLooksLikeTopicOfferLoop(text: string): boolean {
  const n = norm(text);
  if (!n) return false;
  return (
    /\bquer que eu te explique\b/.test(n) ||
    /\bquer saber tambem sobre\b/.test(n) ||
    /\bvoce quer saber mais sobre\b/.test(n)
  );
}

function replyAnswersDeterministicTopic(replyText: string, topic: DeterministicTopic): boolean {
  const n = norm(replyText);
  if (!n) return false;
  if (topic === 'lot_count') {
    return /\bainda nao tenho essa informacao exata liberada por aqui\b/.test(n);
  }
  if (topic === 'seguranca') {
    return /\bportaria 24 horas com controle de acesso\b/.test(n);
  }
  if (topic === 'lazer') {
    return (
      /\bpiscina adulto\b/.test(n) &&
      /\bacademia\b/.test(n) &&
      /\bsalao de festas\b/.test(n) &&
      /\bcampo society\b/.test(n)
    );
  }
  if (topic === 'pagamento') {
    return /\b120x\b/.test(n) && /\b48x\b/.test(n);
  }
  if (topic === 'localizacao') {
    return /\batibaia\b/.test(n) && /\b(rodovia dom pedro i|pedreira)\b/.test(n);
  }
  return /\br\$\s*279\.000,00\b/i.test(replyText) || /\br\$\s*775,00\b/i.test(replyText);
}

function buildCanonicalLazerReply(): string {
  return [
    'As areas de lazer do Evora incluem:',
    'Piscina adulto',
    'Academia',
    'Salao de festas',
    'Playground',
    'Coworking',
    'Espaco zen',
    'Fireplace',
    'Quadra de beach tennis',
    'Campo society',
    'Estacao para carros eletricos',
    'Portaria 24h com controle de acesso.',
  ].join('\n');
}

function buildCanonicalPagamentoReply(): string {
  return [
    'Temos algumas formas de pagamento que podem se encaixar na sua realidade.',
    '',
    'Para parcelas mais baixas, existem planos estendidos em ate 120x.',
    '',
    'Para parcelamento sem juros, ha opcoes em ate 48x.',
    '',
    'O financiamento pode ser direto com a construtora, com menos burocracia e mais facilidade para voce.',
  ].join('\n');
}

function buildCanonicalSegurancaReply(opts: { shouldOfferLazer: boolean }): string {
  const base = 'O Evora conta com portaria 24 horas com controle de acesso.';
  if (!opts.shouldOfferLazer) return base;
  return `${base} Quer que eu te fale tambem sobre lazer?`;
}

function buildCanonicalLocalizacaoReply(): string {
  return 'O Evora fica em Atibaia, na regiao da Pedreira/Rio Abaixo, com acesso pela Rodovia Dom Pedro I, a cerca de 50 minutos de Sao Paulo, em uma regiao com qualidade de vida e contato com a natureza.';
}

function buildCanonicalValoresReply(): string {
  return 'O valor inicial do Evora e a partir de R$279.000,00, e o metro quadrado comeca em R$775,00.';
}

function buildLotCountInfoGapReply(): string {
  return 'No Evora, os lotes ficam na faixa de 360 m2 a 775 m2. Para confirmar metragem especifica e unidade disponivel, o corretor responsavel valida em tempo real.';
}

function buildDeterministicTopicReply(params: {
  topic: DeterministicTopic;
  recentlyDiscussedTopics: string[];
}): string {
  if (params.topic === 'lot_count') return buildLotCountInfoGapReply();
  if (params.topic === 'lazer') return buildCanonicalLazerReply();
  if (params.topic === 'seguranca') {
    const discussed = (params.recentlyDiscussedTopics ?? []).map((topic) => norm(topic));
    const shouldOfferLazer = !discussed.includes('lazer');
    return buildCanonicalSegurancaReply({ shouldOfferLazer });
  }
  if (params.topic === 'pagamento') return buildCanonicalPagamentoReply();
  if (params.topic === 'localizacao') return buildCanonicalLocalizacaoReply();
  return buildCanonicalValoresReply();
}

export function resolveRequestedTopicAction(input: {
  userMessage: string;
  replyText: string;
  lastAssistantQuestionContext: LastAssistantQuestionContext;
}): RequestedTopicAction {
  const directTopic = detectDirectDeterministicTopicRequest(input.userMessage);
  if (directTopic) {
    return {
      type: 'direct_topic_request',
      topic: directTopic,
      offeredTopics: input.lastAssistantQuestionContext.offeredTopics,
    };
  }

  const userAffirmative = isAffirmativeUserReply(input.userMessage) || isAckLikeMessage(input.userMessage);
  const offeredTopics = normalizeOfferedTopics(input.lastAssistantQuestionContext.offeredTopics);
  if (
    userAffirmative &&
    input.lastAssistantQuestionContext.askedFollowupTopics &&
    !input.lastAssistantQuestionContext.askedVisitOffer &&
    !input.lastAssistantQuestionContext.askedBrokerHandoff
  ) {
    if (offeredTopics.length === 1) {
      return {
        type: 'accepted_topic_offer',
        topic: offeredTopics[0] ?? null,
        offeredTopics: input.lastAssistantQuestionContext.offeredTopics,
      };
    }
    return {
      type: 'ambiguous_followup',
      topic: null,
      offeredTopics: input.lastAssistantQuestionContext.offeredTopics,
    };
  }

  if (replyLooksLikeTopicOfferLoop(input.replyText)) {
    return {
      type: 'proactive_next_topic_offer',
      topic: null,
      offeredTopics: input.lastAssistantQuestionContext.offeredTopics,
    };
  }

  return {
    type: 'ambiguous_followup',
    topic: null,
    offeredTopics: input.lastAssistantQuestionContext.offeredTopics,
  };
}

function ensureSingleFinalQuestion(params: {
  text: string;
  currentTopic: AnaDialogueTopic;
  safeTopicAvailability?: AnaOfferAvailability | null;
  recentlyDiscussedTopics: string[];
  recentlyAskedTopics: string[];
  recentAssistantReplies: string[];
}): { text: string; changed: boolean; unsupportedTopics: AnaOfferTopic[] } {
  const raw = String(params.text || '').trim();
  if (!raw) return { text: raw, changed: false, unsupportedTopics: [] };

  let next = raw;
  let changed = false;
  const removedUnsupportedTopics: AnaOfferTopic[] = [];
  const genericLeadRemoved = stripGenericLoopQuestion(
    next
      .replace(/\bme conta,\s*quais sao suas duvidas\?\s*vou responder todas\.?/i, '')
      .replace(/\bme conta,\s*quais s[a�]o suas d[u�]vidas\?\s*vou responder todas\.?/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
  if (genericLeadRemoved !== next) {
    next = genericLeadRemoved;
    changed = true;
  }
  const questions = extractQuestionSentences(next);
  if (questions.length === 0) {
    return { text: next, changed: false, unsupportedTopics: [] };
  }

  const allowedQuestions = questions.filter((q) => {
    const blockedTopics = q.topics.filter((topic) => !isOfferTopicAllowed(topic, params.safeTopicAvailability));
    if (blockedTopics.length === 0) return true;
    for (const topic of blockedTopics) {
      if (!removedUnsupportedTopics.includes(topic)) removedUnsupportedTopics.push(topic);
    }
    return false;
  });

  if (allowedQuestions.length !== questions.length) {
    for (const question of questions) {
      if (!allowedQuestions.includes(question)) {
        next = next.replace(question.raw, '').replace(/\s{2,}/g, ' ').trim();
      }
    }
    changed = true;
  }

  let normalizedQuestions = extractQuestionSentences(next);
  if (normalizedQuestions.length === 0) {
    const fallback = GENERIC_SINGLE_FOLLOWUP_FALLBACK;
    if (next.length > 0 && !/[.!?]$/.test(next)) next = `${next}.`;
    next = `${next} ${fallback}`.replace(/\s{2,}/g, ' ').trim();
    return { text: next, changed: true, unsupportedTopics: removedUnsupportedTopics };
  }

  const nonGeneric = normalizedQuestions.filter((q) => !isGenericQuestionSentence(q.raw));
  if (nonGeneric.length > 0 && nonGeneric.length !== normalizedQuestions.length) {
    for (const question of normalizedQuestions) {
      if (isGenericQuestionSentence(question.raw)) {
        next = next.replace(question.raw, '').replace(/\s{2,}/g, ' ').trim();
      }
    }
    changed = true;
    normalizedQuestions = extractQuestionSentences(next);
  }

  if (normalizedQuestions.length === 0) {
    const fallback = GENERIC_SINGLE_FOLLOWUP_FALLBACK;
    if (next.length > 0 && !/[.!?]$/.test(next)) next = `${next}.`;
    next = `${next} ${fallback}`.replace(/\s{2,}/g, ' ').trim();
    return { text: next, changed: true, unsupportedTopics: removedUnsupportedTopics };
  }

  let selectedQuestion = normalizedQuestions[normalizedQuestions.length - 1] ?? null;
  const hasMultipleTopicsInSelected = (selectedQuestion?.topics?.length ?? 0) > 1;
  if (selectedQuestion && hasMultipleTopicsInSelected) {
    const preferredTopic =
      selectedQuestion.topics.find((topic) => isOfferTopicAllowed(topic, params.safeTopicAvailability)) ?? null;
    const replacement = preferredTopic ? buildQuestionForOfferTopic(preferredTopic) : null;
    if (replacement) {
      next = next.replace(selectedQuestion.raw, replacement).replace(/\s{2,}/g, ' ').trim();
      changed = true;
      normalizedQuestions = extractQuestionSentences(next);
      selectedQuestion = normalizedQuestions[normalizedQuestions.length - 1] ?? null;
    }
  }

  if ((selectedQuestion?.topics.length ?? 0) === 0) {
    const selectedFromPolicy = selectAnaNextFollowupQuestion({
      currentTopic: params.currentTopic,
      recentlyDiscussedTopics: params.recentlyDiscussedTopics,
      recentlyAskedTopics: params.recentlyAskedTopics,
      recentAssistantReplies: params.recentAssistantReplies,
      allowedTopics: params.safeTopicAvailability ?? null,
    });
    if (selectedFromPolicy.question) {
      next = next.replace(selectedQuestion?.raw ?? '', selectedFromPolicy.question).replace(/\s{2,}/g, ' ').trim();
      changed = true;
      normalizedQuestions = extractQuestionSentences(next);
      selectedQuestion = normalizedQuestions[normalizedQuestions.length - 1] ?? null;
    }
  }

  if (normalizedQuestions.length > 1) {
    for (const question of normalizedQuestions.slice(0, -1)) {
      next = next.replace(question.raw, '').replace(/\s{2,}/g, ' ').trim();
    }
    changed = true;
  }

  if (!/\?\s*$/.test(next)) {
    const chosen = extractQuestionSentences(next).slice(-1)[0] ?? null;
    if (!chosen) {
      if (next.length > 0 && !/[.!?]$/.test(next)) next = `${next}.`;
      next = `${next} ${GENERIC_SINGLE_FOLLOWUP_FALLBACK}`.replace(/\s{2,}/g, ' ').trim();
      changed = true;
    }
  }

  return {
    text: next,
    changed,
    unsupportedTopics: removedUnsupportedTopics,
  };
}

export interface ApplyAnaConversationPolicyInput {
  conversationId: number;
  userMessage: string;
  replyText: string;
  isFirstAnaReply: boolean;
  flowState: CommercialFlowState;
  recentMessages: Array<{ role: 'user' | 'assistant'; content?: string | null }>;
  knownCustomerName?: string | null;
  probableCustomerName?: string | null;
  now?: Date;
  disableFollowupQuestion?: boolean;
  visitFlowActive?: boolean;
  shortConfirmationContext?: {
    kind?:
      | 'visit_confirmation'
      | 'broker_confirmation'
      | 'followup_topic_confirmation'
      | 'media_confirmation'
      | 'ambiguous_confirmation'
      | 'not_short_confirmation'
      | null;
    lastAssistantQuestionType?: string | null;
    lastAssistantQuestionText?: string | null;
    lastOfferedTopics?: string[] | null;
  };
  safeTopicAvailability?: AnaOfferAvailability | null;
  knowledgeDrivenMode?: boolean;
  isKnowledgeGapTurn?: boolean;
}

export interface ApplyAnaConversationPolicyResult {
  text: string;
  flowState: CommercialFlowState;
  changed: boolean;
}

export interface AnaReengagementPolicyInput {
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  now?: Date;
  minIdleMinutes?: number;
}

export interface AnaReengagementPolicyResult {
  allowed: boolean;
  reason: 'ok' | 'recent_inbound' | 'recent_outbound' | 'active_conversation';
  activeConversation: boolean;
}

export function evaluateAnaReengagementPolicy(
  input: AnaReengagementPolicyInput
): AnaReengagementPolicyResult {
  const now = input.now ?? new Date();
  const minIdleMinutes = Number.isFinite(input.minIdleMinutes ?? NaN)
    ? Math.max(1, Number(input.minIdleMinutes))
    : 60;
  const minIdleMs = minIdleMinutes * 60_000;
  const lastInboundMs = input.lastInboundAt ? input.lastInboundAt.getTime() : NaN;
  const lastOutboundMs = input.lastOutboundAt ? input.lastOutboundAt.getTime() : NaN;
  const inboundRecent = Number.isFinite(lastInboundMs) && now.getTime() - lastInboundMs < minIdleMs;
  const outboundRecent = Number.isFinite(lastOutboundMs) && now.getTime() - lastOutboundMs < minIdleMs;
  if (inboundRecent) return { allowed: false, reason: 'recent_inbound', activeConversation: true };
  if (outboundRecent) return { allowed: false, reason: 'recent_outbound', activeConversation: true };
  const closeExchange =
    Number.isFinite(lastInboundMs) &&
    Number.isFinite(lastOutboundMs) &&
    Math.abs(lastInboundMs - lastOutboundMs) < minIdleMs;
  if (closeExchange) return { allowed: false, reason: 'active_conversation', activeConversation: true };
  return { allowed: true, reason: 'ok', activeConversation: false };
}

export function applyAnaConversationPolicy(
  input: ApplyAnaConversationPolicyInput
): ApplyAnaConversationPolicyResult {
  const appliedRules: string[] = [];
  let reply = (input.replyText || '').trim();
  const recentAssistantReplies = input.recentMessages
    .filter((msg) => msg.role === 'assistant')
    .map((msg) => String(msg.content ?? '').trim())
    .filter((msg) => msg.length > 0)
    .slice(-6);
  let nextState = input.flowState;
  const initialState = getAnaDialoguePolicyState(nextState);
  let state = initialState;
  const hasKnownName = (input.knownCustomerName || '').trim().length >= 2;
  const visitFlowActive =
    input.visitFlowActive === true ||
    input.flowState.pendingVisitScheduling === true ||
    input.flowState.visitScheduling?.active === true;
  const visitAlreadyScheduled =
    input.flowState.pendingVisitScheduling !== true &&
    input.flowState.visitScheduling?.status === 'scheduled';
  const lastAssistantQuestionFromHistory = recentAssistantReplies[recentAssistantReplies.length - 1] ?? null;
  const shortConfirmationContext = input.shortConfirmationContext ?? null;
  const shortConfirmationKind = shortConfirmationContext?.kind ?? null;
  const overrideQuestionType = shortConfirmationContext?.lastAssistantQuestionType ?? null;
  const overrideQuestionText = shortConfirmationContext?.lastAssistantQuestionText ?? null;
  const overrideOfferedTopics = shortConfirmationContext?.lastOfferedTopics ?? null;
  const safeTopicAvailability = input.safeTopicAvailability ?? null;
  const knowledgeDrivenMode = input.knowledgeDrivenMode === true;
  const isKnowledgeGapTurn = input.isKnowledgeGapTurn === true;

  if (visitFlowActive && !visitAlreadyScheduled) {
    console.log('[ANA_VISIT_FLOW_ACTIVE]', {
      conversationId: input.conversationId,
      pendingVisitScheduling: input.flowState.pendingVisitScheduling === true,
      visitStatus: input.flowState.visitScheduling?.status ?? null,
    });
  }

  if (!visitFlowActive && input.isFirstAnaReply) {
    const originalReplyNorm = norm(reply);
    const forbiddenFirstGreetingPhrasesPresent =
      /\bquer saber tambem sobre localizacao\?/.test(originalReplyNorm) ||
      /\bvou responder todas\.?/.test(originalReplyNorm);
    const hadStaleQuestionContext =
      (state.lastAssistantQuestionType ?? null) != null ||
      (state.lastAssistantQuestionText ?? null) != null ||
      (state.lastOfferedTopics ?? []).length > 0;
    const staleLeadingCta = stripLeadingStaleTopicCta(reply);
    if (hadStaleQuestionContext || staleLeadingCta.changed) {
      if (staleLeadingCta.changed) reply = staleLeadingCta.text;
      nextState = mergeAnaDialoguePolicyState(nextState, {
        lastFollowupQuestion: null,
        recentlyAskedTopics: [],
        lastAssistantQuestionType: null,
        lastAssistantQuestionText: null,
        lastOfferedTopics: [],
      });
      state = getAnaDialoguePolicyState(nextState);
      appliedRules.push('first_greeting_stale_cta_suppressed');
      console.log('[ANA_FIRST_GREETING_STALE_CTA_SUPPRESSED]', {
        conversationId: input.conversationId,
        hadStaleQuestionContext,
        staleLeadingCtaRemoved: staleLeadingCta.changed,
      });
    }
    if (forbiddenFirstGreetingPhrasesPresent) {
      console.log('[ANA_FIRST_GREETING_FORBIDDEN_PHRASE_REMOVED]', {
        conversationId: input.conversationId,
        source: 'conversation_policy_first_reply',
      });
    }
  }

  const lastAssistantQuestionContext = resolveLastAssistantQuestionContext(
    overrideQuestionText || lastAssistantQuestionFromHistory,
    overrideQuestionText || (state.lastAssistantQuestionText ?? null),
    overrideQuestionType || (state.lastAssistantQuestionType ?? null),
    overrideOfferedTopics ?? state.lastOfferedTopics ?? []
  );
  const userAffirmative = isAffirmativeUserReply(input.userMessage) || isAckLikeMessage(input.userMessage);
  const userContinuationDemand = isContinuationDemandUserReply(input.userMessage);
  const requestedTopicAction = resolveRequestedTopicAction({
    userMessage: input.userMessage,
    replyText: reply,
    lastAssistantQuestionContext,
  });
  let resolvedTopicAction: DeterministicTopic | null = null;
  const userInsistingForProgress = isInsistenceOrClarificationUserReply(input.userMessage);
  const recentGenericLoopCount = recentAssistantReplies
    .slice(-3)
    .filter((msg) => containsGenericLoopQuestion(msg)).length;

  if (!isKnowledgeGapTurn && containsGenericLoopQuestion(reply)) {
    const stripped = stripGenericLoopQuestion(reply);
    reply = stripped
      ? `${stripped} ${GENERIC_SINGLE_FOLLOWUP_FALLBACK}`.replace(/\s{2,}/g, ' ').trim()
      : GENERIC_SINGLE_FOLLOWUP_FALLBACK;
    appliedRules.push('generic_loop_question_replaced');
    console.log('[ANA_GENERIC_LOOP_QUESTION_REPLACED]', {
      conversationId: input.conversationId,
    });
  }

  if (
    !isKnowledgeGapTurn &&
    !visitFlowActive &&
    userInsistingForProgress &&
    recentGenericLoopCount > 0 &&
    !brokerAskAlreadyPresent(reply) &&
    !containsVisitOffer(reply)
  ) {
    reply = GENERIC_SINGLE_FOLLOWUP_FALLBACK;
    appliedRules.push('insistence_forced_progress_question');
    console.log('[ANA_INSISTENCE_FORCED_PROGRESS_QUESTION]', {
      conversationId: input.conversationId,
      recentGenericLoopCount,
    });
  }

  if (!visitFlowActive && input.isFirstAnaReply) {
    const greeted = ensureFirstReplyGreeting(reply, input.now);
    if (greeted.changed) {
      reply = greeted.text;
      appliedRules.push('first_reply_contextual_greeting');
      nextState = mergeAnaDialoguePolicyState(nextState, { greetedAt: new Date().toISOString() });
      console.log('[ANA_GREETING_APPLIED]', {
        conversationId: input.conversationId,
        greetingPreview: reply.slice(0, 80),
      });
    }
  } else if (!visitFlowActive) {
    const hadGreeting = startsWithGreeting(reply);
    const noMidGreeting = stripMidConversationGreeting(reply);
    if (noMidGreeting.changed) {
      reply = noMidGreeting.text;
      appliedRules.push('mid_conversation_greeting_removed');
      if (hadGreeting) {
        console.log('[ANA_GREETING_SUPPRESSED_ALREADY_ACTIVE]', {
          conversationId: input.conversationId,
        });
      }
    }
  }

  if (!hasKnownName && isUncertainDisplayName(input.probableCustomerName)) {
    const scrubbed = removeUnconfirmedVocativeName(reply);
    if (scrubbed !== reply) {
      reply = scrubbed;
      appliedRules.push('uncertain_name_vocative_removed');
    }
    nextState = mergeAnaDialoguePolicyState(nextState, { nameUncertainAt: new Date().toISOString() });
    console.log('[ANA_CONTACT_NAME_UNCERTAIN]', {
      conversationId: input.conversationId,
      probableName: input.probableCustomerName ?? null,
    });
    console.log('[ANA_CONTACT_NICKNAME_IGNORED]', {
      conversationId: input.conversationId,
      source: 'probable_display_name',
      probableName: input.probableCustomerName ?? null,
    });
  }

  if (
    !knowledgeDrivenMode &&
    !visitFlowActive &&
    (requestedTopicAction.type === 'direct_topic_request' || requestedTopicAction.type === 'accepted_topic_offer') &&
    requestedTopicAction.topic
  ) {
    const deterministicReply = buildDeterministicTopicReply({
      topic: requestedTopicAction.topic,
      recentlyDiscussedTopics: state.recentlyDiscussedTopics ?? [],
    });
    const suppressedLoop = replyLooksLikeTopicOfferLoop(reply);
    const alreadyAnswered = replyAnswersDeterministicTopic(reply, requestedTopicAction.topic);
    if (!alreadyAnswered || suppressedLoop || norm(reply) === norm(BANNED_GENERIC_FALLBACK)) {
      reply = deterministicReply;
      resolvedTopicAction = requestedTopicAction.topic;
      if (suppressedLoop) {
        console.log('[ANA_TOPIC_OFFER_LOOP_SUPPRESSED]', {
          conversationId: input.conversationId,
          actionType: requestedTopicAction.type,
          topic: requestedTopicAction.topic,
        });
      }
      if (requestedTopicAction.type === 'direct_topic_request') {
        appliedRules.push('direct_topic_request_answered');
        console.log('[ANA_DIRECT_TOPIC_REQUEST_ANSWERED]', {
          conversationId: input.conversationId,
          topic: requestedTopicAction.topic,
        });
      } else {
        appliedRules.push('accepted_topic_offer_answered');
        console.log('[ANA_ACCEPTED_TOPIC_OFFER_ANSWERED]', {
          conversationId: input.conversationId,
          topic: requestedTopicAction.topic,
          offeredTopics: requestedTopicAction.offeredTopics,
        });
      }
      if (requestedTopicAction.topic === 'lot_count') {
        console.log('[ANA_LOT_COUNT_INFO_GAP_HANDLED]', {
          conversationId: input.conversationId,
          source: requestedTopicAction.type,
        });
      }
    } else {
      resolvedTopicAction = requestedTopicAction.topic;
      if (requestedTopicAction.type === 'direct_topic_request') {
        console.log('[ANA_DIRECT_TOPIC_REQUEST_ANSWERED]', {
          conversationId: input.conversationId,
          topic: requestedTopicAction.topic,
          source: 'already_answered',
        });
      } else {
        console.log('[ANA_ACCEPTED_TOPIC_OFFER_ANSWERED]', {
          conversationId: input.conversationId,
          topic: requestedTopicAction.topic,
          source: 'already_answered',
        });
      }
      if (requestedTopicAction.topic === 'lot_count') {
        console.log('[ANA_LOT_COUNT_INFO_GAP_HANDLED]', {
          conversationId: input.conversationId,
          source: 'already_answered',
        });
      }
    }
  }

  if (norm(reply).includes(norm(BANNED_GENERIC_FALLBACK))) {
    const replacementTopic = resolvedTopicAction ?? detectDirectDeterministicTopicRequest(input.userMessage);
    if (!knowledgeDrivenMode && replacementTopic) {
      reply = buildDeterministicTopicReply({
        topic: replacementTopic,
        recentlyDiscussedTopics: state.recentlyDiscussedTopics ?? [],
      });
      if (replacementTopic === 'lot_count') {
        console.log('[ANA_LOT_COUNT_INFO_GAP_HANDLED]', {
          conversationId: input.conversationId,
          source: 'banned_generic_fallback_replacement',
        });
      }
    } else {
      const cleaned = (reply || '').replace(new RegExp(BANNED_GENERIC_FALLBACK, 'ig'), '').replace(/\s{2,}/g, ' ').trim();
      reply =
        cleaned ||
        buildContextAwareSanitizedFallback({
          userMessage: input.userMessage,
          isKnowledgeGapTurn,
          replyBeforeSanitize: reply,
        });
    }
    appliedRules.push('bad_generic_fallback_blocked');
    console.log('[ANA_BAD_GENERIC_FALLBACK_BLOCKED]', {
      conversationId: input.conversationId,
      replacementTopic: replacementTopic ?? null,
    });
  }

  if (!knowledgeDrivenMode && !visitFlowActive && (userAffirmative || userContinuationDemand)) {
    const replyLooksVisitScheduling = containsVisitOffer(reply) || looksLikeVisitFlowReply(reply);
    if (userAffirmative && replyLooksVisitScheduling && !lastAssistantQuestionContext.askedVisitOffer) {
      console.log('[ANA_VISIT_CONFIRMATION_REJECTED_NO_VISIT_CONTEXT]', {
        conversationId: input.conversationId,
        userMessage: input.userMessage,
        lastAssistantQuestionType: lastAssistantQuestionContext.questionType,
        lastAssistantQuestionText: lastAssistantQuestionContext.questionText,
      });
    }

    if (
      !lastAssistantQuestionContext.askedVisitOffer &&
      !lastAssistantQuestionContext.askedBrokerHandoff &&
      lastAssistantQuestionContext.askedFollowupTopics &&
      !userAffirmative
    ) {
      const shouldResolvePendingFollowup =
        shortConfirmationKind === 'followup_topic_confirmation' ||
        userContinuationDemand ||
        lastAssistantQuestionContext.offeredTopics.length > 1 ||
        replyLooksVisitScheduling ||
        isGenericDetailPromiseReply(reply);
      if (shouldResolvePendingFollowup) {
        reply = buildFollowupTopicChoiceQuestion(
          lastAssistantQuestionContext.offeredTopics,
          userContinuationDemand
        );
        appliedRules.push('pending_followup_resolved');
        console.log('[ANA_PENDING_FOLLOWUP_RESOLVED]', {
          conversationId: input.conversationId,
          offeredTopics: lastAssistantQuestionContext.offeredTopics,
          trigger: userContinuationDemand ? 'continuation_request' : 'guard',
        });
      }
    } else if (requestedTopicAction.type === 'ambiguous_followup') {
      const pendingTopics = lastAssistantQuestionContext.offeredTopics;
      if (
        !lastAssistantQuestionContext.askedVisitOffer &&
        !lastAssistantQuestionContext.askedBrokerHandoff &&
        lastAssistantQuestionContext.askedFollowupTopics &&
        pendingTopics.length > 1
      ) {
        reply = buildFollowupTopicChoiceQuestion(pendingTopics, userContinuationDemand);
        appliedRules.push('pending_followup_resolved_ambiguous_multi_topic');
      } else if (
        (userContinuationDemand || userAffirmative || shortConfirmationKind === 'ambiguous_confirmation') &&
        !lastAssistantQuestionContext.askedVisitOffer &&
        !lastAssistantQuestionContext.askedBrokerHandoff &&
        !lastAssistantQuestionContext.askedFollowupTopics
      ) {
        reply = GENERIC_SINGLE_FOLLOWUP_FALLBACK;
        appliedRules.push('pending_followup_ambiguous');
      }
      console.log('[ANA_PENDING_FOLLOWUP_AMBIGUOUS]', {
        conversationId: input.conversationId,
        trigger: userContinuationDemand ? 'continuation_request_without_pending_topic' : 'affirmative_without_pending_topic',
      });
    }
  }

  const infoGapReply = replyLooksInfoGap(reply);
  if (isKnowledgeGapTurn) {
    console.log('[ANA_KNOWLEDGE_GAP_SKIPPED_LEGACY_BROKER_POLICY]', {
      conversationId: input.conversationId,
      reason: 'is_knowledge_gap_turn',
    });
  } else {
    const needsBrokerAsk =
      userAskedDetailedCommercialTopic(input.userMessage) || userAskedForHuman(input.userMessage) || infoGapReply;
    const recentBrokerAsk =
      recentAssistantReplies.length > 0 &&
      recentAssistantReplies.slice(-2).some((msg) => containsBrokerAsk(msg));
    const infoGapBrokerAskAlreadyPresent = infoGapReply && brokerAskAlreadyPresent(reply);
    if (needsBrokerAsk && recentBrokerAsk) {
      const stripped = stripBrokerAsk(reply);
      if (stripped && stripped !== reply) {
        reply = stripped;
        appliedRules.push('broker_handoff_duplicate_suppressed');
      }
      console.log('[ANA_BROKER_HANDOFF_SUPPRESSED_DUPLICATE]', {
        conversationId: input.conversationId,
      });
    } else if (needsBrokerAsk && !visitFlowActive && !brokerAskAlreadyPresent(reply)) {
      const withBrokerAsk = rewriteToBrokerAsk(reply);
      if (withBrokerAsk !== reply) {
        reply = withBrokerAsk;
        appliedRules.push('broker_handoff_question_asked');
        nextState = mergeAnaDialoguePolicyState(nextState, { lastBrokerHandoffAskedAt: new Date().toISOString() });
        console.log('[ANA_BROKER_HANDOFF_ASKED]', {
          conversationId: input.conversationId,
        });
        if (infoGapReply) {
          console.log('[ANA_INFO_GAP_BROKER_HANDOFF_ASKED]', {
            conversationId: input.conversationId,
            source: 'conversation_policy_rewrite',
          });
        }
      }
    } else if (infoGapBrokerAskAlreadyPresent) {
      console.log('[ANA_INFO_GAP_BROKER_HANDOFF_ASKED]', {
        conversationId: input.conversationId,
        source: 'conversation_policy_already_present',
      });
    }
  }

  const lastAssistantAskedBroker = lastAssistantQuestionContext.askedBrokerHandoff;
  if (!isKnowledgeGapTurn && lastAssistantAskedBroker && userAffirmative) {
    reply = 'Perfeito, vou encaminhar para um corretor te passar certinho.';
    nextState = mergeAnaDialoguePolicyState(nextState, { brokerHandoffAcceptedAt: new Date().toISOString() });
    appliedRules.push('broker_handoff_confirmed');
    console.log('[ANA_BROKER_HANDOFF_ACCEPTED]', {
      conversationId: input.conversationId,
    });
  }

  if (visitFlowActive && !visitAlreadyScheduled) {
    const hasTopicSwitchIntent =
      containsMediaOffer(reply) ||
      /\b(lazer|localizacao|localização|infraestrutura|pagamento|valor|seguranca|segurança|book|vídeo|video|foto|fotos)\b/.test(norm(reply));
    const replyNeedsVisitAnchor = !looksLikeVisitFlowReply(reply) || isAckLikeMessage(input.userMessage);
    if (hasTopicSwitchIntent || replyNeedsVisitAnchor) {
      const anchoredVisitReply = askVisitMissingSlotQuestion(nextState, hasKnownName, input.userMessage);
      if (anchoredVisitReply !== reply) {
        if (containsMediaOffer(reply)) {
          console.log('[ANA_MEDIA_OFFER_SUPPRESSED_VISIT_FLOW]', {
            conversationId: input.conversationId,
          });
        }
        reply = anchoredVisitReply;
        appliedRules.push('visit_flow_topic_switch_suppressed');
        console.log('[ANA_VISIT_FLOW_TOPIC_SWITCH_SUPPRESSED]', {
          conversationId: input.conversationId,
          visitStatus: nextState.visitScheduling?.status ?? null,
        });
      }
    }
  }

  const hasRepeatedVisitCta = containsVisitOffer(reply) && recentAssistantReplies.slice(-3).some((msg) => containsVisitOffer(msg));
  if (hasRepeatedVisitCta) {
    const stripped = stripVisitOffer(reply);
    if (stripped && stripped !== reply) {
      reply = stripped;
      appliedRules.push('visit_cta_repeat_suppressed');
      console.log('[ANA_CTA_REPEAT_SUPPRESSED]', {
        conversationId: input.conversationId,
        ctaType: 'visit_offer',
      });
    }
  }
  const hasRepeatedMediaCta = containsMediaOffer(reply) && recentAssistantReplies.slice(-3).some((msg) => containsMediaOffer(msg));
  if (hasRepeatedMediaCta) {
    const stripped = stripMediaOffer(reply);
    if (stripped && stripped !== reply) {
      reply = stripped;
      appliedRules.push('media_cta_repeat_suppressed');
      console.log('[ANA_CTA_REPEAT_SUPPRESSED]', {
        conversationId: input.conversationId,
        ctaType: 'media_offer',
      });
      console.log('[ANA_MEDIA_OFFER_SUPPRESSED_REPEAT]', {
        conversationId: input.conversationId,
      });
    }
  }

  const discussedNow = detectAnaDialogueTopics(`${input.userMessage}\n${reply}`);
  nextState = pushAnaDialogueTopics(nextState, { discussed: discussedNow });

  const suppressNextQuestionForInfoGap = replyLooksInfoGap(reply) && brokerAskAlreadyPresent(reply);
  if (suppressNextQuestionForInfoGap) {
    console.log('[ANA_NEXT_QUESTION_SUPPRESSED_INFO_GAP]', {
      conversationId: input.conversationId,
    });
  }

  const shouldSelectNextQuestion =
    !knowledgeDrivenMode &&
    !input.disableFollowupQuestion &&
    !visitFlowActive &&
    reply.length > 0 &&
    !/\?\s*$/.test(reply) &&
    !brokerAskAlreadyPresent(reply) &&
    !userAffirmative &&
    requestedTopicAction.type !== 'direct_topic_request' &&
    requestedTopicAction.type !== 'accepted_topic_offer' &&
    !suppressNextQuestionForInfoGap;

  if (shouldSelectNextQuestion) {
    const currentTopic = resolveCurrentTopic(input.userMessage, reply);
    const latest = getAnaDialoguePolicyState(nextState);
    const nextQuestion = selectAnaNextFollowupQuestion({
      currentTopic,
      recentlyDiscussedTopics: latest.recentlyDiscussedTopics ?? [],
      recentlyAskedTopics: latest.recentlyAskedTopics ?? [],
      recentAssistantReplies,
      allowedTopics: safeTopicAvailability,
    });
    if (nextQuestion.question) {
      reply = `${reply} ${nextQuestion.question}`.replace(/\s{2,}/g, ' ').trim();
      appliedRules.push('next_followup_question_selected');
      nextState = mergeAnaDialoguePolicyState(nextState, {
        lastFollowupQuestion: nextQuestion.question,
        recentlyAskedTopics: [
          String(nextQuestion.selectedTopic ?? 'outro'),
          ...(latest.recentlyAskedTopics ?? []),
        ],
      });
      console.log('[ANA_NEXT_QUESTION_SELECTED]', {
        conversationId: input.conversationId,
        currentTopic,
        nextTopic: nextQuestion.selectedTopic ?? null,
        question: nextQuestion.question,
      });
      if (nextQuestion.selectedTopic) {
        console.log('[ANA_SAFE_NEXT_TOPIC_SELECTED]', {
          conversationId: input.conversationId,
          currentTopic,
          selectedTopic: nextQuestion.selectedTopic,
          question: nextQuestion.question,
        });
      }
      if (nextQuestion.topicRepeatAvoided) {
        console.log('[ANA_TOPIC_REPEAT_AVOIDED]', {
          conversationId: input.conversationId,
          currentTopic,
          nextTopic: nextQuestion.selectedTopic ?? null,
        });
      }
      if (nextQuestion.suppressedUnsupported) {
        console.log('[ANA_UNSUPPORTED_TOPIC_OFFER_SUPPRESSED]', {
          conversationId: input.conversationId,
          currentTopic,
          source: 'next_question_selection',
        });
      }
    } else if (nextQuestion.suppressedByRepeat) {
      console.log('[ANA_NEXT_QUESTION_SUPPRESSED_REPEAT]', {
        conversationId: input.conversationId,
        currentTopic,
      });
    } else if (nextQuestion.suppressedUnsupported) {
      console.log('[ANA_UNSUPPORTED_TOPIC_OFFER_SUPPRESSED]', {
        conversationId: input.conversationId,
        currentTopic,
        source: 'next_question_selection_no_candidate',
      });
    }
  }

  const shouldEnforceSingleQuestion =
    !knowledgeDrivenMode &&
    !input.isFirstAnaReply &&
    !visitFlowActive &&
    !brokerAskAlreadyPresent(reply) &&
    !containsVisitOffer(reply) &&
    !looksLikeVisitFlowReply(reply) &&
    shortConfirmationKind !== 'followup_topic_confirmation' &&
    requestedTopicAction.type !== 'direct_topic_request' &&
    requestedTopicAction.type !== 'accepted_topic_offer' &&
    !userContinuationDemand;
  if (shouldEnforceSingleQuestion) {
    const currentTopicForSingleQuestion = resolveCurrentTopic(input.userMessage, reply);
    const stateBeforeSingleQuestion = getAnaDialoguePolicyState(nextState);
    const singleQuestion = ensureSingleFinalQuestion({
      text: reply,
      currentTopic: currentTopicForSingleQuestion,
      safeTopicAvailability,
      recentlyDiscussedTopics: stateBeforeSingleQuestion.recentlyDiscussedTopics ?? [],
      recentlyAskedTopics: stateBeforeSingleQuestion.recentlyAskedTopics ?? [],
      recentAssistantReplies,
    });
    if (singleQuestion.changed && singleQuestion.text !== reply) {
      reply = singleQuestion.text;
      appliedRules.push('single_question_enforced');
      console.log('[ANA_SINGLE_QUESTION_ENFORCED]', {
        conversationId: input.conversationId,
        currentTopic: currentTopicForSingleQuestion,
      });
    }
    if (singleQuestion.unsupportedTopics.length > 0) {
      console.log('[ANA_UNSUPPORTED_TOPIC_OFFER_SUPPRESSED]', {
        conversationId: input.conversationId,
        currentTopic: currentTopicForSingleQuestion,
        topics: singleQuestion.unsupportedTopics,
        source: 'single_question_enforcement',
      });
    }
  }

  const rawInputReply = (input.replyText || '').trim();
  if (!visitFlowActive && rawInputReply && norm(rawInputReply) === norm(reply)) {
    const repeatedOutput = recentAssistantReplies.slice(-2).some((prev) => norm(prev) === norm(reply));
    if (repeatedOutput) {
      const fallback = SPECIFIC_DETAIL_FALLBACK_STATEMENT;
      if (norm(reply) !== norm(fallback)) {
        reply = fallback;
        appliedRules.push('repeat_suppressed');
      }
      console.log('[ANA_REPEAT_SUPPRESSED]', {
        conversationId: input.conversationId,
      });
    }
  }

  const meContaAlreadyUsedInConversation = recentAssistantReplies.some((msg) => ME_CONTA_GENERIC_LOOP_PATTERN.test(msg));
  const shouldStripMeContaForRepeat = meContaAlreadyUsedInConversation && ME_CONTA_GENERIC_LOOP_PATTERN.test(reply);
  let finalLoopGuardCandidate = stripGenericLoopQuestion(reply);
  if (!shouldStripMeContaForRepeat && ME_CONTA_GENERIC_LOOP_PATTERN.test(reply)) {
    finalLoopGuardCandidate = finalLoopGuardCandidate || reply;
  }
  finalLoopGuardCandidate = finalLoopGuardCandidate
    .replace(new RegExp(BANNED_GENERIC_FALLBACK, 'ig'), '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  if (finalLoopGuardCandidate !== reply) {
    const fallbackWhenEmpty = buildContextAwareSanitizedFallback({
      userMessage: input.userMessage,
      isKnowledgeGapTurn,
      replyBeforeSanitize: reply,
    });
    reply = finalLoopGuardCandidate || fallbackWhenEmpty;
    appliedRules.push('final_generic_loop_guard');
    console.log('[ANA_FINAL_GENERIC_LOOP_GUARD_APPLIED]', {
      conversationId: input.conversationId,
      emptiedAfterStrip: finalLoopGuardCandidate.length === 0,
      meContaRepeated: shouldStripMeContaForRepeat,
    });
  }

  const finalQuestionContext = resolveLastAssistantQuestionContext(reply, null, null, []);
  const latestState = getAnaDialoguePolicyState(nextState);
  const shouldPersistQuestionContext =
    (latestState.lastAssistantQuestionType ?? null) !== finalQuestionContext.questionType ||
    (latestState.lastAssistantQuestionText ?? null) !== finalQuestionContext.questionText ||
    (latestState.lastOfferedTopics ?? []).join('|') !== finalQuestionContext.offeredTopics.join('|');
  if (shouldPersistQuestionContext) {
    nextState = mergeAnaDialoguePolicyState(nextState, {
      lastAssistantQuestionType: finalQuestionContext.questionType,
      lastAssistantQuestionText: finalQuestionContext.questionText,
      lastOfferedTopics: finalQuestionContext.offeredTopics,
    });
  }

  if (appliedRules.length > 0) {
    console.log('[ANA_DIALOGUE_POLICY_APPLIED]', {
      conversationId: input.conversationId,
      rules: appliedRules,
      previousBrokerAskAt: initialState.lastBrokerHandoffAskedAt ?? null,
    });
  }

  return {
    text: reply,
    flowState: nextState,
    changed: reply !== (input.replyText || '').trim() || appliedRules.length > 0 || shouldPersistQuestionContext,
  };
}





