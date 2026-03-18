import type { WhatsAppIntegrationConfig } from '../types/settings.js';
import type { MetaSendMessageResponse, MetaErrorResponse } from '../types/whatsapp.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { readFile } from 'fs/promises';
import { Blob } from 'buffer';

const META_GRAPH_BASE = 'https://graph.facebook.com';
const REQUEST_TIMEOUT_MS = 120000;

async function getCfg(): Promise<WhatsAppIntegrationConfig | null> {
  const c = await getWhatsAppConfig();
  if (!c || !c.enabled || !c.metaAccessToken?.trim() || !c.whatsappPhoneNumberId?.trim()) return null;
  return c;
}

export interface SendTextResult {
  success: boolean;
  metaMessageId?: string;
  error?: string;
  code?: number;
}

export async function sendTextMessage(to: string, text: string): Promise<SendTextResult> {
  const config = await getCfg();
  if (!config) {
    const c = await getWhatsAppConfig();
    if (!c) return { success: false, error: 'Integração WhatsApp não configurada.' };
    if (!c.enabled) return { success: false, error: 'Integração desabilitada.' };
    return { success: false, error: 'Token ou Phone Number ID ausente.' };
  }
  const normalizedTo = to.replace(/\D/g, '');
  if (!normalizedTo) return { success: false, error: 'Número inválido.' };
  const url = `${META_GRAPH_BASE}/${config.apiVersion}/${config.whatsappPhoneNumberId}/messages`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.metaAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'text',
        text: { body: text },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = (await res.json()) as MetaSendMessageResponse | MetaErrorResponse;
    if (!res.ok) {
      const err = (data as MetaErrorResponse).error;
      return { success: false, error: err?.message ?? `HTTP ${res.status}`, code: err?.code };
    }
    const mid = (data as MetaSendMessageResponse).messages?.[0]?.id;
    return { success: true, metaMessageId: mid };
  } catch (e) {
    clearTimeout(timeout);
    return { success: false, error: e instanceof Error ? e.message : 'Erro ao enviar' };
  }
}

/** Envia documento (arquivo local). Só para empreendimento já validado pelo chamador. */
export async function sendDocumentMessage(
  to: string,
  filePath: string,
  filename: string
): Promise<SendTextResult> {
  const config = await getCfg();
  if (!config) return { success: false, error: 'WhatsApp não configurado.' };
  const normalizedTo = to.replace(/\D/g, '');
  if (!normalizedTo) return { success: false, error: 'Número inválido.' };
  const token = config.metaAccessToken;
  const phoneId = config.whatsappPhoneNumberId;
  const v = config.apiVersion;
  const mediaUrl = `${META_GRAPH_BASE}/${v}/${phoneId}/media`;
  const FormDataCtor = (globalThis as unknown as { FormData?: new () => any }).FormData;
  if (!FormDataCtor) return { success: false, error: 'FormData indisponível no runtime.' };
  const form = new FormDataCtor();
  form.append('messaging_product', 'whatsapp');
  const fileBuf = await readFile(filePath);
  form.append(
    'file',
    new Blob([fileBuf], { type: 'application/octet-stream' }),
    filename || 'documento.pdf'
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const up = await fetch(mediaUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: controller.signal,
    });
    const upData = (await up.json()) as { id?: string; error?: { message?: string } };
    if (!up.ok) {
      clearTimeout(timeout);
      return { success: false, error: upData.error?.message ?? `Upload media ${up.status}` };
    }
    const mediaId = upData.id;
    if (!mediaId) {
      clearTimeout(timeout);
      return { success: false, error: 'Meta não retornou id do media.' };
    }
    const msgUrl = `${META_GRAPH_BASE}/${v}/${phoneId}/messages`;
    const res = await fetch(msgUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: normalizedTo,
        type: 'document',
        document: { id: mediaId, filename: filename || 'arquivo' },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = (await res.json()) as MetaSendMessageResponse | MetaErrorResponse;
    if (!res.ok) {
      const err = (data as MetaErrorResponse).error;
      return { success: false, error: err?.message ?? `HTTP ${res.status}` };
    }
    return { success: true, metaMessageId: (data as MetaSendMessageResponse).messages?.[0]?.id };
  } catch (e) {
    clearTimeout(timeout);
    return { success: false, error: e instanceof Error ? e.message : 'Erro documento' };
  }
}

export async function testConnection(): Promise<{ success: boolean; error?: string; detail?: string }> {
  const config = await getWhatsAppConfig();
  if (!config?.enabled) return { success: false, error: 'Integração não está ativa.' };
  if (!config.metaAccessToken?.trim()) return { success: false, error: 'Token não configurado.' };
  if (!config.whatsappPhoneNumberId?.trim()) return { success: false, error: 'Phone Number ID não configurado.' };
  const url = `${META_GRAPH_BASE}/${config.apiVersion}/${config.whatsappPhoneNumberId}?fields=verified_name,display_phone_number`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${config.metaAccessToken}` },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = (await res.json()) as { error?: { message: string } };
    if (!res.ok) return { success: false, error: 'Falha na Meta.', detail: data.error?.message };
    return { success: true };
  } catch (e) {
    clearTimeout(timeout);
    return { success: false, error: 'Erro de conexão.', detail: e instanceof Error ? e.message : String(e) };
  }
}
