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

function logWhatsappDocumentResult(params: {
  mediaId: string | undefined;
  metaMessageId: string | undefined;
  errorMessageIfAny: string | undefined;
}): void {
  const { mediaId, metaMessageId, errorMessageIfAny } = params;
  console.log('[WHATSAPP DOCUMENT RESULT]', {
    uploadSuccess: !!mediaId,
    mediaId: mediaId ?? null,
    messageSuccess: !!metaMessageId,
    metaMessageId: metaMessageId ?? null,
    error: errorMessageIfAny ?? null,
  });
}

/** Envia documento: upload multipart para /media (com `type` obrigatório na API Meta) e depois mensagem type=document com media id. */
export async function sendDocumentMessage(
  to: string,
  filePath: string,
  filename: string,
  mimeFromDb: string,
  logCtx?: DocumentSendLogContext
): Promise<SendTextResult> {
  let mediaId: string | undefined;
  let metaMessageId: string | undefined;
  let errorMessageIfAny: string | undefined;
  let resultCode: number | undefined;

  try {
    const config = await getCfg();
    if (!config) {
      errorMessageIfAny = 'WhatsApp não configurado.';
      return { success: false, error: errorMessageIfAny };
    }
    const normalizedTo = to.replace(/\D/g, '');
    if (!normalizedTo) {
      errorMessageIfAny = 'Número inválido.';
      return { success: false, error: errorMessageIfAny };
    }
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
    if (!FormDataCtor) {
      errorMessageIfAny = 'FormData indisponível no runtime.';
      return { success: false, error: errorMessageIfAny };
    }

    let fileBuf: Buffer;
    try {
      fileBuf = await readFile(filePath);
    } catch (e) {
      errorMessageIfAny = e instanceof Error ? `Falha ao ler arquivo: ${e.message}` : 'Falha ao ler arquivo.';
      return { success: false, error: errorMessageIfAny };
    }

    const form = new FormDataCtor();
    form.append('messaging_product', 'whatsapp');
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
      throw new Error(`[upload network] ${msg}`);
    }
    clearTimeout(uploadTimeout);

    let upData: { id?: string; error?: { message?: string; code?: number; type?: string; fbtrace_id?: string } };
    try {
      upData = JSON.parse(upRaw) as typeof upData;
    } catch {
      throw new Error(
        `[upload parse] Resposta não é JSON. HTTP ${up.status}. Corpo (início): ${upRaw.slice(0, 2000)}`
      );
    }

    if (logCtx) {
      console.log('[WhatsAppMeta][document] resposta upload Meta', {
        status: up.status,
        body: upRaw.slice(0, 4000),
      });
    }

    if (!up.ok) {
      const err = upData.error;
      const fullMeta = JSON.stringify({
        httpStatus: up.status,
        error: err ?? upData,
        rawBody: upRaw.slice(0, 8000),
      });
      throw new Error(`[upload Meta API] ${fullMeta}`);
    }

    const uploadedId = upData.id;
    if (!uploadedId || typeof uploadedId !== 'string') {
      throw new Error(
        `[upload sem media id] A Meta não retornou o campo "id" obrigatório após upload. HTTP ${up.status}. Corpo: ${upRaw.slice(0, 4000)}`
      );
    }
    mediaId = uploadedId;

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
      throw new Error(`[messages network] ${msg}`);
    }
    clearTimeout(sendTimeout);

    let data: MetaSendMessageResponse | MetaErrorResponse;
    try {
      data = JSON.parse(resRaw) as MetaSendMessageResponse | MetaErrorResponse;
    } catch {
      throw new Error(
        `[messages parse] Resposta não é JSON. HTTP ${res.status}. Corpo (início): ${resRaw.slice(0, 2000)}`
      );
    }

    if (logCtx) {
      console.log('[WhatsAppMeta][document] resposta Meta (mensagem document)', {
        status: res.status,
        body: resRaw.slice(0, 4000),
      });
    }

    if (!res.ok) {
      const err = (data as MetaErrorResponse).error;
      const fullMeta = JSON.stringify({
        httpStatus: res.status,
        error: err ?? data,
        rawBody: resRaw.slice(0, 8000),
      });
      throw new Error(`[messages Meta API] ${fullMeta}`);
    }

    const mid = (data as MetaSendMessageResponse).messages?.[0]?.id;
    if (!mid || typeof mid !== 'string') {
      throw new Error(
        `[messages sem message id] A Meta não retornou messages[0].id. HTTP ${res.status}. Corpo: ${resRaw.slice(0, 4000)}`
      );
    }
    metaMessageId = mid;
    return { success: true, metaMessageId: mid };
  } catch (e) {
    const errObj = e instanceof Error ? e : new Error(String(e));
    errorMessageIfAny = errorMessageIfAny ?? errObj.message;

    let metaForLog: unknown = null;
    if (errObj.message.includes('[upload Meta API]') || errObj.message.includes('[messages Meta API]')) {
      try {
        const jsonPart = errObj.message.replace(/^\[(upload|messages) Meta API\] /, '');
        metaForLog = JSON.parse(jsonPart);
      } catch {
        metaForLog = errObj.message;
      }
    }

    console.error('[WhatsAppMeta][document] erro capturado (completo)', {
      message: errObj.message,
      stack: errObj.stack,
      meta: metaForLog,
      cause: errObj.cause,
    });

    const codeFromMeta =
      metaForLog &&
      typeof metaForLog === 'object' &&
      metaForLog !== null &&
      'error' in metaForLog &&
      metaForLog.error &&
      typeof metaForLog.error === 'object' &&
      'code' in metaForLog.error
        ? Number((metaForLog.error as { code?: number }).code)
        : undefined;
    if (codeFromMeta != null && !Number.isNaN(codeFromMeta)) resultCode = codeFromMeta;

    const shortError =
      metaForLog &&
      typeof metaForLog === 'object' &&
      metaForLog !== null &&
      'error' in metaForLog &&
      metaForLog.error &&
      typeof metaForLog.error === 'object' &&
      'message' in metaForLog.error
        ? String((metaForLog.error as { message?: string }).message)
        : errorMessageIfAny;

    return {
      success: false,
      error: shortError ?? errorMessageIfAny,
      code: resultCode,
    };
  } finally {
    logWhatsappDocumentResult({ mediaId, metaMessageId, errorMessageIfAny });
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
