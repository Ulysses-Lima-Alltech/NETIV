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

  return { sendResult: result };
}
