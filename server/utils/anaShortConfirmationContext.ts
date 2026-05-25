import type { CommercialFlowState } from './commercialFlowState.js';

export type AnaShortConfirmationKind =
  | 'visit_confirmation'
  | 'broker_confirmation'
  | 'followup_topic_confirmation'
  | 'media_confirmation'
  | 'ambiguous_confirmation'
  | 'not_short_confirmation';

export type AnaShortConfirmationQuestionType =
  | 'visit_offer'
  | 'broker_handoff'
  | 'followup_topic'
  | 'media_offer'
  | 'unknown';

export interface AnaShortConfirmationContext {
  kind: AnaShortConfirmationKind;
  isShortConfirmation: boolean;
  lastAssistantQuestionType: AnaShortConfirmationQuestionType;
  lastAssistantQuestionText: string | null;
  lastOfferedTopics: string[];
  source: 'history' | 'state' | 'none';
}

export interface ResolveShortConfirmationContextInput {
  userText: string;
  recentMessages: Array<{ role: 'user' | 'assistant'; content?: string | null }>;
  lastAssistantMessage?: string | null;
  flowState: CommercialFlowState;
}

function norm(value: string): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isShortConfirmationMessage(text: string): boolean {
  const n = norm(text).replace(/[.!?]+$/g, '').trim();
  return /^(sim|quero|quero sim|pode ser|ok|ta bom|t[aá] bom|claro|isso|pode|perfeito|fechado)$/.test(n);
}

function dedupeTopics(topics: string[]): string[] {
  const out: string[] = [];
  for (const topic of topics) {
    const normalized = norm(topic);
    if (!normalized) continue;
    if (out.includes(normalized)) continue;
    out.push(normalized);
  }
  return out;
}

function mapTopicLabelsFromText(text: string): string[] {
  const n = norm(text);
  const topics: string[] = [];
  if (/\b(lazer|areas? de lazer|piscina|academia|playground|quadra)\b/.test(n)) topics.push('lazer');
  if (/\b(seguranca|portaria|monitoramento|controle de acesso)\b/.test(n)) topics.push('seguranca');
  if (/\b(localizacao|onde fica|bairro|regiao|acesso|endereco)\b/.test(n)) topics.push('localizacao');
  if (/\b(valor|valores|preco|quanto custa|r\$)\b/.test(n)) topics.push('valores');
  if (/\b(formas? de pagamento|pagamento|entrada|parcela|parcelamento|financiamento)\b/.test(n)) {
    topics.push('formas_pagamento');
  }
  return dedupeTopics(topics);
}

function classifyAssistantQuestion(text: string | null | undefined): {
  questionType: AnaShortConfirmationQuestionType;
  questionText: string | null;
  offeredTopics: string[];
} {
  const raw = (text || '').trim();
  if (!raw) {
    return {
      questionType: 'unknown',
      questionText: null,
      offeredTopics: [],
    };
  }
  const n = norm(raw);
  const hasQuestionMark = /\?/.test(raw);
  if (!hasQuestionMark) {
    return {
      questionType: 'unknown',
      questionText: raw,
      offeredTopics: [],
    };
  }
  if (/\b(agendar|agendamento|marcar visita|marcar uma visita|agendar uma visita|conhecer pessoalmente|reservar horario|reservar horário)\b/.test(n)) {
    return {
      questionType: 'visit_offer',
      questionText: raw,
      offeredTopics: [],
    };
  }
  if (/\b(encaminh|corretor|consultor)\b/.test(n)) {
    return {
      questionType: 'broker_handoff',
      questionText: raw,
      offeredTopics: [],
    };
  }
  if (/\b(video|v[ií]deo|book|fotos?|imagens?|galeria)\b/.test(n)) {
    return {
      questionType: 'media_offer',
      questionText: raw,
      offeredTopics: [],
    };
  }
  const offeredTopics = mapTopicLabelsFromText(raw);
  if (offeredTopics.length > 0) {
    return {
      questionType: 'followup_topic',
      questionText: raw,
      offeredTopics,
    };
  }
  return {
    questionType: 'unknown',
    questionText: raw,
    offeredTopics: [],
  };
}

function normalizeStateQuestionType(
  value: unknown
): 'visit_offer' | 'broker_handoff' | 'followup_topic' | 'media_offer' | 'unknown' {
  const n = norm(String(value ?? ''));
  if (n === 'visit_offer') return 'visit_offer';
  if (n === 'broker_handoff') return 'broker_handoff';
  if (n === 'followup_topic' || n === 'followup_topics') return 'followup_topic';
  if (n === 'media_offer') return 'media_offer';
  return 'unknown';
}

export function shouldSuppressVisitFlowForConfirmationKind(kind: AnaShortConfirmationKind): boolean {
  return kind !== 'not_short_confirmation' && kind !== 'visit_confirmation';
}

export function resolveShortConfirmationContext(
  input: ResolveShortConfirmationContextInput
): AnaShortConfirmationContext {
  const isShort = isShortConfirmationMessage(input.userText);
  const recentAssistantReplies = input.recentMessages
    .filter((item) => item.role === 'assistant')
    .map((item) => String(item.content ?? '').trim())
    .filter((text) => text.length > 0);
  const lastAssistantFromHistory =
    (input.lastAssistantMessage || '').trim() || recentAssistantReplies[recentAssistantReplies.length - 1] || null;

  const fromHistory = classifyAssistantQuestion(lastAssistantFromHistory);
  const stateRaw = (input.flowState.dialoguePolicy ?? {}) as Record<string, unknown>;
  const stateType = normalizeStateQuestionType(stateRaw.lastAssistantQuestionType);
  const stateText = String(stateRaw.lastAssistantQuestionText ?? '').trim() || null;
  const stateTopics = dedupeTopics((stateRaw.lastOfferedTopics as string[] | undefined) ?? []);
  const fromState = {
    questionType: stateType,
    questionText: stateText,
    offeredTopics: stateTopics,
  };

  const preferHistory = fromHistory.questionType !== 'unknown';
  const selected = preferHistory
    ? fromHistory
    : fromState.questionType !== 'unknown' || fromState.offeredTopics.length > 0
      ? fromState
      : fromHistory;
  const source: 'history' | 'state' | 'none' = preferHistory
    ? 'history'
    : fromState.questionType !== 'unknown' || fromState.offeredTopics.length > 0
      ? 'state'
      : 'none';

  if (!isShort) {
    return {
      kind: 'not_short_confirmation',
      isShortConfirmation: false,
      lastAssistantQuestionType: selected.questionType,
      lastAssistantQuestionText: selected.questionText,
      lastOfferedTopics: selected.offeredTopics,
      source,
    };
  }

  if (selected.questionType === 'visit_offer') {
    return {
      kind: 'visit_confirmation',
      isShortConfirmation: true,
      lastAssistantQuestionType: selected.questionType,
      lastAssistantQuestionText: selected.questionText,
      lastOfferedTopics: [],
      source,
    };
  }
  if (selected.questionType === 'broker_handoff') {
    return {
      kind: 'broker_confirmation',
      isShortConfirmation: true,
      lastAssistantQuestionType: selected.questionType,
      lastAssistantQuestionText: selected.questionText,
      lastOfferedTopics: [],
      source,
    };
  }
  if (selected.questionType === 'media_offer') {
    return {
      kind: 'media_confirmation',
      isShortConfirmation: true,
      lastAssistantQuestionType: selected.questionType,
      lastAssistantQuestionText: selected.questionText,
      lastOfferedTopics: [],
      source,
    };
  }
  if (selected.questionType === 'followup_topic' && selected.offeredTopics.length > 0) {
    return {
      kind: 'followup_topic_confirmation',
      isShortConfirmation: true,
      lastAssistantQuestionType: selected.questionType,
      lastAssistantQuestionText: selected.questionText,
      lastOfferedTopics: selected.offeredTopics,
      source,
    };
  }
  return {
    kind: 'ambiguous_confirmation',
    isShortConfirmation: true,
    lastAssistantQuestionType: selected.questionType,
    lastAssistantQuestionText: selected.questionText,
    lastOfferedTopics: selected.offeredTopics,
    source,
  };
}

