import {
  sendAnaTextMessageWithQuota,
  type AnaQuotaSendResult,
} from '../../anaOutboundQuotaService.js';
import type { AnaGraphState } from '../state.js';

export type SendWhatsappTextFn = (params: {
  conversationId: number;
  to: string;
  text: string;
  phase: string;
}) => Promise<AnaQuotaSendResult>;

export type InsertAssistantMessageFn = (
  conversationId: number,
  text: string,
  metaMessageId: string
) => Promise<unknown>;

export interface SendWhatsappNodeParams {
  conversationId: number;
  toPhoneNumber: string;
  phase: string;
  /**
   * Único ponto controlado por flag para envio real ao WhatsApp — nunca
   * chamado direto hardcoded fora daqui. Default aponta para a função real
   * (sendAnaTextMessageWithQuota); o modo sombra (fase 9) DEVE passar um
   * mock aqui, garantindo que o grafo novo nunca envie mensagem real.
   */
  sendText?: SendWhatsappTextFn;
  /**
   * Persiste a resposta enviada em `messages` (mesma tabela/formato que o
   * motor legado grava depois de cada envio bem-sucedido). Sem isso, o
   * caminho de sucesso do grafo (ragAnswer/knowledgeGapReply/visitScheduling/
   * sendMaterial -> aqui) nunca gravava o que a Ana respondeu: a conversa no
   * inbox ficava sem a bolha da Ana (só handoff persistia, via
   * sendAnaEmergencyHandoff), e getRecentConversationMessages nunca via a
   * resposta anterior no histórico passado pro LLM no turno seguinte.
   */
  insertAssistantMessage?: InsertAssistantMessageFn;
}

/**
 * Nó de saída: reaproveita sendAnaTextMessageWithQuota
 * (anaOutboundQuotaService.ts) sem alteração de lógica (quota/kill-switch
 * continuam aplicados pela própria função reaproveitada).
 */
export async function sendWhatsappNode(
  state: AnaGraphState,
  params: SendWhatsappNodeParams
): Promise<Partial<AnaGraphState> & { sendResult: AnaQuotaSendResult | null }> {
  const text = state.assistantReplyText;
  if (!text?.trim()) {
    return { sendResult: null };
  }

  const sendText = params.sendText ?? sendAnaTextMessageWithQuota;
  const result = await sendText({
    conversationId: params.conversationId,
    to: params.toPhoneNumber,
    text,
    phase: params.phase,
  });

  if (result.success && result.metaMessageId && params.insertAssistantMessage) {
    await params.insertAssistantMessage(params.conversationId, text, result.metaMessageId);
  }

  return { sendResult: result };
}
