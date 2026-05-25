import type { CommercialFlowState } from './commercialFlowState.js';
import {
  detectAnaDialogueTopics,
  selectAnaNextFollowupQuestion,
  type AnaDialogueTopic,
} from './anaFollowupQuestionService.js';
import {
  getAnaDialoguePolicyState,
  mergeAnaDialoguePolicyState,
  pushAnaDialogueTopics,
} from './anaDialogueState.js';

const BROKER_HANDOFF_ASK =
  'Esses detalhes podem variar conforme disponibilidade. Quer que eu encaminhe para um corretor te passar certinho?';
const VISIT_SLOT_WINDOW = 'Temos disponibilidade de segunda a sábado, das 09h às 18h.';
const SPECIFIC_DETAIL_FALLBACK_QUESTION = 'Tem algum ponto específico que você quer que eu detalhe melhor?';

function norm(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
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

function askVisitMissingSlotQuestion(flowState: CommercialFlowState, hasKnownName: boolean): string {
  const pendingDate = (flowState.pendingVisitDate || '').trim();
  const pendingDateLabel = flowState.pendingVisitDateLabel ?? null;
  const pendingPeriod = flowState.pendingVisitPeriod ?? null;
  const pendingTime = (flowState.pendingVisitTime || '').trim();
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
  return /^(sim|ok|perfeito|ta bom|tá bom|pode ser|pode sim|fechado|claro|beleza)$/.test(n);
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

function isAffirmativeUserReply(userMessage: string): boolean {
  const n = norm(userMessage).replace(/[.!?]+$/g, '').trim();
  return /^(sim|pode ser|pode sim|quero sim|quero|ok|perfeito|fechado|claro)$/.test(n);
}

function isContinuationDemandUserReply(userMessage: string): boolean {
  const n = norm(userMessage);
  if (!n) return false;
  return (
    /\b(vc disse que ia falar mais|voce disse que ia falar mais|você disse que ia falar mais)\b/.test(n) ||
    /\b(fala mais|me explica melhor|voce falou que ia explicar|você falou que ia explicar|quero saber mais)\b/.test(n)
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
  if (topic === 'seguranca') return 'segurança';
  if (topic === 'localizacao') return 'localização';
  if (topic === 'valores') return 'valores';
  if (topic === 'pagamento') return 'formas de pagamento';
  return 'detalhes';
}

function buildFollowupTopicChoiceQuestion(topics: AnaDialogueTopic[], includeReminder: boolean): string {
  const unique = dedupeTopics(topics).slice(0, 2);
  if (unique.length === 0) {
    return 'Claro. Você quer saber mais sobre valores, lazer, localização, segurança ou formas de pagamento?';
  }
  if (unique.length === 1) {
    return `Claro. Quer que eu te explique mais sobre ${topicLabel(unique[0] ?? 'outro')}?`;
  }
  const first = topicLabel(unique[0] ?? 'outro');
  const second = topicLabel(unique[1] ?? 'outro');
  if (includeReminder) {
    return `Claro. Eu tinha comentado que poderia te explicar mais sobre ${first} ou ${second}. Qual dos dois você prefere ver agora?`;
  }
  return `Claro. Você prefere que eu te explique sobre ${first} ou ${second}?`;
}

function isAssistantVisitOfferQuestion(text: string | null | undefined): boolean {
  const raw = (text || '').trim();
  const n = norm(raw);
  if (!raw || !/\?/.test(raw)) return false;
  if (containsVisitOffer(raw)) return true;
  return /\b(agendar|agendamento|marcar visita|conhecer pessoalmente|reservar horario|reservar horário)\b/.test(n);
}

type LastAssistantQuestionContext = {
  questionType: 'visit_offer' | 'broker_handoff' | 'followup_topics' | 'other';
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
      .map((topic) => String(topic || '').toLowerCase().trim() as AnaDialogueTopic)
      .filter(
        (topic) =>
          topic === 'lazer' ||
          topic === 'seguranca' ||
          topic === 'localizacao' ||
          topic === 'valores' ||
          topic === 'pagamento'
      )
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
  else if (stateQuestionType === 'visit_offer' || stateQuestionType === 'broker_handoff' || stateQuestionType === 'followup_topics') {
    questionType = stateQuestionType;
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
  const state = getAnaDialoguePolicyState(input.flowState);
  const hasKnownName = (input.knownCustomerName || '').trim().length >= 2;
  const visitFlowActive =
    input.visitFlowActive === true ||
    input.flowState.pendingVisitScheduling === true ||
    input.flowState.visitScheduling?.active === true;
  const lastAssistantQuestionFromHistory = recentAssistantReplies[recentAssistantReplies.length - 1] ?? null;
  const lastAssistantQuestionContext = resolveLastAssistantQuestionContext(
    lastAssistantQuestionFromHistory,
    state.lastAssistantQuestionText ?? null,
    state.lastAssistantQuestionType ?? null,
    state.lastOfferedTopics ?? []
  );
  const userAffirmative = isAffirmativeUserReply(input.userMessage) || isAckLikeMessage(input.userMessage);
  const userContinuationDemand = isContinuationDemandUserReply(input.userMessage);

  if (visitFlowActive) {
    console.log('[ANA_VISIT_FLOW_ACTIVE]', {
      conversationId: input.conversationId,
      pendingVisitScheduling: input.flowState.pendingVisitScheduling === true,
      visitStatus: input.flowState.visitScheduling?.status ?? null,
    });
  }

  if (input.isFirstAnaReply) {
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
  } else {
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

  if (!visitFlowActive && (userAffirmative || userContinuationDemand)) {
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
      lastAssistantQuestionContext.askedFollowupTopics
    ) {
      const shouldResolvePendingFollowup =
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
          trigger: userContinuationDemand ? 'continuation_request' : 'affirmative_or_guard',
        });
      }
    } else if (
      userContinuationDemand &&
      !lastAssistantQuestionContext.askedVisitOffer &&
      !lastAssistantQuestionContext.askedBrokerHandoff &&
      !lastAssistantQuestionContext.askedFollowupTopics
    ) {
      reply = 'Claro. Você quer saber mais sobre valores, lazer, localização, segurança ou formas de pagamento?';
      appliedRules.push('pending_followup_ambiguous');
      console.log('[ANA_PENDING_FOLLOWUP_AMBIGUOUS]', {
        conversationId: input.conversationId,
        trigger: 'continuation_request_without_pending_topic',
      });
    }
  }

  const needsBrokerAsk = userAskedDetailedCommercialTopic(input.userMessage) || userAskedForHuman(input.userMessage);
  const recentBrokerAsk =
    recentAssistantReplies.length > 0 &&
    recentAssistantReplies.slice(-2).some((msg) => containsBrokerAsk(msg));
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
    }
  }

  const lastAssistantAskedBroker = lastAssistantQuestionContext.askedBrokerHandoff;
  if (lastAssistantAskedBroker && userAffirmative) {
    reply = 'Perfeito, vou encaminhar para um corretor te passar certinho.';
    nextState = mergeAnaDialoguePolicyState(nextState, { brokerHandoffAcceptedAt: new Date().toISOString() });
    appliedRules.push('broker_handoff_confirmed');
    console.log('[ANA_BROKER_HANDOFF_ACCEPTED]', {
      conversationId: input.conversationId,
    });
  }

  if (visitFlowActive) {
    const hasTopicSwitchIntent =
      containsMediaOffer(reply) ||
      /\b(lazer|localizacao|localização|infraestrutura|pagamento|valor|seguranca|segurança|book|vídeo|video|foto|fotos)\b/.test(norm(reply));
    const replyNeedsVisitAnchor = !looksLikeVisitFlowReply(reply) || isAckLikeMessage(input.userMessage);
    if (hasTopicSwitchIntent || replyNeedsVisitAnchor) {
      const anchoredVisitReply = askVisitMissingSlotQuestion(nextState, hasKnownName);
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

  const shouldSelectNextQuestion =
    !input.disableFollowupQuestion &&
    !visitFlowActive &&
    reply.length > 0 &&
    !/\?\s*$/.test(reply) &&
    !brokerAskAlreadyPresent(reply) &&
    !userAffirmative;

  if (shouldSelectNextQuestion) {
    const currentTopic = resolveCurrentTopic(input.userMessage, reply);
    const latest = getAnaDialoguePolicyState(nextState);
    const nextQuestion = selectAnaNextFollowupQuestion({
      currentTopic,
      recentlyDiscussedTopics: latest.recentlyDiscussedTopics ?? [],
      recentlyAskedTopics: latest.recentlyAskedTopics ?? [],
      recentAssistantReplies,
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
      if (nextQuestion.topicRepeatAvoided) {
        console.log('[ANA_TOPIC_REPEAT_AVOIDED]', {
          conversationId: input.conversationId,
          currentTopic,
          nextTopic: nextQuestion.selectedTopic ?? null,
        });
      }
    } else if (nextQuestion.suppressedByRepeat) {
      console.log('[ANA_NEXT_QUESTION_SUPPRESSED_REPEAT]', {
        conversationId: input.conversationId,
        currentTopic,
      });
    }
  }

  const rawInputReply = (input.replyText || '').trim();
  if (!visitFlowActive && rawInputReply && norm(rawInputReply) === norm(reply)) {
    const repeatedOutput = recentAssistantReplies.slice(-2).some((prev) => norm(prev) === norm(reply));
    if (repeatedOutput) {
      const fallback = SPECIFIC_DETAIL_FALLBACK_QUESTION;
      if (norm(reply) !== norm(fallback)) {
        reply = fallback;
        appliedRules.push('repeat_suppressed');
      }
      console.log('[ANA_REPEAT_SUPPRESSED]', {
        conversationId: input.conversationId,
      });
    }
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
      previousBrokerAskAt: state.lastBrokerHandoffAskedAt ?? null,
    });
  }

  return {
    text: reply,
    flowState: nextState,
    changed: reply !== (input.replyText || '').trim() || appliedRules.length > 0 || shouldPersistQuestionContext,
  };
}
