import type { WhatsAppIntegrationConfig } from '../types/settings.js';
import type { MetaSendMessageResponse, MetaErrorResponse } from '../types/whatsapp.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';

const META_GRAPH_BASE = 'https://graph.facebook.com';
const REQUEST_TIMEOUT_MS = 15000;

function getConfig(): WhatsAppIntegrationConfig | null {
  const c = getWhatsAppConfig();
  if (!c || !c.enabled || !c.metaAccessToken || !c.whatsappPhoneNumberId) return null;
  return c;
}

function sanitizeForLog(value: string): string {
  if (value.length <= 8) return '***';
  return value.slice(0, 4) + '***' + value.slice(-4);
}

export interface SendTextResult {
  success: boolean;
  metaMessageId?: string;
  error?: string;
  code?: number;
}

export async function sendTextMessage(to: string, text: string): Promise<SendTextResult> {
  const config = getConfig();
  if (!config) {
    if (!getWhatsAppConfig()) return { success: false, error: 'Integração WhatsApp não configurada.' };
    const c = getWhatsAppConfig()!;
    if (!c.enabled) return { success: false, error: 'Integração WhatsApp está desabilitada.' };
    if (!c.metaAccessToken) return { success: false, error: 'Token da Meta não configurado.' };
    if (!c.whatsappPhoneNumberId) return { success: false, error: 'Phone Number ID não configurado.' };
    return { success: false, error: 'Configuração incompleta da integração WhatsApp.' };
  }

  const normalizedTo = to.replace(/\D/g, '');
  if (!normalizedTo) return { success: false, error: 'Número do destinatário inválido.' };

  const url = `${META_GRAPH_BASE}/${config.apiVersion}/${config.whatsappPhoneNumberId}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: normalizedTo,
    type: 'text',
    text: { body: text },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.metaAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);
    const data = (await res.json()) as MetaSendMessageResponse | MetaErrorResponse;

    if (!res.ok) {
      const err = (data as MetaErrorResponse).error;
      const message = err?.message ?? `Erro HTTP ${res.status}`;
      const code = err?.code;
      console.error('[WhatsApp] Meta API error:', { message, code, to: sanitizeForLog(normalizedTo) });
      return { success: false, error: message, code };
    }

    const success = data as MetaSendMessageResponse;
    const metaMessageId = success.messages?.[0]?.id;
    return { success: true, metaMessageId };
  } catch (e) {
    clearTimeout(timeout);
    const message = e instanceof Error ? e.message : 'Erro ao enviar mensagem';
    console.error('[WhatsApp] Send failed:', message);
    return { success: false, error: message };
  }
}

/** Test connection using saved config: GET phone number details from Meta. */
export async function testConnection(): Promise<{ success: boolean; error?: string; detail?: string }> {
  const config = getWhatsAppConfig();
  if (!config?.enabled) return { success: false, error: 'Integração não está ativa.' };
  if (!config.metaAccessToken?.trim()) return { success: false, error: 'Token da Meta não configurado.' };
  if (!config.whatsappPhoneNumberId?.trim()) return { success: false, error: 'Phone Number ID não configurado.' };

  const url = `${META_GRAPH_BASE}/${config.apiVersion}/${config.whatsappPhoneNumberId}?fields=verified_name,display_phone_number`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.metaAccessToken}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = (await res.json()) as { verified_name?: string; display_phone_number?: string; error?: { message: string } };
    if (!res.ok) {
      const msg = data.error?.message ?? `Erro HTTP ${res.status}`;
      console.error('[WhatsApp] Test connection error:', msg);
      return { success: false, error: 'Falha ao validar com a Meta.', detail: msg };
    }
    return { success: true };
  } catch (e) {
    clearTimeout(timeout);
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[WhatsApp] Test connection:', msg);
    return { success: false, error: 'Erro de conexão.', detail: msg };
  }
}
