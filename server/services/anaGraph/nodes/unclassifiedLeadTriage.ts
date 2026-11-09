import {
  runUnclassifiedLeadTriage,
  type UnclassifiedLeadTriageDeps,
} from '../../anaUnclassifiedLeadTriageService.js';
import { isPipelineStale } from '../../conversationPipelineToken.js';
import type { AnaGraphState } from '../state.js';
import type { SendWhatsappTextFn, InsertAssistantMessageFn } from './sendWhatsapp.js';

interface UnclassifiedLeadTriageNodeParams {
  sendReply: SendWhatsappTextFn;
  insertAssistantMessage: InsertAssistantMessageFn;
  assignEnterprise: UnclassifiedLeadTriageDeps['assignEnterprise'];
  persistState: UnclassifiedLeadTriageDeps['persistState'];
}

export async function unclassifiedLeadTriageNode(
  state: AnaGraphState,
  params: UnclassifiedLeadTriageNodeParams
): Promise<Partial<AnaGraphState>> {
  const result = await runUnclassifiedLeadTriage({
    conversationId: state.conversationId,
    userMessage: state.userMessage,
    deps: {
      source: 'ana_graph',
      assignEnterprise: params.assignEnterprise,
      persistState: params.persistState,
      sendReply: async (conversation, text) => {
        if (isPipelineStale(state.conversationId, state.pipelineToken ?? undefined)) return false;
        const sent = await params.sendReply({
          conversationId: state.conversationId,
          to: conversation.contact_phone ?? '',
          text,
          phase: 'ana_graph_unclassified_lead_triage',
        });
        if (!sent.success || !sent.metaMessageId) return false;
        await params.insertAssistantMessage(state.conversationId, text, sent.metaMessageId);
        return true;
      },
    },
  });

  if (result.kind === 'replied') {
    return {
      assistantReplyText: result.text,
      unclassifiedLeadTurnHandled: true,
    };
  }
  if (result.kind === 'failed') {
    return {
      assistantReplyText: null,
      unclassifiedLeadTurnHandled: true,
    };
  }
  if (result.kind === 'resolved') {
    return { enterpriseId: result.conversation.enterprise_id ?? null };
  }
  return { enterpriseId: result.conversation.enterprise_id ?? state.enterpriseId };
}
