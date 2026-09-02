import type { ConversationRow } from '../../../repositories/conversationRepository.js';
import { setConversationEnterpriseIdAndOrigin } from '../../../repositories/conversationRepository.js';
import { listEnterprises } from '../../../repositories/enterpriseRepository.js';
import type { AnaGraphState } from '../state.js';

function normalizeInboundEnterpriseText(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function inboundMentionsEvora(text: string): boolean {
  const n = normalizeInboundEnterpriseText(text);
  if (!n) return false;
  return /\b(?:lote(?:amento)?\s+)?evora\b/.test(n);
}

function isEvoraEnterpriseNameForInbound(name: string | null | undefined, slug?: string | null): boolean {
  const n = normalizeInboundEnterpriseText(`${name ?? ''} ${slug ?? ''}`);
  return /\bevora\b/.test(n);
}

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
  const matchedByMessage = inboundMentionsEvora(params.userMessage);

  if (!matchedByMessage) return params.conversation;

  const activeEnterprises = await listEnterprises(true);
  const evoraEnterprise =
    activeEnterprises.find((enterprise) => isEvoraEnterpriseNameForInbound(enterprise.name, enterprise.slug)) ?? null;

  console.log('[ANA_ENTERPRISE_RESOLVE]', {
    conversationId: params.conversation.id,
    metaMessageId: params.metaMessageId,
    reason: 'inbound_message_mentions_evora',
    phoneNumberId,
    enterpriseId: evoraEnterprise?.id ?? null,
    enterpriseName: evoraEnterprise?.name ?? null,
    matchedBy: 'message_evora_keyword',
  });

  if (!evoraEnterprise) return params.conversation;

  const updated = await setConversationEnterpriseIdAndOrigin(params.conversation.id, evoraEnterprise.id);
  const finalConversation = updated ?? params.conversation;
  if (finalConversation.enterprise_id !== evoraEnterprise.id) {
    console.log('[ANA_ENTERPRISE_RESOLVE]', {
      conversationId: params.conversation.id,
      metaMessageId: params.metaMessageId,
      reason: 'enterprise_update_not_applied',
      phoneNumberId,
      enterpriseId: finalConversation.enterprise_id ?? null,
      enterpriseName: evoraEnterprise.name,
      matchedBy: 'message_evora_keyword',
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
