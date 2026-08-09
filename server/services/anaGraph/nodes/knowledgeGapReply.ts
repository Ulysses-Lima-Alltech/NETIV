import {
  detectAnaKnowledgeGap,
  buildLeadQualificationBridgeReply,
  type AnaKnowledgeGapRecentMessage,
} from '../../../utils/anaKnowledgeGapGuard.js';
import { applyOperationalFactGuard } from '../../../utils/anaOperationalFactGuard.js';
import type { CommercialAxis } from '../../../utils/anaCommercialAxisGuard.js';
import type { AnaGraphState } from '../state.js';

export interface KnowledgeGapReplyNodeParams {
  requestedAxis?: CommercialAxis | null;
  recentMessages?: AnaKnowledgeGapRecentMessage[] | null;
  locationOverview?: string | null;
  locationLink?: string | null;
  addressComplete?: string | null;
  addressNumber?: string | null;
  officialData: string;
}

/**
 * Nó de ramificação: reaproveita detectAnaKnowledgeGap +
 * buildLeadQualificationBridgeReply (anaKnowledgeGapGuard.ts) sem alteração,
 * e valida o texto resultante com applyOperationalFactGuard
 * (anaOperationalFactGuard.ts) antes de devolver ao turno.
 */
export function knowledgeGapReplyNode(
  state: AnaGraphState,
  params: KnowledgeGapReplyNodeParams
): Partial<AnaGraphState> {
  const gap = detectAnaKnowledgeGap({
    userMessage: state.userMessage,
    requestedAxis: params.requestedAxis ?? null,
    recentMessages: params.recentMessages ?? null,
  });

  if (!gap.hasKnowledgeGap) {
    return { assistantReplyText: null };
  }

  const bridgeReply = buildLeadQualificationBridgeReply({
    matchedIntent: gap.matchedIntent,
    locationOverview: params.locationOverview,
    locationLink: params.locationLink,
    addressComplete: params.addressComplete,
    addressNumber: params.addressNumber,
  });

  const guarded = applyOperationalFactGuard(bridgeReply, state.userMessage, params.officialData);

  return { assistantReplyText: guarded.blocked ? null : guarded.text };
}
