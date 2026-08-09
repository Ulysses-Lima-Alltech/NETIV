import {
  finalizeAnaReplyText,
  applyAnaHardLengthGuard,
  evaluateAnaOutboundText,
  type FinalizeAnaReplyOptions,
} from '../../../utils/anaReplyFinalize.js';
import type { AnaGraphState } from '../state.js';

export interface FinalizeReplyNodeParams {
  enterpriseName?: string | null;
  conversationType?: 'CLIENT' | 'CORRETOR' | 'ADMIN' | string | null;
  conversationMode?: FinalizeAnaReplyOptions['conversationMode'];
  isFirstAnaReply?: boolean;
  isKnowledgeGapTurn?: boolean;
  lastAssistantMessage?: string | null;
  maxChars?: number;
}

/**
 * Nó de finalização: consolida finalizeAnaReplyText, applyAnaHardLengthGuard
 * e evaluateAnaOutboundText (anaReplyFinalize.ts) na mesma ordem hoje aplicada
 * pelo motor legado — sem alteração de nenhuma das sanitizações internas.
 */
export function finalizeReplyNode(
  state: AnaGraphState,
  params: FinalizeReplyNodeParams
): Partial<AnaGraphState> {
  const draft = state.assistantReplyText ?? '';
  if (!draft.trim()) {
    return { assistantReplyText: null };
  }

  const finalized = finalizeAnaReplyText(draft, {
    userMessage: state.userMessage,
    lastAssistantMessage: params.lastAssistantMessage ?? null,
    conversationMode: params.conversationMode,
    isFirstAnaReply: params.isFirstAnaReply,
    enterpriseName: params.enterpriseName,
    isKnowledgeGapTurn: params.isKnowledgeGapTurn,
  });

  const lengthGuarded = applyAnaHardLengthGuard({
    text: finalized,
    enterpriseName: params.enterpriseName,
    maxChars: params.maxChars,
  });

  const evaluated = evaluateAnaOutboundText({
    reply: lengthGuarded,
    conversationType: params.conversationType,
    enterpriseName: params.enterpriseName,
  });

  return { assistantReplyText: evaluated.valid ? evaluated.text : null };
}
