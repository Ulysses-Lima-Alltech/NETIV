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
import {
  logAnaAutomationBlock,
  shouldBlockAnaAutomationOutbound,
} from '../utils/anaAutomationKillSwitch.js';
import { getConversationById } from '../repositories/conversationRepository.js';
import {
  isAnaAutomationBlockedByHandoff,
  logAnaAutomationBlockedByHandoff,
} from '../utils/anaHandoffPolicy.js';

export type AnaQuotaSendResult = SendTextResult;

type AnaHandoffConversationLoader = typeof getConversationById;
let anaHandoffConversationLoader: AnaHandoffConversationLoader = getConversationById;

export function __setAnaHandoffConversationLoaderForTest(
  loader: AnaHandoffConversationLoader
): () => void {
  const previous = anaHandoffConversationLoader;
  anaHandoffConversationLoader = loader;
  return () => { anaHandoffConversationLoader = previous; };
}

async function blockAutomaticSendForCurrentHandoff(params: {
  conversationId: number;
  phase: string;
}): Promise<boolean> {
  const conversation = await anaHandoffConversationLoader(params.conversationId);
  if (!isAnaAutomationBlockedByHandoff(conversation)) return false;
  logAnaAutomationBlockedByHandoff(conversation!, {
    conversationId: params.conversationId,
    automationType: params.phase,
    blockedAt: 'before_send',
    source: 'ana_outbound_quota',
  });
  return true;
}

export async function sendAnaTextMessageWithQuota(params: {
  conversationId: number;
  to: string;
  text: string;
  phase: string;
}): Promise<AnaQuotaSendResult> {
  const blocked = shouldBlockAnaAutomationOutbound({
    source: params.phase,
    conversationId: params.conversationId,
  });
  if (blocked.blocked) {
    logAnaAutomationBlock(blocked);
    return {
      success: false,
      error: blocked.reason,
      code: 423,
    };
  }
  if (await blockAutomaticSendForCurrentHandoff(params)) {
    return { success: false, error: 'handoff_active', code: 423 };
  }
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
  const blocked = shouldBlockAnaAutomationOutbound({
    source: params.phase,
    conversationId: params.conversationId,
  });
  if (blocked.blocked) {
    logAnaAutomationBlock(blocked);
    return {
      success: false,
      error: blocked.reason,
      code: 423,
    };
  }
  if (await blockAutomaticSendForCurrentHandoff(params)) {
    return { success: false, error: 'handoff_active', code: 423 };
  }
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
