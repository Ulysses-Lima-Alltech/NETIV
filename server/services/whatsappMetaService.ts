import type { WhatsAppIntegrationConfig } from '../types/settings.js';
import type { MetaSendMessageResponse, MetaErrorResponse } from '../types/whatsapp.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { readFile } from 'fs/promises';
import { classifyManualMediaKind } from '../utils/manualWhatsappAttachment.js';
import { getWhatsAppTemplateByKey } from '../catalogs/whatsappTemplates.js';
import { getMediaSetting } from '../repositories/whatsappTemplateMediaSettingsRepository.js';

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
  /** ID retornado pelo upload GET /media (antes da mensagem). */
  whatsappMediaId?: string;
  messageKind?: 'text' | 'document' | 'image' | 'video';
  error?: string;
  code?: number;
  httpStatus?: number;
  metaErrorCode?: number;
  metaErrorType?: string;
  metaErrorSubcode?: number;
  metaFbTraceId?: string;
}

type TemplateParamKey = 'customerName' | 'enterpriseName' | 'agentName' | 'city' | 'productType';

interface ManualTemplateDef {
  key: string;
  name: string;
  languageCode: string;
  bodyParamKeys?: TemplateParamKey[];
  headerImageUrl?: string | null;
  headerMediaId?: string | null;
  requiresHeaderMedia?: boolean;
}

export function isMetaWindowClosedError(params: { code?: number; message?: string }): boolean {
  const code = params.code;
  const msg = (params.message || '').toLowerCase();
  if (code === 131047) return true;
  if (msg.includes('24 hours') || msg.includes('outside the customer care window') || msg.includes('template')) {
    return true;
  }
  return false;
}

export function resolveManualTemplate(templateKey: string): ManualTemplateDef | null {
  const catalogTemplate = getWhatsAppTemplateByKey(templateKey);
  if (!catalogTemplate) return null;
  return {
    key: catalogTemplate.key,
    name: catalogTemplate.name,
    languageCode: catalogTemplate.languageCode,
    bodyParamKeys: [],
    headerImageUrl: catalogTemplate.headerImageUrl ?? null,
    headerMediaId: catalogTemplate.headerMediaId ?? null,
    requiresHeaderMedia: catalogTemplate.requiresHeaderMedia ?? false,
  };
}

export async function uploadWhatsAppMedia(params: {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}): Promise<{
  success: boolean;
  mediaId?: string;
  error?: string;
  httpStatus?: number;
  metaErrorCode?: number;
  metaErrorType?: string;
}> {
  const config = await getCfg();
  if (!config) return { success: false, error: 'IntegraÃ§Ã£o WhatsApp nÃ£o configurada no banco.' };
  const url = `${META_GRAPH_BASE}/${config.apiVersion}/${config.whatsappPhoneNumberId}/media`;
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', params.mimeType);
  form.append('file', new Blob([Uint8Array.from(params.buffer)], { type: params.mimeType }), params.filename);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.metaAccessToken}` },
      body: form,
    });
    const payload = (await res.json().catch(() => ({}))) as {
      id?: string;
      error?: { message?: string; code?: number; type?: string };
    };
    if (!res.ok) {
      return {
        success: false,
        error: payload.error?.message ?? `HTTP ${res.status}`,
        httpStatus: res.status,
        metaErrorCode: payload.error?.code,
        metaErrorType: payload.error?.type,
      };
    }
    if (!payload.id) return { success: false, error: 'Meta nÃ£o retornou media_id.', httpStatus: res.status };
    return { success: true, mediaId: payload.id };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Erro no upload para Meta.' };
  }
}

export interface TemplateParamsContext {
  customerName?: string | null;
  enterpriseName?: string | null;
  agentName?: string | null;
  city?: string | null;
  productType?: string | null;
  parameters?: string[];
}

export function buildTemplateParams(
  template: ManualTemplateDef,
  ctx?: TemplateParamsContext
): Array<{ type: 'text'; text: string }> {
  if (ctx?.parameters && ctx.parameters.length > 0) {
    return ctx.parameters.map((value) => ({ type: 'text', text: String(value ?? '') }));
  }
  const map: Record<TemplateParamKey, string> = {
    customerName: (ctx?.customerName || '').trim() || 'cliente',
    enterpriseName: (ctx?.enterpriseName || '').trim() || 'nosso empreendimento',
    agentName: (ctx?.agentName || '').trim() || 'Ana',
    city: (ctx?.city || '').trim() || 'sua cidade',
    productType: (ctx?.productType || '').trim() || 'imÃ³vel',
  };
  return (template.bodyParamKeys ?? []).map((k) => ({ type: 'text', text: map[k] }));
}

export async function sendTextMessage(to: string, text: string): Promise<SendTextResult> {
  const devDisableWhatsAppSend =
    String(process.env.ANA_DEV_DISABLE_WHATSAPP_SEND || '').trim().toLowerCase() === 'true';

  if (devDisableWhatsAppSend) {
    const normalizedTo = to.replace(/\D/g, '');
    const fakeMetaMessageId = `dev-local-wa-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    console.log('[ANA_DEV_DISABLE_WHATSAPP_SEND] sendTextMessage bypass', {
      success: true,
      fakeMetaMessageId,
      toTail: normalizedTo.slice(-6),
      textPreview: text.slice(0, 180),
    });

    console.log('[ANA_PIPELINE] meta_text_send_outcome', {
      success: true,
      outboundMetaMessageId: fakeMetaMessageId,
      toTail: normalizedTo.slice(-6),
      devBypass: true,
    });

    return { success: true, metaMessageId: fakeMetaMessageId };
  }
  const config = await getCfg();
  if (!config) {
    const c = await getWhatsAppConfig();
    const detail = !c
      ? 'Nenhuma config no banco'
      : `token=${c.metaAccessToken ? 'sim' : 'NÃƒO'}, phoneId=${c.whatsappPhoneNumberId ? 'sim' : 'NÃƒO'}`;
    console.error('[WhatsAppMeta] sendTextMessage: config invÃ¡lida â€”', detail);
    console.log('[ANA_PIPELINE] meta_text_send_outcome', { success: false, reason: 'whatsapp_config_invalid', detail });
    if (!c) return { success: false, error: 'IntegraÃ§Ã£o WhatsApp nÃ£o configurada no banco.' };
    return { success: false, error: `Token ou Phone Number ID ausente (${detail}).` };
  }
  const normalizedTo = to.replace(/\D/g, '');
  if (!normalizedTo) {
    console.log('[ANA_PIPELINE] meta_text_send_outcome', { success: false, reason: 'invalid_to_number' });
    return { success: false, error: 'NÃºmero invÃ¡lido.' };
  }
  const url = `${META_GRAPH_BASE}/${config.apiVersion}/${config.whatsappPhoneNumberId}/messages`;
  const requestBody = {
    messaging_product: 'whatsapp',
    to: normalizedTo,
    type: 'text',
    text: { body: text },
  };
  console.log('[MANUAL_SEND_META] endpoint da Meta', {
    endpoint: url,
    apiVersion: config.apiVersion,
    phoneNumberId: config.whatsappPhoneNumberId,
    to: normalizedTo,
  });
  console.log('[MANUAL_SEND_META] payload enviado', requestBody);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.metaAccessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = (await res.json()) as MetaSendMessageResponse | MetaErrorResponse;
    console.log('[MANUAL_SEND_META] resposta bruta da Meta', {
      httpStatus: res.status,
      body: data,
    });
    if (!res.ok) {
      const err = (data as MetaErrorResponse).error;
      console.error('[MANUAL_SEND_ERROR] erro bruto da Meta', {
        httpStatus: res.status,
        error: err ?? data,
      });
      console.log('[ANA_PIPELINE] meta_text_send_outcome', {
        success: false,
        httpStatus: res.status,
        code: err?.code,
        windowClosed: isMetaWindowClosedError({ code: err?.code, message: err?.message }),
        toTail: normalizedTo.slice(-6),
      });
      return { success: false, error: err?.message ?? `HTTP ${res.status}`, code: err?.code };
    }
    const mid = (data as MetaSendMessageResponse).messages?.[0]?.id;
    if (!mid || typeof mid !== 'string') {
      console.error('[MANUAL_SEND_ERROR] erro bruto da Meta', {
        httpStatus: res.status,
        error: 'Resposta sem messages[0].id',
        body: data,
      });
      console.log('[ANA_PIPELINE] meta_text_send_outcome', {
        success: false,
        httpStatus: res.status,
        reason: 'no_messages_id_in_response',
        toTail: normalizedTo.slice(-6),
      });
      return { success: false, error: 'Meta nÃ£o retornou o ID da mensagem.' };
    }
    console.log('[ANA_PIPELINE] meta_text_send_outcome', {
      success: true,
      outboundMetaMessageId: mid,
      toTail: normalizedTo.slice(-6),
    });
    return { success: true, metaMessageId: mid };
  } catch (e) {
    clearTimeout(timeout);
    console.error('[MANUAL_SEND_ERROR] erro bruto da Meta', e);
    console.log('[ANA_PIPELINE] meta_text_send_outcome', {
      success: false,
      reason: 'fetch_exception',
      toTail: normalizedTo.slice(-6),
    });
    return { success: false, error: e instanceof Error ? e.message : 'Erro ao enviar' };
  }
}

export async function sendTemplateMessage(
  to: string,
  templateKey: string,
  ctx?: TemplateParamsContext
): Promise<SendTextResult> {
  const config = await getCfg();
  if (!config) return { success: false, error: 'IntegraÃ§Ã£o WhatsApp nÃ£o configurada no banco.' };
  const normalizedTo = to.replace(/\D/g, '');
  if (!normalizedTo) return { success: false, error: 'NÃºmero invÃ¡lido.' };
  const template = resolveManualTemplate(templateKey);
  if (!template) return { success: false, error: 'Template invÃ¡lido.' };

  const url = `${META_GRAPH_BASE}/${config.apiVersion}/${config.whatsappPhoneNumberId}/messages`;
  const bodyParams = buildTemplateParams(template, ctx);
  // Nome na Meta = `key` do catÃ¡logo (snake_case); o campo `name` legÃ­vel do catÃ¡logo nÃ£o Ã© o ID do template.
  const components: Array<Record<string, unknown>> = [];
  const persisted = await getMediaSetting(template.key, template.languageCode);
  const headerMediaId = (persisted?.headerMediaId ?? template.headerMediaId ?? '').trim();
  const headerImageUrl = (persisted?.headerImageUrl ?? template.headerImageUrl ?? '').trim();

  if (template.requiresHeaderMedia) {
    if (headerMediaId) {
      components.push({
        type: 'header',
        parameters: [
          {
            type: 'image',
            image: { id: headerMediaId },
          },
        ],
      });
    } else if (headerImageUrl) {
      components.push({
        type: 'header',
        parameters: [
          {
            type: 'image',
            image: { link: headerImageUrl },
          },
        ],
      });
    } else {
      return {
        success: false,
        error: 'Este template exige imagem de cabeÃ§alho. Anexe uma imagem antes de enviar.',
      };
    }
  } else if (headerMediaId) {
    components.push({
      type: 'header',
      parameters: [
        {
          type: 'image',
          image: { id: headerMediaId },
        },
      ],
    });
  } else if (headerImageUrl) {
    components.push({
      type: 'header',
      parameters: [
        {
          type: 'image',
          image: { link: headerImageUrl },
        },
      ],
    });
  }

  if (bodyParams.length > 0) {
    components.push({
      type: 'body',
      parameters: bodyParams,
    });
  }

  const requestBody = {
    messaging_product: 'whatsapp',
    to: normalizedTo,
    type: 'template',
    template: {
      name: template.key,
      language: { code: template.languageCode },
      ...(components.length > 0 ? { components } : {}),
    },
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
      body: JSON.stringify(requestBody),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    const data = (await res.json()) as MetaSendMessageResponse | MetaErrorResponse;
    if (!res.ok) {
      const err = (data as MetaErrorResponse).error;
      return {
        success: false,
        error: err?.message ?? `HTTP ${res.status}`,
        code: err?.code,
        httpStatus: res.status,
        metaErrorCode: err?.code,
        metaErrorType: err?.type,
        metaErrorSubcode: err?.error_subcode,
        metaFbTraceId: err?.fbtrace_id,
      };
    }
    const mid = (data as MetaSendMessageResponse).messages?.[0]?.id;
    if (!mid || typeof mid !== 'string') return { success: false, error: 'Meta nÃ£o retornou o ID da mensagem.' };
    return { success: true, metaMessageId: mid };
  } catch (e) {
    clearTimeout(timeout);
    return { success: false, error: e instanceof Error ? e.message : 'Erro ao enviar template' };
  }
}

/** Contexto opcional para logs de diagnÃ³stico (envio book/material). */
export interface DocumentSendLogContext {
  enterpriseId: number;
  enterpriseName: string;
  conversationId: number;
  fileCategory: string;
  enterpriseFileId: number;
  relativeStoragePath: string;
  absolutePath: string;
}

/** Imagem, vÃ­deo (MP4/3GP) ou documento â€” alinhado a `manualWhatsappAttachment`. */
export function classifyOutboundWhatsAppMedia(filename: string, mimeFromDb: string): 'image' | 'video' | 'document' {
  const k = classifyManualMediaKind(filename, mimeFromDb);
  if (k) return k;
  return 'document';
}

function resolveImageMimeType(filename: string, mimeFromDb: string): string {
  const name = (filename || '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const m = (mimeFromDb || '').trim().toLowerCase();
  if (m === 'image/jpg' || m === 'image/jpeg' || ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (m === 'image/png' || ext === 'png') return 'image/png';
  if (m === 'image/webp' || ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}

/** MIME suportado pela Cloud API para documentos (evita application/octet-stream genÃ©rico). */
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

/** Envia documento: upload multipart para /media (com `type` obrigatÃ³rio na API Meta) e depois mensagem type=document com media id. */
export async function sendDocumentMessage(
  to: string,
  filePath: string,
  filename: string,
  mimeFromDb: string,
  logCtx?: DocumentSendLogContext,
  caption?: string | null
): Promise<SendTextResult> {
  let mediaId: string | undefined;
  let metaMessageId: string | undefined;
  let errorMessageIfAny: string | undefined;
  let resultCode: number | undefined;

  try {
    const config = await getCfg();
    if (!config) {
      errorMessageIfAny = 'WhatsApp nÃ£o configurado.';
      return { success: false, error: errorMessageIfAny };
    }
    const normalizedTo = to.replace(/\D/g, '');
    if (!normalizedTo) {
      errorMessageIfAny = 'NÃºmero invÃ¡lido.';
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
      console.log('[WhatsAppMeta][document] prÃ©-envio', {
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
      errorMessageIfAny = 'FormData indisponÃ­vel no runtime.';
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
        `[upload parse] Resposta nÃ£o Ã© JSON. HTTP ${up.status}. Corpo (inÃ­cio): ${upRaw.slice(0, 2000)}`
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
        `[upload sem media id] A Meta nÃ£o retornou o campo "id" obrigatÃ³rio apÃ³s upload. HTTP ${up.status}. Corpo: ${upRaw.slice(0, 4000)}`
      );
    }
    mediaId = uploadedId;

    const cap = (caption ?? '').trim().slice(0, 1024);
    const messageBody: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: normalizedTo,
      type: 'document',
      document:
        cap.length > 0
          ? { id: mediaId, filename: safeFilename, caption: cap }
          : { id: mediaId, filename: safeFilename },
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
        `[messages parse] Resposta nÃ£o Ã© JSON. HTTP ${res.status}. Corpo (inÃ­cio): ${resRaw.slice(0, 2000)}`
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
        `[messages sem message id] A Meta nÃ£o retornou messages[0].id. HTTP ${res.status}. Corpo: ${resRaw.slice(0, 4000)}`
      );
    }
    metaMessageId = mid;
    return { success: true, metaMessageId: mid, whatsappMediaId: mediaId, messageKind: 'document' };
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

/** Imagem: upload + mensagem type=image (JPEG, PNG, WebP). */
function resolveVideoMimeType(filename: string, mimeFromDb: string): string {
  const name = (filename || '').toLowerCase();
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1) : '';
  const m = (mimeFromDb || '').trim().toLowerCase();
  if (m === 'video/3gpp' || ext === '3gp') return 'video/3gpp';
  return 'video/mp4';
}

/** VÃ­deo: upload + mensagem type=video (MP4/3GP). */
export async function sendVideoMessage(
  to: string,
  filePath: string,
  filename: string,
  mimeFromDb: string,
  logCtx?: DocumentSendLogContext,
  caption?: string | null
): Promise<SendTextResult> {
  let mediaId: string | undefined;
  let metaMessageId: string | undefined;
  let errorMessageIfAny: string | undefined;
  let resultCode: number | undefined;

  try {
    const config = await getCfg();
    if (!config) {
      errorMessageIfAny = 'WhatsApp nÃ£o configurado.';
      return { success: false, error: errorMessageIfAny };
    }
    const normalizedTo = to.replace(/\D/g, '');
    if (!normalizedTo) {
      errorMessageIfAny = 'NÃºmero invÃ¡lido.';
      return { success: false, error: errorMessageIfAny };
    }
    const token = config.metaAccessToken;
    const phoneId = config.whatsappPhoneNumberId;
    const v = config.apiVersion;
    const effectiveMediaUrl = `${META_GRAPH_BASE}/${v}/${phoneId}/media`;
    const msgUrl = `${META_GRAPH_BASE}/${v}/${phoneId}/messages`;
    const safeFilename = (filename || 'video.mp4').replace(/[\r\n\u0000]/g, '_').slice(0, 240);
    const mimeType = resolveVideoMimeType(safeFilename, mimeFromDb);

    const FormDataCtor = (globalThis as unknown as { FormData?: new () => FormData }).FormData;
    if (!FormDataCtor) {
      errorMessageIfAny = 'FormData indisponÃ­vel no runtime.';
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

    let upData: { id?: string; error?: { message?: string; code?: number } };
    try {
      upData = JSON.parse(upRaw) as typeof upData;
    } catch {
      throw new Error(
        `[upload parse] Resposta nÃ£o Ã© JSON. HTTP ${up.status}. Corpo (inÃ­cio): ${upRaw.slice(0, 2000)}`
      );
    }

    if (!up.ok) {
      const err = upData.error;
      throw new Error(`[upload Meta API] ${JSON.stringify({ httpStatus: up.status, error: err ?? upData, rawBody: upRaw.slice(0, 8000) })}`);
    }

    const uploadedId = upData.id;
    if (!uploadedId || typeof uploadedId !== 'string') {
      throw new Error(`[upload sem media id] Corpo: ${upRaw.slice(0, 4000)}`);
    }
    mediaId = uploadedId;

    const cap = (caption ?? '').trim().slice(0, 1024);
    const messageBody: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: normalizedTo,
      type: 'video',
      video: cap.length > 0 ? { id: mediaId, caption: cap } : { id: mediaId },
    };

    const sendController = new AbortController();
    const sendTimeout = setTimeout(() => sendController.abort(), 120000);
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
      throw new Error(`[messages parse] HTTP ${res.status}. Corpo: ${resRaw.slice(0, 2000)}`);
    }

    if (!res.ok) {
      const err = (data as MetaErrorResponse).error;
      throw new Error(
        `[messages Meta API] ${JSON.stringify({ httpStatus: res.status, error: err ?? data, rawBody: resRaw.slice(0, 8000) })}`
      );
    }

    const mid = (data as MetaSendMessageResponse).messages?.[0]?.id;
    if (!mid || typeof mid !== 'string') {
      throw new Error(`[messages sem message id] Corpo: ${resRaw.slice(0, 4000)}`);
    }
    metaMessageId = mid;
    return { success: true, metaMessageId: mid, whatsappMediaId: mediaId, messageKind: 'video' };
  } catch (e) {
    const errObj = e instanceof Error ? e : new Error(String(e));
    errorMessageIfAny = errorMessageIfAny ?? errObj.message;
    console.error('[WhatsAppMeta][video] erro', { message: errObj.message });
    return {
      success: false,
      error: errorMessageIfAny,
      code: resultCode,
    };
  } finally {
    logWhatsappDocumentResult({ mediaId, metaMessageId, errorMessageIfAny });
  }
}

export async function sendImageMessage(
  to: string,
  filePath: string,
  filename: string,
  mimeFromDb: string,
  logCtx?: DocumentSendLogContext,
  caption?: string | null
): Promise<SendTextResult> {
  let mediaId: string | undefined;
  let metaMessageId: string | undefined;
  let errorMessageIfAny: string | undefined;
  let resultCode: number | undefined;

  try {
    const config = await getCfg();
    if (!config) {
      errorMessageIfAny = 'WhatsApp nÃ£o configurado.';
      return { success: false, error: errorMessageIfAny };
    }
    const normalizedTo = to.replace(/\D/g, '');
    if (!normalizedTo) {
      errorMessageIfAny = 'NÃºmero invÃ¡lido.';
      return { success: false, error: errorMessageIfAny };
    }
    const token = config.metaAccessToken;
    const phoneId = config.whatsappPhoneNumberId;
    const v = config.apiVersion;
    const effectiveMediaUrl = `${META_GRAPH_BASE}/${v}/${phoneId}/media`;
    const msgUrl = `${META_GRAPH_BASE}/${v}/${phoneId}/messages`;
    const safeFilename = (filename || 'imagem.jpg').replace(/[\r\n\u0000]/g, '_').slice(0, 240);
    const mimeType = resolveImageMimeType(safeFilename, mimeFromDb);

    const FormDataCtor = (globalThis as unknown as { FormData?: new () => FormData }).FormData;
    if (!FormDataCtor) {
      errorMessageIfAny = 'FormData indisponÃ­vel no runtime.';
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

    let upData: { id?: string; error?: { message?: string; code?: number } };
    try {
      upData = JSON.parse(upRaw) as typeof upData;
    } catch {
      throw new Error(
        `[upload parse] Resposta nÃ£o Ã© JSON. HTTP ${up.status}. Corpo (inÃ­cio): ${upRaw.slice(0, 2000)}`
      );
    }

    if (!up.ok) {
      const err = upData.error;
      throw new Error(`[upload Meta API] ${JSON.stringify({ httpStatus: up.status, error: err ?? upData, rawBody: upRaw.slice(0, 8000) })}`);
    }

    const uploadedId = upData.id;
    if (!uploadedId || typeof uploadedId !== 'string') {
      throw new Error(`[upload sem media id] Corpo: ${upRaw.slice(0, 4000)}`);
    }
    mediaId = uploadedId;

    const cap = (caption ?? '').trim().slice(0, 1024);
    const messageBody: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: normalizedTo,
      type: 'image',
      image: cap.length > 0 ? { id: mediaId, caption: cap } : { id: mediaId },
    };

    if (logCtx) {
      console.log('[WhatsAppMeta][image] enviando', {
        conversation_id: logCtx.conversationId,
        mimeType,
        to_suffix: normalizedTo.slice(-4),
      });
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
      throw new Error(`[messages parse] HTTP ${res.status}. Corpo: ${resRaw.slice(0, 2000)}`);
    }

    if (!res.ok) {
      const err = (data as MetaErrorResponse).error;
      throw new Error(
        `[messages Meta API] ${JSON.stringify({ httpStatus: res.status, error: err ?? data, rawBody: resRaw.slice(0, 8000) })}`
      );
    }

    const mid = (data as MetaSendMessageResponse).messages?.[0]?.id;
    if (!mid || typeof mid !== 'string') {
      throw new Error(`[messages sem message id] Corpo: ${resRaw.slice(0, 4000)}`);
    }
    metaMessageId = mid;
    return { success: true, metaMessageId: mid, whatsappMediaId: mediaId, messageKind: 'image' };
  } catch (e) {
    const errObj = e instanceof Error ? e : new Error(String(e));
    errorMessageIfAny = errorMessageIfAny ?? errObj.message;
    console.error('[WhatsAppMeta][image] erro', { message: errObj.message });
    return {
      success: false,
      error: errorMessageIfAny,
      code: resultCode,
    };
  } finally {
    logWhatsappDocumentResult({ mediaId, metaMessageId, errorMessageIfAny });
  }
}

/** Envia arquivo local: image, video ou document conforme MIME/extensÃ£o. */
export async function sendLocalMediaToWhatsApp(
  to: string,
  filePath: string,
  filename: string,
  mimeFromDb: string,
  options?: { logCtx?: DocumentSendLogContext; caption?: string | null }
): Promise<SendTextResult> {
  const kind = classifyOutboundWhatsAppMedia(filename, mimeFromDb);
  if (kind === 'image') {
    return sendImageMessage(to, filePath, filename, mimeFromDb, options?.logCtx, options?.caption ?? null);
  }
  if (kind === 'video') {
    return sendVideoMessage(to, filePath, filename, mimeFromDb, options?.logCtx, options?.caption ?? null);
  }
  return sendDocumentMessage(to, filePath, filename, mimeFromDb, options?.logCtx, options?.caption ?? null);
}

export async function testConnection(): Promise<{ success: boolean; error?: string; detail?: string }> {
  const config = await getWhatsAppConfig();
  if (!config?.enabled) return { success: false, error: 'IntegraÃ§Ã£o nÃ£o estÃ¡ ativa.' };
  if (!config.metaAccessToken?.trim()) return { success: false, error: 'Token nÃ£o configurado.' };
  if (!config.whatsappPhoneNumberId?.trim()) return { success: false, error: 'Phone Number ID nÃ£o configurado.' };
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
    return { success: false, error: 'Erro de conexÃ£o.', detail: e instanceof Error ? e.message : String(e) };
  }
}

