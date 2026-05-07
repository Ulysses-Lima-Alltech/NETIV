export const ANA_EMERGENCY_HANDOFF_ENV = 'ANA_EMERGENCY_HANDOFF';

export const ANA_EMERGENCY_HANDOFF_MESSAGE =
  'Ol\u00e1! Obrigada pelo seu contato e pelo interesse.\n\n' +
  'No momento, seu atendimento ser\u00e1 direcionado para um corretor. Em breve, ' +
  'um especialista entrar\u00e1 em contato para passar mais informa\u00e7\u00f5es e te ajudar da melhor forma.';

const ACTIVE_VALUES = new Set(['true', '1', 'yes', 'on']);

export function isAnaEmergencyHandoffEnabled(value = process.env[ANA_EMERGENCY_HANDOFF_ENV]): boolean {
  return ACTIVE_VALUES.has(String(value ?? '').trim().toLowerCase());
}

export interface AnaEmergencyHandoffSendResult {
  success: boolean;
  metaMessageId?: string;
  error?: string;
  code?: number;
}

export interface AnaEmergencyHandoffResult {
  handled: true;
  replyText: string;
  sent: boolean;
  metaMessageId: string | null;
  error: string | null;
}

export async function sendAnaEmergencyHandoff(params: {
  conversationId: number;
  toPhoneNumber: string;
  sendTextMessage: (to: string, text: string) => Promise<AnaEmergencyHandoffSendResult>;
  insertAssistantMessage: (conversationId: number, text: string, metaMessageId: string) => Promise<unknown>;
}): Promise<AnaEmergencyHandoffResult> {
  const replyText = ANA_EMERGENCY_HANDOFF_MESSAGE;
  const sendResult = await params.sendTextMessage(params.toPhoneNumber, replyText);

  if (sendResult.success && sendResult.metaMessageId) {
    await params.insertAssistantMessage(params.conversationId, replyText, sendResult.metaMessageId);
    return {
      handled: true,
      replyText,
      sent: true,
      metaMessageId: sendResult.metaMessageId,
      error: null,
    };
  }

  return {
    handled: true,
    replyText,
    sent: false,
    metaMessageId: null,
    error: sendResult.error ?? 'send_failed',
  };
}
