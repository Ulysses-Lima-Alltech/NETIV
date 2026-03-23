import { getTrailingUserMessageBurst } from '../repositories/messageRepository.js';
import { handleIncomingMessage } from './conversationEngine.js';

/** Espera mensagens curtas em sequência antes de uma única resposta da Ana (WhatsApp). */
const CONSOLIDATION_WINDOW_MS = 2600;

const conversationTimers = new Map<number, ReturnType<typeof setTimeout>>();

/**
 * Agenda processamento da IA após salvar mensagem do usuário.
 * Várias mensagens seguidas do mesmo contato são fundidas em um único contexto ao disparar o timer.
 */
export function scheduleWhatsAppAiAfterUserMessage(conversationId: number, toPhoneNumber: string): void {
  const prev = conversationTimers.get(conversationId);
  if (prev) clearTimeout(prev);
  const t = setTimeout(() => {
    conversationTimers.delete(conversationId);
    void flushPendingUserBurst(conversationId, toPhoneNumber);
  }, CONSOLIDATION_WINDOW_MS);
  conversationTimers.set(conversationId, t);
}

async function flushPendingUserBurst(conversationId: number, toPhoneNumber: string): Promise<void> {
  try {
    const burst = await getTrailingUserMessageBurst(conversationId);
    if (burst.length === 0) return;
    const merged = burst
      .map((m) => (m.content || '').trim())
      .filter(Boolean)
      .join('\n');
    if (!merged) return;
    await handleIncomingMessage({
      conversationId,
      userMessage: merged,
      toPhoneNumber,
      trailingUserBubbles: burst.length,
    });
  } catch (e) {
    console.error('[WhatsAppDebounce] flushPendingUserBurst:', e instanceof Error ? e.message : String(e));
  }
}
