import { getTrailingUserMessageBurst } from '../repositories/messageRepository.js';
import { handleIncomingMessage } from './conversationEngine.js';

/** Espera após a última bolha antes de consolidar (rajada WhatsApp). */
const CONSOLIDATION_WINDOW_MS = 2600;
/** Teto: não adiar resposta além deste tempo desde a primeira bolha da rajada (evita fila de minutos se o cliente digita devagar). */
const MAX_BURST_WAIT_MS = 8000;

const conversationTimers = new Map<number, { timer: ReturnType<typeof setTimeout>; firstAt: number }>();

/**
 * Agenda processamento da IA após salvar mensagem do usuário.
 * Várias mensagens seguidas do mesmo contato são fundidas em um único contexto ao disparar o timer.
 */
export function scheduleWhatsAppAiAfterUserMessage(conversationId: number, toPhoneNumber: string): void {
  const now = Date.now();
  const prev = conversationTimers.get(conversationId);
  if (prev) clearTimeout(prev.timer);
  const firstAt = prev?.firstAt ?? now;
  const elapsed = now - firstAt;
  const waitMs = Math.min(CONSOLIDATION_WINDOW_MS, Math.max(120, MAX_BURST_WAIT_MS - elapsed));
  const t = setTimeout(() => {
    conversationTimers.delete(conversationId);
    void flushPendingUserBurst(conversationId, toPhoneNumber);
  }, waitMs);
  conversationTimers.set(conversationId, { timer: t, firstAt });
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
