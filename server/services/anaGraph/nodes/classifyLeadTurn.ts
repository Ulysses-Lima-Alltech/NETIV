import type { ConversationRow } from '../../../repositories/conversationRepository.js';
import { getConversationManualClassificationOverrides } from '../../../repositories/conversationRepository.js';
import { getRecentConversationMessages } from '../../../repositories/messageRepository.js';
import { listEnterprises } from '../../../repositories/enterpriseRepository.js';
import { listEnterpriseAliasRowsForActiveEnterprises } from '../../../repositories/enterpriseMatch.js';
import {
  classifyLeadConversation,
  type LeadClassifierDecision,
} from '../../leadClassificationService.js';
import {
  extractCustomerNameFromUserUtterance,
  type ExtractCustomerNameContext,
} from '../../../utils/extractCustomerNameFromMessage.js';
import type { AnaGraphState } from '../state.js';

/**
 * Nó de classificação: reaproveita classifyLeadConversation (mesma chamada de
 * leadClassificationService.ts hoje feita em webhookProcessor.ts) para decidir
 * temperatura/funil/empreendimento do turno.
 */
export async function classifyLeadTurnNode(
  state: AnaGraphState,
  conversation: ConversationRow
): Promise<Partial<AnaGraphState> & { leadClassifierDecision: LeadClassifierDecision }> {
  const recentMessages = await getRecentConversationMessages(conversation.id, 12);
  const activeEnterprises = await listEnterprises(true);
  const aliasRows =
    activeEnterprises.length > 0
      ? await listEnterpriseAliasRowsForActiveEnterprises(activeEnterprises.map((item) => item.id))
      : [];
  const manualOverrides = getConversationManualClassificationOverrides(conversation.commercial_flow_state);

  const decision = await classifyLeadConversation({
    conversationId: conversation.id,
    contactId: conversation.contact_id ?? null,
    latestCustomerMessage: state.userMessage,
    recentMessages,
    currentTemperature: conversation.lead_temperature ?? null,
    currentEnterpriseId: state.enterpriseId,
    currentFunnelStatus: conversation.classification ?? null,
    availableEnterprises: activeEnterprises,
    enterpriseAliasRows: aliasRows,
    manualOverrideFlags: manualOverrides,
  });

  return {
    enterpriseId: decision.shouldUpdateEnterprise ? decision.enterpriseId : state.enterpriseId,
    leadClassifierDecision: decision,
  };
}

/**
 * Extrai nome do cliente quando a última resposta da Ana perguntou o nome
 * explicitamente — atalho determinístico que hoje roda antes do classificador
 * em webhookProcessor.ts.
 */
export function extractCustomerNameForTurn(
  userMessage: string,
  ctx?: ExtractCustomerNameContext
): string | null {
  return extractCustomerNameFromUserUtterance(userMessage, ctx);
}
