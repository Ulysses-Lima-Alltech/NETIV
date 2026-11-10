import {
  getConversationById,
  type ConversationRow,
} from '../repositories/conversationRepository.js';
import { findContactById } from '../repositories/contactsRepository.js';
import { resolveEnterpriseForAnaTurn } from '../repositories/enterpriseMatch.js';
import { listEnterprises, type EnterpriseRow } from '../repositories/enterpriseRepository.js';
import {
  getUnclassifiedLeadSettings,
  type UnclassifiedLeadSettings,
} from '../repositories/anaUnclassifiedLeadSettingsRepository.js';
import { hasExplicitHandoffIntent } from '../utils/anaInstructionLeakAndHandoffIntent.js';
import { isAnaAutomationBlockedByHandoff } from '../utils/anaHandoffPolicy.js';
import { getAnaAutomationPauseReason } from '../utils/anaAutomationKillSwitch.js';
import {
  decideUnclassifiedLeadTriage,
  isTriageCityAnswer,
  parseUnclassifiedLeadTriageState,
} from '../utils/anaUnclassifiedLeadTriage.js';
import { parseCommercialFlowState } from '../utils/commercialFlowState.js';
import type { UnclassifiedLeadTriageState } from '../utils/commercialFlowState.js';

export type UnclassifiedLeadTriageResult =
  | { kind: 'skipped'; conversation: ConversationRow }
  | { kind: 'resolved'; conversation: ConversationRow }
  | { kind: 'replied'; text: string; statePersisted: boolean }
  | { kind: 'failed'; reason: string };

export interface UnclassifiedLeadTriageDeps {
  sendReply: (conversation: ConversationRow, text: string) => Promise<boolean>;
  assignEnterprise: (
    conversation: ConversationRow,
    enterpriseId: number
  ) => Promise<ConversationRow | null>;
  persistState: (
    conversationId: number,
    state: UnclassifiedLeadTriageState | null
  ) => Promise<boolean>;
  source: 'ana_inbound_engine' | 'ana_graph';
  loadConversation?: typeof getConversationById;
  loadEnterprises?: () => Promise<EnterpriseRow[]>;
  loadContact?: typeof findContactById;
  resolveEnterprise?: typeof resolveEnterpriseForAnaTurn;
  loadSettings?: () => Promise<UnclassifiedLeadSettings>;
}

function isEligibleConversation(conversation: ConversationRow): boolean {
  return (
    String(conversation.channel ?? '').trim().toLowerCase() === 'whatsapp' &&
    String(conversation.conversation_type ?? 'CLIENT').toUpperCase() === 'CLIENT' &&
    conversation.enterprise_id == null &&
    conversation.classification !== 'Carteira' &&
    conversation.manual_closed_at == null &&
    !isAnaAutomationBlockedByHandoff(conversation)
  );
}

export async function runUnclassifiedLeadTriage(params: {
  conversationId: number;
  userMessage: string;
  deps: UnclassifiedLeadTriageDeps;
}): Promise<UnclassifiedLeadTriageResult> {
  let conversation: ConversationRow | null;
  try {
    conversation = await (params.deps.loadConversation ?? getConversationById)(params.conversationId);
  } catch (error) {
    console.error('[ANA_UNCLASSIFIED_TRIAGE_FAILED]', {
      conversationId: params.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: 'failed', reason: 'unclassified_lead_conversation_read_failed' };
  }
  if (!conversation) return { kind: 'failed', reason: 'conversation_not_found' };
  if (!isEligibleConversation(conversation)) return { kind: 'skipped', conversation };
  if (hasExplicitHandoffIntent(params.userMessage)) return { kind: 'skipped', conversation };

  const pauseReason = getAnaAutomationPauseReason({
    source: params.deps.source,
    conversationId: conversation.id,
  });
  if (pauseReason) return { kind: 'skipped', conversation };

  try {
    const enterprises = await (params.deps.loadEnterprises ?? (() => listEnterprises(true)))();
    const linkedContact =
      conversation.contact_id != null
        ? await (params.deps.loadContact ?? findContactById)(conversation.contact_id)
        : null;
    const cityAnswer = isTriageCityAnswer(params.userMessage, enterprises);
    const resolution = await (params.deps.resolveEnterprise ?? resolveEnterpriseForAnaTurn)({
      userMessage: cityAnswer ? '' : params.userMessage,
      activeEnterprises: enterprises,
      conversationEnterpriseId: conversation.enterprise_id,
      campaignEnterpriseId: conversation.enterprise_origin_id ?? null,
      contactEnterpriseId: linkedContact?.enterprise_id ?? null,
    });

    if (resolution.enterpriseId != null) {
      const updated = await params.deps.assignEnterprise(conversation, resolution.enterpriseId);
      if (!updated || updated.enterprise_id !== resolution.enterpriseId) {
        console.log('[ANA_UNCLASSIFIED_TRIAGE_ENTERPRISE_NOT_APPLIED]', {
          conversationId: conversation.id,
          resolutionSource: resolution.source,
        });
        return { kind: 'skipped', conversation: updated ?? conversation };
      }
      await params.deps.persistState(conversation.id, null);
      return { kind: 'resolved', conversation: updated };
    }

    const flowState = parseCommercialFlowState(conversation.commercial_flow_state);
    const previousState = parseUnclassifiedLeadTriageState(flowState?.unclassifiedLeadTriage);
    let initialMessage: string | null = null;
    try {
      initialMessage = (await (params.deps.loadSettings ?? getUnclassifiedLeadSettings)()).initialMessage;
    } catch (error) {
      console.error('[ANA_UNCLASSIFIED_TRIAGE_SETTINGS_READ_FAILED]', {
        conversationId: conversation.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const decision = decideUnclassifiedLeadTriage({
      text: params.userMessage,
      enterprises,
      previousState,
      initialMessage,
      explicitEnterpriseId: null,
      ambiguousEnterpriseOptions: resolution.source === 'ambiguous'
        ? resolution.candidates.map((candidate) => ({
            id: candidate.enterpriseId,
            name: candidate.enterpriseName,
          }))
        : undefined,
    });

    if (decision.kind === 'resolved') {
      const updated = await params.deps.assignEnterprise(conversation, decision.enterpriseId);
      if (!updated || updated.enterprise_id !== decision.enterpriseId) {
        console.log('[ANA_UNCLASSIFIED_TRIAGE_ENTERPRISE_NOT_APPLIED]', {
          conversationId: conversation.id,
          resolutionSource: 'explicit_triage_selection',
        });
        return { kind: 'skipped', conversation: updated ?? conversation };
      }
      await params.deps.persistState(conversation.id, null);
      return { kind: 'resolved', conversation: updated };
    }

    const sent = await params.deps.sendReply(conversation, decision.text);
    if (!sent) return { kind: 'failed', reason: 'unclassified_lead_reply_send_failed' };

    let statePersisted = false;
    try {
      statePersisted = await params.deps.persistState(conversation.id, decision.nextState);
    } catch (error) {
      console.error('[ANA_UNCLASSIFIED_TRIAGE_STATE_SAVE_FAILED]', {
        conversationId: conversation.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    if (!statePersisted) {
      console.error('[ANA_UNCLASSIFIED_TRIAGE_STATE_SAVE_FAILED]', {
        conversationId: conversation.id,
        reason: 'conversation_state_not_updated',
      });
    }

    return { kind: 'replied', text: decision.text, statePersisted };
  } catch (error) {
    console.error('[ANA_UNCLASSIFIED_TRIAGE_FAILED]', {
      conversationId: conversation.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return { kind: 'failed', reason: 'unclassified_lead_triage_failed' };
  }
}
