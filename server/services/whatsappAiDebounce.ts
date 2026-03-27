import { getTrailingUserMessageBurst } from '../repositories/messageRepository.js';
import { handleIncomingMessage } from './conversationEngine.js';
import {
  bumpConversationPipelineToken,
  getConversationPipelineToken,
} from './conversationPipelineToken.js';

/**
 * Dispara processamento da IA imediatamente após salvar mensagem do usuário.
 * O pipeline token garante que uma mensagem nova cancele resposta pendente da anterior.
 */
export function scheduleWhatsAppAiAfterUserMessage(conversationId: number, toPhoneNumber: string): void {
  const pipelineToken = bumpConversationPipelineToken(conversationId);
  console.log('[ANA_PIPELINE] immediate_dispatch', { conversationId, pipelineToken });
  void flushSingleMessage(conversationId, toPhoneNumber, pipelineToken);
}

async function flushSingleMessage(
  conversationId: number,
  toPhoneNumber: string,
  pipelineToken: number
): Promise<void> {
  try {
    const burst = await getTrailingUserMessageBurst(conversationId);
    if (burst.length === 0) return;
    const merged = burst
      .map((m) => (m.content || '').trim())
      .filter(Boolean)
      .join('\n');
    if (!merged) return;
    if (getConversationPipelineToken(conversationId) !== pipelineToken) {
      console.log('[ANA_PIPELINE] flush_aborted_token_mismatch', { conversationId, pipelineToken });
      return;
    }
    await handleIncomingMessage({
      conversationId,
      userMessage: merged,
      toPhoneNumber,
      trailingUserBubbles: burst.length,
      replyPipelineToken: pipelineToken,
    });
  } catch (e) {
    console.error('[ANA_PIPELINE] flush_error', e instanceof Error ? e.message : String(e));
  }
}
