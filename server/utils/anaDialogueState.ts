import type { CommercialFlowState } from './commercialFlowState.js';

export interface AnaDialoguePolicyState {
  greetedAt?: string | null;
  lastFollowupQuestion?: string | null;
  recentlyDiscussedTopics?: string[];
  recentlyAskedTopics?: string[];
  lastBrokerHandoffAskedAt?: string | null;
  brokerHandoffAcceptedAt?: string | null;
  nameUncertainAt?: string | null;
  lastAssistantQuestionType?: 'visit_offer' | 'broker_handoff' | 'followup_topics' | 'other' | null;
  lastAssistantQuestionText?: string | null;
  lastOfferedTopics?: string[];
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
      raw.lastAssistantQuestionType === 'followup_topics' ||
      raw.lastAssistantQuestionType === 'other'
        ? raw.lastAssistantQuestionType
        : null,
    lastAssistantQuestionText: raw.lastAssistantQuestionText ?? null,
    lastOfferedTopics: compactTopicList(raw.lastOfferedTopics),
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
  merged.lastOfferedTopics = compactTopicList(merged.lastOfferedTopics);
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
