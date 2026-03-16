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
    messaging_product: 'whatsapp',
    to: normalizedTo,
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
    const data = (await res.json()) as { error?: { message?: string; code?: number } };

    if (!res.ok) {
      const msg = data.error?.message ?? `Erro HTTP ${res.status}`;
      console.error('[WhatsApp] Meta API error:', msg);
      throw new Error(msg);
    }
  } catch (e) {
    clearTimeout(timeout);
    const message = e instanceof Error ? e.message : 'Erro ao enviar mensagem';
    console.error('[WhatsApp] Send failed:', message);
    throw e;
  }
}
