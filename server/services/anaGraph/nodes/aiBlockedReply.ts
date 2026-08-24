import type { SendWhatsappTextFn, InsertAssistantMessageFn } from './sendWhatsapp.js';
import { sendAnaTextMessageWithQuota } from '../../anaOutboundQuotaService.js';
import type { AnaGraphState } from '../state.js';

export interface AiBlockedReplyNodeParams {
  conversationId: number;
  toPhoneNumber: string;
  sendText?: SendWhatsappTextFn;
  insertAssistantMessage?: InsertAssistantMessageFn;
}

/**
 * Envia a resposta fixa quando aiAvailabilityGateNode bloqueia o turno
 * (bloqueio emergencial, IA desativada, API key ausente). Envia direto,
 * fora do pipeline de finalizeReply -- mesmo comportamento do motor legado
 * (conversationEngine.ts ~linha 6214: sendTextMessage cru, sem passar pelo
 * guard de "sempre terminar com pergunta" nem qualquer sanitização pensada
 * pra texto livre do LLM, já que essa mensagem é literal/administrativa).
 * Vai direto pra persistState depois (mesmo padrão de humanHandoffNode).
 */
export async function aiBlockedReplyNode(
  state: AnaGraphState,
  params: AiBlockedReplyNodeParams
): Promise<Partial<AnaGraphState>> {
  const replyText = state.aiBlockedReplyText;
  if (!replyText) {
    // ana_model_not_configured: silêncio deliberado, mesmo comportamento do motor legado.
    return { assistantReplyText: null, replyIntentionallyEmpty: true };
  }

  const sendText = params.sendText ?? sendAnaTextMessageWithQuota;
  const result = await sendText({
    conversationId: params.conversationId,
    to: params.toPhoneNumber,
    text: replyText,
    phase: 'ana_graph_ai_blocked',
  });

  if (result.success && result.metaMessageId && params.insertAssistantMessage) {
    await params.insertAssistantMessage(params.conversationId, replyText, result.metaMessageId);
  }

  return { assistantReplyText: replyText, replyIntentionallyEmpty: true };
}
