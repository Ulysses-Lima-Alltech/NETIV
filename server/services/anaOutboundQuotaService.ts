import {
  sendLocalMediaToWhatsApp,
  sendTextMessage,
  classifyOutboundWhatsAppMedia,
  type DocumentSendLogContext,
  type SendTextResult,
} from './whatsappMetaService.js';
import { statSync } from 'fs';
import {
  WHATSAPP_DOCUMENT_MAX_BYTES,
  WHATSAPP_IMAGE_MAX_BYTES,
  WHATSAPP_VIDEO_MAX_BYTES,
} from '../constants/mediaLimits.js';

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
  let fileSize = 0;
  try {
    fileSize = statSync(params.filePath).size;
  } catch {
    fileSize = 0;
  }
  const kind = classifyOutboundWhatsAppMedia(params.filename, params.mimeFromDb);
  const maxBytes =
    kind === 'image'
      ? WHATSAPP_IMAGE_MAX_BYTES
      : kind === 'video'
        ? WHATSAPP_VIDEO_MAX_BYTES
        : WHATSAPP_DOCUMENT_MAX_BYTES;
  if (fileSize > maxBytes) {
    console.log('[ANA_MEDIA_TOO_LARGE_FOR_WHATSAPP]', {
      conversationId: params.conversationId,
      phase: params.phase,
      kind,
      sizeBytes: fileSize,
      maxBytes,
      fileName: params.filename,
    });
    return {
      success: false,
      error: 'Arquivo acima do limite para envio direto no WhatsApp.',
      code: 413,
    };
  }
  return sendLocalMediaToWhatsApp(
    params.to,
    params.filePath,
    params.filename,
    params.mimeFromDb,
    params.options
  );
}
