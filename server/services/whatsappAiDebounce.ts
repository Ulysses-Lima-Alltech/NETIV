import { getTrailingUserMessageBurst } from '../repositories/messageRepository.js';
import { handleIncomingMessage } from './conversationEngine.js';
import {
  bumpConversationPipelineToken,
  getConversationPipelineToken,
} from './conversationPipelineToken.js';

function phoneTail(raw: string, len = 6): string | null {
  const d = String(raw ?? '').replace(/\D/g, '');
  return d.length ? d.slice(-len) : null;
}

/**
 * Dispara processamento da IA imediatamente após salvar mensagem do usuário.
 * O pipeline token garante que uma mensagem nova cancele resposta pendente da anterior.
 */
export function scheduleWhatsAppAiAfterUserMessage(
  conversationId: number,
  toPhoneNumber: string,
  inboundMetaMessageId?: string | null
): void {
  const pipelineToken = bumpConversationPipelineToken(conversationId);
  console.log('[ANA_PIPELINE] debounce_start', {
    conversationId,
    pipelineToken,
    toPhoneTail: phoneTail(toPhoneNumber, 6),
    inboundMetaMessageId: inboundMetaMessageId ?? null,
  });
  void flushSingleMessage(conversationId, toPhoneNumber, pipelineToken, inboundMetaMessageId ?? null);
}

async function flushSingleMessage(
  conversationId: number,
  toPhoneNumber: string,
  pipelineToken: number,
  inboundMetaMessageId: string | null
): Promise<void> {
  try {
    const burst = await getTrailingUserMessageBurst(conversationId);
    if (burst.length === 0) {
      console.log('[ANA_PIPELINE] flush_skip', {
        reason: 'empty_trailing_user_burst',
        conversationId,
        pipelineToken,
        toPhoneTail: phoneTail(toPhoneNumber, 6),
        inboundMetaMessageId,
      });
      return;
    }
    const merged = burst
      .map((m) => (m.content || '').trim())
      .filter(Boolean)
      .join('\n');
    if (!merged) {
      console.log('[ANA_PIPELINE] flush_skip', {
        reason: 'empty_merged_burst_text',
        conversationId,
        pipelineToken,
        toPhoneTail: phoneTail(toPhoneNumber, 6),
        inboundMetaMessageId,
        burstDbIds: burst.map((m) => m.id),
      });
      return;
    }
    if (getConversationPipelineToken(conversationId) !== pipelineToken) {
      console.log('[ANA_PIPELINE] flush_skip', {
        reason: 'pipeline_token_mismatch_before_engine',
        conversationId,
        pipelineToken,
        currentToken: getConversationPipelineToken(conversationId),
        toPhoneTail: phoneTail(toPhoneNumber, 6),
        inboundMetaMessageId,
      });
      return;
    }
    const lastBurstMeta = [...burst].reverse().find((m) => m.meta_message_id)?.meta_message_id ?? null;
    console.log('[ANA_PIPELINE] flush_dispatch', {
      conversationId,
      pipelineToken,
      toPhoneTail: phoneTail(toPhoneNumber, 6),
      inboundMetaMessageId: inboundMetaMessageId ?? lastBurstMeta,
      mergedLen: merged.length,
      trailingUserBubbles: burst.length,
    });
    await handleIncomingMessage({
      conversationId,
      userMessage: merged,
      toPhoneNumber,
      trailingUserBubbles: burst.length,
      replyPipelineToken: pipelineToken,
      inboundMetaMessageId: inboundMetaMessageId ?? lastBurstMeta,
    });
  } catch (e) {
    console.error('[ANA_PIPELINE] flush_error', e instanceof Error ? e.message : String(e));
  }
}
