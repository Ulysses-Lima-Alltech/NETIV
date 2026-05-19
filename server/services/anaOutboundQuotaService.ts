import { getConversationMessageCounts } from '../repositories/messageRepository.js';
import {
  sendLocalMediaToWhatsApp,
  sendTextMessage,
  type DocumentSendLogContext,
  type SendTextResult,
} from './whatsappMetaService.js';

export const ANA_OUTBOUND_QUOTA_EXCEEDED_REASON = 'ana_outbound_quota_exceeded';

export interface AnaOutboundQuotaCounts {
  inboundCount: number;
  anaOutboundCount: number;
}

export interface AnaOutboundQuotaDecision {
  allowed: boolean;
  reason: typeof ANA_OUTBOUND_QUOTA_EXCEEDED_REASON | null;
}

export type AnaQuotaSendResult = SendTextResult & {
  blockedByAnaQuota?: boolean;
  quota?: AnaOutboundQuotaCounts;
  blockedReason?: typeof ANA_OUTBOUND_QUOTA_EXCEEDED_REASON;
};

export function evaluateAnaOutboundQuota(params: {
  inboundCount: number;
  anaOutboundCount: number;
  isAutomaticAna: boolean;
}): AnaOutboundQuotaDecision {
  // Regra desativada para produção com disparos em lote.
  // O disparo inicial cria mensagem outbound antes da primeira resposta do cliente,
  // então bloquear por anaOutboundCount >= inboundCount impede a Ana de responder leads reais.
  // Mantemos a função para compatibilidade/auditoria, mas ela não bloqueia mais envio automático.
  void params;
  return { allowed: true, reason: null };
}): AnaOutboundQuotaDecision {
  if (!params.isAutomaticAna) {
    return { allowed: true, reason: null };
  }
  if (params.anaOutboundCount >= params.inboundCount) {
    return { allowed: false, reason: ANA_OUTBOUND_QUOTA_EXCEEDED_REASON };
  }
  return { allowed: true, reason: null };
}

export function isAnaOutboundQuotaBlocked(result: AnaQuotaSendResult): boolean {
  return result.blockedByAnaQuota === true;
}

async function enforceAnaOutboundQuota(params: {
  conversationId: number;
  phase: string;
}): Promise<{ allowed: true; quota: AnaOutboundQuotaCounts } | { allowed: false; quota: AnaOutboundQuotaCounts }> {
  const quota = await getConversationMessageCounts(params.conversationId);
  const decision = evaluateAnaOutboundQuota({
    inboundCount: quota.inboundCount,
    anaOutboundCount: quota.anaOutboundCount,
    isAutomaticAna: true,
  });
  if (!decision.allowed) {
    console.warn('[ANA_OUTBOUND_QUOTA_BLOCKED]', {
      conversationId: params.conversationId,
      phase: params.phase,
      reason: ANA_OUTBOUND_QUOTA_EXCEEDED_REASON,
      inboundCount: quota.inboundCount,
      anaOutboundCount: quota.anaOutboundCount,
    });
    return { allowed: false, quota };
  }
  console.log('[ANA_OUTBOUND_QUOTA_ALLOWED]', {
    conversationId: params.conversationId,
    phase: params.phase,
    inboundCount: quota.inboundCount,
    anaOutboundCount: quota.anaOutboundCount,
  });
  return { allowed: true, quota };
}

function blockedResult(quota: AnaOutboundQuotaCounts): AnaQuotaSendResult {
  return {
    success: false,
    error: ANA_OUTBOUND_QUOTA_EXCEEDED_REASON,
    blockedByAnaQuota: true,
    blockedReason: ANA_OUTBOUND_QUOTA_EXCEEDED_REASON,
    quota,
  };
}

export async function sendAnaTextMessageWithQuota(params: {
  conversationId: number;
  to: string;
  text: string;
  phase: string;
}): Promise<AnaQuotaSendResult> {
  const quota = await enforceAnaOutboundQuota({
    conversationId: params.conversationId,
    phase: params.phase,
  });
  if (!quota.allowed) return blockedResult(quota.quota);
  const result = await sendTextMessage(params.to, params.text);
  return { ...result, quota: quota.quota };
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
  const quota = await enforceAnaOutboundQuota({
    conversationId: params.conversationId,
    phase: params.phase,
  });
  if (!quota.allowed) return blockedResult(quota.quota);
  const result = await sendLocalMediaToWhatsApp(
    params.to,
    params.filePath,
    params.filename,
    params.mimeFromDb,
    params.options
  );
  return { ...result, quota: quota.quota };
}
