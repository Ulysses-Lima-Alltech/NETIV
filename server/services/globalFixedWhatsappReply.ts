import { insertMessage } from '../repositories/messageRepository.js';
import { sendTextMessage, type SendTextResult } from './whatsappMetaService.js';

export const GLOBAL_FIXED_WHATSAPP_REPLY =
  'Olá, que bom ter você por aqui !\nEm breve um dos nossos consultores entrará em contato para passar as informações do empreendimento';

// Operational switch: enable on the backend only after deploying this code.
export function isGlobalFixedWhatsappReplyEnabled(): boolean {
  return process.env.NETIV_GLOBAL_FIXED_REPLY_ENABLED?.trim().toLowerCase() === 'true';
}

export async function sendGlobalFixedWhatsappReply(params: {
  conversationId: number;
  to: string;
  inboundMetaMessageId: string;
  send?: (to: string, text: string) => Promise<SendTextResult>;
  persist?: (conversationId: number, text: string, metaMessageId: string) => Promise<unknown>;
}): Promise<boolean> {
  // This incident override intentionally also applies to Handoff conversations.
  // The normal Ana outbound wrapper would suppress those sends.
  const result = await (params.send ?? sendTextMessage)(params.to, GLOBAL_FIXED_WHATSAPP_REPLY);
  if (!result.success || !result.metaMessageId) {
    console.error('[GLOBAL_FIXED_WHATSAPP_REPLY] send_failed', {
      conversationId: params.conversationId,
      inboundMetaMessageId: params.inboundMetaMessageId,
      code: result.code ?? null,
      error: result.error ?? 'missing_outbound_message_id',
    });
    return false;
  }
  await (params.persist ?? ((id, text, mid) => insertMessage(id, 'assistant', text, mid)))(
    params.conversationId,
    GLOBAL_FIXED_WHATSAPP_REPLY,
    result.metaMessageId
  );
  console.log('[GLOBAL_FIXED_WHATSAPP_REPLY] sent', {
    conversationId: params.conversationId,
    inboundMetaMessageId: params.inboundMetaMessageId,
    outboundMetaMessageId: result.metaMessageId,
  });
  return true;
}
