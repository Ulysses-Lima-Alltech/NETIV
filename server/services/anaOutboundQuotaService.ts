import {
  sendLocalMediaToWhatsApp,
  sendTextMessage,
  type DocumentSendLogContext,
  type SendTextResult,
} from './whatsappMetaService.js';

export type AnaQuotaSendResult = SendTextResult;

export async function sendAnaTextMessageWithQuota(params: {
  conversationId: number;
  to: string;
  text: string;
  phase: string;
}): Promise<AnaQuotaSendResult> {
  void params.conversationId;
  void params.phase;
  return sendTextMessage(params.to, params.text);
}

export async function sendAnaLocalMediaToWhatsAppWithQuota(params: {
  conversationId: number;
  to: string;
  filePath: string;
  filename: string;
  mimeFromDb: string;
  phase: string;
  options?: { logCtx?: DocumentSendLogContext; caption?: string | null };
}): Promise<AnaQuotaSendResult> {
  void params.conversationId;
  void params.phase;
  return sendLocalMediaToWhatsApp(
    params.to,
    params.filePath,
    params.filename,
    params.mimeFromDb,
    params.options
  );
}
