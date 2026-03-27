import { getTrailingUserMessageBurst } from '../repositories/messageRepository.js';
import { handleIncomingMessage } from './conversationEngine.js';
import {
  bumpConversationPipelineToken,
  getConversationPipelineToken,
} from './conversationPipelineToken.js';

/** Janela para consolidar bolhas seguidas do mesmo contato. */
const CONSOLIDATION_WINDOW_MS = 1200;
/** Teto desde a primeira bolha da rajada. */
const MAX_BURST_WAIT_MS = 4500;

const conversationTimers = new Map<number, { timer: ReturnType<typeof setTimeout>; firstAt: number }>();

/**
 * Agenda processamento da IA após salvar mensagem do usuário.
 * Várias mensagens seguidas do mesmo contato são fundidas em um único contexto ao disparar o timer.
 */
export function scheduleWhatsAppAiAfterUserMessage(conversationId: number, toPhoneNumber: string): void {
  const pipelineToken = bumpConversationPipelineToken(conversationId);
  const now = Date.now();
  const prev = conversationTimers.get(conversationId);
  if (prev) {
    clearTimeout(prev.timer);
    console.log('[ANA_PIPELINE] debounce_reset', {
      conversationId,
      pipelineToken,
      reason: 'nova_mensagem_ou_reagendamento',
    });
  }
  const firstAt = prev?.firstAt ?? now;
  const elapsed = now - firstAt;
  const waitMs = Math.min(CONSOLIDATION_WINDOW_MS, Math.max(120, MAX_BURST_WAIT_MS - elapsed));
  console.log('[ANA_PIPELINE] debounce_scheduled', {
    conversationId,
    pipelineToken,
    waitMs,
    consolidationWindowMs: CONSOLIDATION_WINDOW_MS,
  });
  const t = setTimeout(() => {
    conversationTimers.delete(conversationId);
    const current = getConversationPipelineToken(conversationId);
    if (current !== pipelineToken) {
      console.log('[ANA_PIPELINE] debounce_superseded', {
        conversationId,
        scheduledToken: pipelineToken,
        currentToken: current,
      });
      return;
    }
    void flushPendingUserBurst(conversationId, toPhoneNumber, pipelineToken);
  }, waitMs);
  conversationTimers.set(conversationId, { timer: t, firstAt });
}

async function flushPendingUserBurst(
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
    const metaIds = burst.map((m) => m.meta_message_id).filter(Boolean);
    console.log('[ANA_PIPELINE] debounce_flush', {
      conversationId,
      pipelineToken,
      bubbleCount: burst.length,
      mergedLength: merged.length,
      metaMessageIds: metaIds,
    });
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
