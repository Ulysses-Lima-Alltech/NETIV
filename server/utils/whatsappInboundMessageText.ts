import type { WebhookMessage } from '../types/webhook.js';

function nonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Extrai somente textos que devem seguir como mensagem textual processavel.
 * Legendas de midia continuam sendo tratadas pelo fluxo de midia/inbox, nao
 * pelo classificador como resposta textual pura.
 */
export function extractWhatsAppInboundMessageText(msg: WebhookMessage): string | null {
  const type = msg.type;

  if (type === 'text') {
    return nonEmpty(msg.text?.body);
  }

  if (type === 'button') {
    return nonEmpty(msg.button?.text) ?? nonEmpty(msg.button?.payload);
  }

  if (type === 'interactive') {
    return (
      nonEmpty(msg.interactive?.button_reply?.title) ??
      nonEmpty(msg.interactive?.list_reply?.title)
    );
  }

  return null;
}
