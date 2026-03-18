import { config } from '../config.js';

const META_GRAPH_BASE = 'https://graph.facebook.com';
const REQUEST_TIMEOUT_MS = 15000;

export function hasWhatsAppEnv(): boolean {
  return !!(config.meta.whatsappToken?.trim() && config.meta.phoneNumberId?.trim());
}

/**
 * Envia mensagem de texto via WhatsApp Cloud API usando variáveis de ambiente.
 * Não loga META_WHATSAPP_TOKEN.
 */
export async function sendTextMessage(to: string, body: string): Promise<void> {
  if (!config.meta.whatsappToken?.trim()) {
    console.error('[WhatsApp] META_WHATSAPP_TOKEN não configurado.');
    throw new Error('Configuração de envio WhatsApp indisponível.');
  }
  if (!config.meta.phoneNumberId?.trim()) {
    console.error('[WhatsApp] META_PHONE_NUMBER_ID não configurado.');
    throw new Error('Configuração de envio WhatsApp indisponível.');
  }

  const normalizedTo = to.replace(/\D/g, '');
  if (!normalizedTo) {
    throw new Error('Número do destinatário inválido.');
  }

  const url = `${META_GRAPH_BASE}/${config.meta.apiVersion}/${config.meta.phoneNumberId}/messages`;
  const payload = {
    messaging_product: 'whatsapp' as const,
    recipient_type: 'individual' as const,
    to: normalizedTo,
    type: 'text' as const,
    text: { body },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.meta.whatsappToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    let data: { error?: { message?: string; code?: number }; messages?: Array<{ id: string }> };
    try {
      const text = await res.text();
      data = text ? (JSON.parse(text) as typeof data) : {};
    } catch {
      console.error('[WhatsApp] Meta response not valid JSON, status=', res.status);
      throw new Error('Resposta inválida da Meta.');
    }

    if (!res.ok) {
      const msg = data.error?.message ?? `Erro HTTP ${res.status}`;
      const code = data.error?.code;
      console.error('[WhatsApp] Meta API error:', { status: res.status, code, message: msg });
      throw new Error(msg);
    }
    const last4 = normalizedTo.slice(-4);
    console.log('[WhatsApp] Message sent to ***' + last4);
  } catch (e) {
    clearTimeout(timeout);
    const message = e instanceof Error ? e.message : 'Erro ao enviar mensagem';
    console.error('[WhatsApp] Send failed:', message);
    throw e;
  }
}
