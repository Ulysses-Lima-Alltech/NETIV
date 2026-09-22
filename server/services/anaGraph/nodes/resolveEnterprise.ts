import type { ConversationRow } from '../../../repositories/conversationRepository.js';
import { setConversationEnterpriseIdAndOrigin } from '../../../repositories/conversationRepository.js';
import { listEnterprises } from '../../../repositories/enterpriseRepository.js';
import {
  listEnterpriseAliasRowsForActiveEnterprises,
  resolveEnterpriseFromMessageAliases,
} from '../../../repositories/enterpriseMatch.js';
import type { AnaGraphState } from '../state.js';

/**
 * Extraído de webhookProcessor.ts (resolveAnaEnterpriseBeforeEngine) para reuso
 * pelo grafo novo. webhookProcessor.ts mantém a função original como wrapper
 * fino que delega para cá, servindo o motor legado sem duplicar a lógica.
 */
export async function resolveAnaEnterpriseForTurn(params: {
  conversation: ConversationRow;
  userMessage: string;
  phoneNumberId: string | null | undefined;
  metaMessageId: string;
}): Promise<ConversationRow> {
  const phoneNumberId = String(params.phoneNumberId ?? '').trim() || null;
  // Classificação só ocorre quando o cliente demonstra interesse explícito no
  // empreendimento (menciona o nome na mensagem). O número de WhatsApp que
  // recebeu a mensagem é o canal geral da empresa, não um sinal de interesse
  // — nunca deve, sozinho, classificar a conversa em nenhum empreendimento.
  const activeEnterprises = await listEnterprises(true);
  const aliasRows = await listEnterpriseAliasRowsForActiveEnterprises(activeEnterprises.map((item) => item.id));
  const match = resolveEnterpriseFromMessageAliases(params.userMessage, activeEnterprises, aliasRows);
  // Keep the existing conversation when the message names no enterprise or
  // matches more than one. A phone number alone is never an interest signal.
  if (match.source !== 'message_alias' || match.enterpriseId == null) return params.conversation;

  console.log('[ANA_ENTERPRISE_RESOLVE]', {
    conversationId: params.conversation.id,
    metaMessageId: params.metaMessageId,
    reason: 'inbound_message_matches_enterprise_alias',
    phoneNumberId,
    enterpriseId: match.enterpriseId,
    enterpriseName: match.enterpriseName,
    matchedBy: 'message_alias',
  });

  const updated = await setConversationEnterpriseIdAndOrigin(params.conversation.id, match.enterpriseId);
  const finalConversation = updated ?? params.conversation;
  if (finalConversation.enterprise_id !== match.enterpriseId) {
    console.log('[ANA_ENTERPRISE_RESOLVE]', {
      conversationId: params.conversation.id,
      metaMessageId: params.metaMessageId,
      reason: 'enterprise_update_not_applied',
      phoneNumberId,
      enterpriseId: finalConversation.enterprise_id ?? null,
      enterpriseName: match.enterpriseName,
      matchedBy: 'message_alias',
    });
  }
  return finalConversation;
}

/** Nó do grafo: resolve enterpriseId do turno e atualiza o estado. */
export async function resolveEnterpriseNode(
  state: AnaGraphState,
  conversation: ConversationRow
): Promise<Partial<AnaGraphState>> {
  const resolved = await resolveAnaEnterpriseForTurn({
    conversation,
    userMessage: state.userMessage,
    phoneNumberId: state.phoneNumberId,
    metaMessageId: state.metaMessageId ?? '',
  });
  return { enterpriseId: resolved.enterprise_id ?? null };
}
