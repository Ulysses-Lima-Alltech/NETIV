import type { WhatsAppIntegrationConfig } from '../types/settings.js';
import type { MetaSendMessageResponse, MetaErrorResponse } from '../types/whatsapp.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { readFile } from 'fs/promises';

const META_GRAPH_BASE = 'https://graph.facebook.com';
const REQUEST_TIMEOUT_MS = 120000;

async function getCfg(): Promise<WhatsAppIntegrationConfig | null> {
  const c = await getWhatsAppConfig();
  if (!c || !c.metaAccessToken?.trim() || !c.whatsappPhoneNumberId?.trim()) return null;
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
    const detail = !c
      ? 'Nenhuma config no banco'
      : `token=${c.metaAccessToken ? 'sim' : 'NÃO'}, phoneId=${c.whatsappPhoneNumberId ? 'sim' : 'NÃO'}`;
    console.error('[WhatsAppMeta] sendTextMessage: config inválida —', detail);
    if (!c) return { success: false, error: 'Integração WhatsApp não configurada no banco.' };
    return { success: false, error: `Token ou Phone Number ID ausente (${detail}).` };
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

/** Contexto opcional para logs de diagnóstico (envio book/material). */
export interface DocumentSendLogContext {
  enterpriseId: number;
  enterpriseName: string;
  conversationId: number;
  fileCategory: string;
  enterpriseFileId: number;
  relativeStoragePath: string;
  absolutePath: string;
}

/** MIME suportado pela Cloud API para documentos (evita application/octet-stream genérico). */
function resolveDocumentMimeType(filename: string, mimeFromDb: string): string {
  const name = (filename || '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const byExt: Record<string, string> = {
    pdf: 'application/pdf',
    txt: 'text/plain',
    md: 'text/markdown',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  };
  const m = (mimeFromDb || '').trim().toLowerCase();
  if (m && m !== 'application/octet-stream') return mimeFromDb.trim();
  return byExt[ext] || m || 'application/pdf';
}

/** Envia documento: upload multipart para /media (com `type` obrigatório na API Meta) e depois mensagem type=document com media id. */
export async function sendDocumentMessage(
  to: string,
  filePath: string,
  filename: string,
  mimeFromDb: string,
  logCtx?: DocumentSendLogContext
): Promise<SendTextResult> {
  const config = await getCfg();
  if (!config) return { success: false, error: 'WhatsApp não configurado.' };
  const normalizedTo = to.replace(/\D/g, '');
  if (!normalizedTo) return { success: false, error: 'Número inválido.' };
  const token = config.metaAccessToken;
  const phoneId = config.whatsappPhoneNumberId;
  const v = config.apiVersion;
  const effectiveMediaUrl = `${META_GRAPH_BASE}/${v}/${phoneId}/media`;
  const msgUrl = `${META_GRAPH_BASE}/${v}/${phoneId}/messages`;
  const safeFilename = (filename || 'documento.pdf').replace(/[\r\n\u0000]/g, '_').slice(0, 240);
  const mimeType = resolveDocumentMimeType(safeFilename, mimeFromDb);

  if (logCtx) {
    console.log('[WhatsAppMeta][document] pré-envio', {
      enterprise_id: logCtx.enterpriseId,
      enterprise_name: logCtx.enterpriseName,
      conversation_id: logCtx.conversationId,
      file_category: logCtx.fileCategory,
      enterprise_file_id: logCtx.enterpriseFileId,
      storage_path_relative: logCtx.relativeStoragePath,
      absolute_path: logCtx.absolutePath,
      mime_resolved: mimeType,
      mime_from_db: mimeFromDb,
      upload_url: effectiveMediaUrl,
      send_messages_url: msgUrl,
      to_suffix: normalizedTo.slice(-4),
    });
  }

  const FormDataCtor = (globalThis as unknown as { FormData?: new () => FormData }).FormData;
  if (!FormDataCtor) return { success: false, error: 'FormData indisponível no runtime.' };

  let fileBuf: Buffer;
  try {
    fileBuf = await readFile(filePath);
  } catch (e) {
    return { success: false, error: e instanceof Error ? `Falha ao ler arquivo: ${e.message}` : 'Falha ao ler arquivo.' };
  }

  const form = new FormDataCtor();
  form.append('messaging_product', 'whatsapp');
  // Parâmetro obrigatório na API de upload da Meta (tipo MIME do arquivo — ver documentação "Upload media").
  form.append('type', mimeType);
  form.append('file', new Blob([Uint8Array.from(fileBuf)], { type: mimeType }), safeFilename);

  const uploadPayloadSummary = {
    messaging_product: 'whatsapp',
    type: mimeType,
    file: { filename: safeFilename, byteLength: fileBuf.length, blobType: mimeType },
  };
  if (logCtx) {
    console.log('[WhatsAppMeta][document] payload upload (multipart fields)', JSON.stringify(uploadPayloadSummary));
  }

  const uploadController = new AbortController();
  const uploadTimeout = setTimeout(() => uploadController.abort(), REQUEST_TIMEOUT_MS);
  let upRaw: string;
  let up: Response;
  try {
    up = await fetch(effectiveMediaUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
      signal: uploadController.signal,
    });
    upRaw = await up.text();
  } catch (e) {
    clearTimeout(uploadTimeout);
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[WhatsAppMeta][document] exceção no upload', { error: msg, upload_url: effectiveMediaUrl });
    return { success: false, error: `Upload falhou: ${msg}` };
  }
  clearTimeout(uploadTimeout);

  let upData: { id?: string; error?: { message?: string; code?: number; type?: string } };
  try {
    upData = JSON.parse(upRaw) as typeof upData;
  } catch {
    console.error('[WhatsAppMeta][document] upload resposta não-JSON', {
      status: up.status,
      body_preview: upRaw.slice(0, 2000),
      upload_url: effectiveMediaUrl,
    });
    return { success: false, error: `Upload: resposta inválida (HTTP ${up.status})` };
  }

  if (logCtx) {
    console.log('[WhatsAppMeta][document] resposta upload Meta', {
      status: up.status,
      body: upRaw.slice(0, 4000),
    });
  }

  if (!up.ok) {
    const err = upData.error;
    return {
      success: false,
      error: err?.message ?? `Upload media HTTP ${up.status}`,
      code: err?.code,
    };
  }

  const mediaId = upData.id;
  if (!mediaId || typeof mediaId !== 'string') {
    return { success: false, error: 'Meta não retornou id do media após upload.' };
  }

  const messageBody = {
    messaging_product: 'whatsapp',
    to: normalizedTo,
    type: 'document',
    document: { id: mediaId, filename: safeFilename },
  };
  if (logCtx) {
    console.log('[WhatsAppMeta][document] payload envio mensagem (JSON)', JSON.stringify(messageBody));
  }

  const sendController = new AbortController();
  const sendTimeout = setTimeout(() => sendController.abort(), 60000);
  let resRaw: string;
  let res: Response;
  try {
    res = await fetch(msgUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(messageBody),
      signal: sendController.signal,
    });
    resRaw = await res.text();
  } catch (e) {
    clearTimeout(sendTimeout);
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[WhatsAppMeta][document] exceção ao enviar mensagem document', { error: msg, msgUrl });
    return { success: false, error: `Envio documento falhou: ${msg}` };
  }
  clearTimeout(sendTimeout);

  let data: MetaSendMessageResponse | MetaErrorResponse;
  try {
    data = JSON.parse(resRaw) as MetaSendMessageResponse | MetaErrorResponse;
  } catch {
    console.error('[WhatsAppMeta][document] mensagem resposta não-JSON', {
      status: res.status,
      body_preview: resRaw.slice(0, 2000),
      msgUrl,
    });
    return { success: false, error: `Mensagem documento: resposta inválida (HTTP ${res.status})` };
  }

  if (logCtx) {
    console.log('[WhatsAppMeta][document] resposta Meta (mensagem document)', {
      status: res.status,
      body: resRaw.slice(0, 4000),
    });
  }

  if (!res.ok) {
    const err = (data as MetaErrorResponse).error;
    return {
      success: false,
      error: err?.message ?? `HTTP ${res.status}`,
      code: err?.code,
    };
  }

  const mid = (data as MetaSendMessageResponse).messages?.[0]?.id;
  if (!mid) {
    console.error('[WhatsAppMeta][document] HTTP OK mas sem messages[0].id — tratando como falha', {
      parsed: data,
    });
    return {
      success: false,
      error: 'Meta respondeu OK mas não retornou id da mensagem (messages[0].id ausente).',
    };
  }

  return { success: true, metaMessageId: mid };
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
