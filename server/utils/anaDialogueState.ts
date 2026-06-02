import type { CommercialFlowState, LeadQualificationState } from './commercialFlowState.js';

export interface AnaDialoguePolicyState {
  greetedAt?: string | null;
  lastFollowupQuestion?: string | null;
  recentlyDiscussedTopics?: string[];
  recentlyAskedTopics?: string[];
  lastBrokerHandoffAskedAt?: string | null;
  brokerHandoffAcceptedAt?: string | null;
  nameUncertainAt?: string | null;
  lastAssistantQuestionType?:
    | 'visit_offer'
    | 'broker_handoff'
    | 'broker_offer'
    | 'broker_or_visit_offer'
    | 'single_topic_offer'
    | 'multi_topic_offer'
    | 'contextual_followup'
    | 'clarification'
    | 'followup_topics'
    | 'followup_topic'
    | 'media_offer'
    | 'other'
    | null;
  lastAssistantQuestionText?: string | null;
  recentQuestions?: string[];
  lastOfferedTopics?: string[];
  lastAnsweredTopic?: string | null;
  topicsAlreadyAnswered?: string[];
  lastCommittedHandler?: string | null;
  lastCommittedAt?: string | null;
  leadQualification?: LeadQualificationState;
}

const MAX_RECENT = 6;

function compactTopicList(input: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of input ?? []) {
    const topic = String(raw || '').trim().toLowerCase();
    if (!topic) continue;
    if (out.includes(topic)) continue;
    out.push(topic);
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

function compactQuestionList(input: string[] | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of input ?? []) {
    const question = String(raw || '').replace(/\s+/g, ' ').trim();
    if (!question) continue;
    const key = question
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!key || seen.has(key)) continue;
    out.push(question);
    seen.add(key);
    if (out.length >= MAX_RECENT) break;
  }
  return out;
}

export function getAnaDialoguePolicyState(flowState: CommercialFlowState | null | undefined): AnaDialoguePolicyState {
  const raw = flowState?.dialoguePolicy;
  if (!raw || typeof raw !== 'object') return {};
  return {
    greetedAt: raw.greetedAt ?? null,
    lastFollowupQuestion: raw.lastFollowupQuestion ?? null,
    recentlyDiscussedTopics: compactTopicList(raw.recentlyDiscussedTopics),
    recentlyAskedTopics: compactTopicList(raw.recentlyAskedTopics),
    lastBrokerHandoffAskedAt: raw.lastBrokerHandoffAskedAt ?? null,
    brokerHandoffAcceptedAt: raw.brokerHandoffAcceptedAt ?? null,
    nameUncertainAt: raw.nameUncertainAt ?? null,
    lastAssistantQuestionType:
      raw.lastAssistantQuestionType === 'visit_offer' ||
      raw.lastAssistantQuestionType === 'broker_handoff' ||
      raw.lastAssistantQuestionType === 'broker_offer' ||
      raw.lastAssistantQuestionType === 'broker_or_visit_offer' ||
      raw.lastAssistantQuestionType === 'single_topic_offer' ||
      raw.lastAssistantQuestionType === 'multi_topic_offer' ||
      raw.lastAssistantQuestionType === 'contextual_followup' ||
      raw.lastAssistantQuestionType === 'clarification' ||
      raw.lastAssistantQuestionType === 'followup_topics' ||
      raw.lastAssistantQuestionType === 'followup_topic' ||
      raw.lastAssistantQuestionType === 'media_offer' ||
      raw.lastAssistantQuestionType === 'other'
        ? raw.lastAssistantQuestionType
        : null,
    lastAssistantQuestionText: raw.lastAssistantQuestionText ?? null,
    recentQuestions: compactQuestionList(raw.recentQuestions),
    lastOfferedTopics: compactTopicList(raw.lastOfferedTopics),
    lastAnsweredTopic: raw.lastAnsweredTopic ?? null,
    topicsAlreadyAnswered: compactTopicList(raw.topicsAlreadyAnswered),
    lastCommittedHandler: raw.lastCommittedHandler ?? null,
    lastCommittedAt: raw.lastCommittedAt ?? null,
    leadQualification: raw.leadQualification,
  };
}

export function mergeAnaDialoguePolicyState(
  flowState: CommercialFlowState,
  patch: Partial<AnaDialoguePolicyState>
): CommercialFlowState {
  const prev = getAnaDialoguePolicyState(flowState);
  const merged: AnaDialoguePolicyState = {
    ...prev,
    ...patch,
  };
  merged.recentlyDiscussedTopics = compactTopicList(merged.recentlyDiscussedTopics);
  merged.recentlyAskedTopics = compactTopicList(merged.recentlyAskedTopics);
  merged.recentQuestions = compactQuestionList(merged.recentQuestions);
  merged.lastOfferedTopics = compactTopicList(merged.lastOfferedTopics);
  merged.topicsAlreadyAnswered = compactTopicList(merged.topicsAlreadyAnswered);
  return {
    ...flowState,
    dialoguePolicy: merged,
    updatedAt: new Date().toISOString(),
  };
}

export function pushAnaDialogueTopics(
  flowState: CommercialFlowState,
  updates: { discussed?: string[]; asked?: string[] }
): CommercialFlowState {
  const prev = getAnaDialoguePolicyState(flowState);
  const discussed = compactTopicList([...(updates.discussed ?? []), ...(prev.recentlyDiscussedTopics ?? [])]);
  const asked = compactTopicList([...(updates.asked ?? []), ...(prev.recentlyAskedTopics ?? [])]);
  return mergeAnaDialoguePolicyState(flowState, {
    recentlyDiscussedTopics: discussed,
    recentlyAskedTopics: asked,
  });
}
