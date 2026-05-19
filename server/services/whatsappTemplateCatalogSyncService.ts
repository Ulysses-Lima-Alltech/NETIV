import { config } from '../config.js';
import {
  WHATSAPP_TEMPLATES_CATALOG,
  setRuntimeWhatsAppTemplatesCatalog,
  type WhatsAppTemplateCatalogItem,
  type WhatsAppTemplateVariableDef,
} from '../catalogs/whatsappTemplates.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';

const META_GRAPH_BASE = 'https://graph.facebook.com';
const CACHE_TTL_MS = 5 * 60 * 1000;

type MetaTemplateComponent = {
  type?: string;
  format?: string;
  text?: string;
};

export type MetaTemplateItem = {
  id?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
  created_time?: string;
  updated_time?: string;
  components?: MetaTemplateComponent[];
};

export type MetaTemplateCreateInput = {
  name: string;
  category: 'MARKETING' | 'UTILITY' | 'AUTHENTICATION';
  language: string;
  body: string;
  headerText?: string;
  footerText?: string;
};

type CacheEntry = {
  templates: WhatsAppTemplateCatalogItem[];
  cachedAt: number;
};

let cacheEntry: CacheEntry | null = null;

export class MetaTemplateDeleteError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'MetaTemplateDeleteError';
    this.statusCode = statusCode;
  }
}

async function getMetaCredentialsOrThrow(): Promise<{ token: string; apiVersion: string; wabaId: string }> {
  const integrationConfig = await getWhatsAppConfig();
  const token = integrationConfig?.metaAccessToken?.trim() || config.meta.whatsappToken?.trim();
  const apiVersion = integrationConfig?.apiVersion?.trim() || config.meta.apiVersion || config.metaApiVersion;
  const wabaId = integrationConfig?.whatsappBusinessAccountId?.trim();
  if (!token) throw new Error('Meta token not configured.');
  if (!wabaId) throw new Error('WABA ID not configured in integration_settings.');
  return { token, apiVersion, wabaId };
}

function toFriendlyName(templateName: string): string {
  return templateName
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function extractBodyVariableIds(text: string | undefined): number[] {
  if (!text) return [];
  const ids = new Set<number>();
  const matches = text.matchAll(/\{\{\s*(\d+)\s*\}\}/g);
  for (const match of matches) {
    const n = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(n) && n > 0) ids.add(n);
  }
  return Array.from(ids).sort((a, b) => a - b);
}

function buildVariablesFromBody(components: MetaTemplateComponent[]): WhatsAppTemplateVariableDef[] {
  const body = components.find((component) => String(component.type ?? '').toUpperCase() === 'BODY');
  const ids = extractBodyVariableIds(body?.text);
  return ids.map((id) => ({ id, label: `Variavel ${id}`, required: true }));
}

function mapMetaTemplateToCatalogItem(template: MetaTemplateItem): WhatsAppTemplateCatalogItem | null {
  const key = String(template.name ?? '').trim();
  if (!key) return null;
  const status = String(template.status ?? 'UNKNOWN').toUpperCase() || 'UNKNOWN';
  const components = Array.isArray(template.components) ? template.components : [];
  const header = components.find((component) => String(component.type ?? '').toUpperCase() === 'HEADER');
  const headerFormat = String(header?.format ?? '').toUpperCase();
  const hasHeaderImage = headerFormat === 'IMAGE';
  const hasHeaderVideo = headerFormat === 'VIDEO';
  const hasHeaderDocument = headerFormat === 'DOCUMENT';
  const hasButtons = components.some((component) => String(component.type ?? '').toUpperCase() === 'BUTTONS');
  const variables = buildVariablesFromBody(components);
  return {
    key,
    name: toFriendlyName(key),
    languageCode: String(template.language ?? 'pt_BR'),
    metaTemplateName: key,
    metaTemplateId: String(template.id ?? ''),
    category: String(template.category ?? '').toUpperCase() || undefined,
    status,
    source: 'meta',
    components: components as Array<Record<string, unknown>>,
    createdAt: template.created_time ?? null,
    updatedAt: template.updated_time ?? null,
    hasHeaderImage,
    hasHeaderVideo,
    hasHeaderDocument,
    hasBodyVariables: variables.length > 0,
    bodyVariableCount: variables.length,
    hasButtons,
    requiresHeaderMedia: hasHeaderImage || hasHeaderVideo || hasHeaderDocument,
    variables,
  };
}

export async function listMetaTemplatesRaw(): Promise<MetaTemplateItem[]> {
  const { token, apiVersion, wabaId } = await getMetaCredentialsOrThrow();
  const fields = 'name,language,status,category,components,id,created_time,updated_time';
  const firstParams = new URLSearchParams({ fields, limit: '100' });
  let nextUrl: string | null = `${META_GRAPH_BASE}/${apiVersion}/${wabaId}/message_templates?${firstParams.toString()}`;
  const collected: MetaTemplateItem[] = [];
  let pageCount = 0;

  while (nextUrl) {
    pageCount++;
    if (pageCount > 30) break;
    const response = await fetch(nextUrl, { headers: { Authorization: `Bearer ${token}` } });
    const payload = (await response.json().catch(() => ({}))) as {
      data?: MetaTemplateItem[];
      paging?: { next?: string };
      error?: { message?: string };
    };
    if (!response.ok) throw new Error(payload.error?.message || `Meta list failed (${response.status}).`);
    collected.push(...(payload.data ?? []));
    nextUrl = payload.paging?.next ?? null;
  }

  return collected;
}

async function fetchMetaTemplatesForBatch(): Promise<WhatsAppTemplateCatalogItem[]> {
  const raw = await listMetaTemplatesRaw();
  return raw
    .map(mapMetaTemplateToCatalogItem)
    .filter((item): item is WhatsAppTemplateCatalogItem => Boolean(item));
}

function mergeWithLocalHeaderMedia(templates: WhatsAppTemplateCatalogItem[]): WhatsAppTemplateCatalogItem[] {
  const localByKey = new Map(WHATSAPP_TEMPLATES_CATALOG.map((item) => [item.key, item]));
  return templates.map((template) => {
    const local = localByKey.get(template.key);
    if (!local?.headerImageUrl) return template;
    return { ...template, headerImageUrl: local.headerImageUrl };
  });
}

export async function createMetaTemplate(input: MetaTemplateCreateInput): Promise<unknown> {
  const { token, apiVersion, wabaId } = await getMetaCredentialsOrThrow();
  const components: Array<Record<string, string>> = [];
  if (input.headerText?.trim()) components.push({ type: 'HEADER', format: 'TEXT', text: input.headerText.trim() });
  components.push({ type: 'BODY', text: input.body.trim() });
  if (input.footerText?.trim()) components.push({ type: 'FOOTER', text: input.footerText.trim() });
  const url = `${META_GRAPH_BASE}/${apiVersion}/${wabaId}/message_templates`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: input.name.trim(),
      category: input.category,
      language: input.language || 'pt_BR',
      components,
    }),
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message || `Meta create failed (${response.status}).`);
  cacheEntry = null;
  return payload;
}

export async function deleteMetaTemplateByName(templateName: string): Promise<unknown> {
  const { token, apiVersion, wabaId } = await getMetaCredentialsOrThrow();
  const params = new URLSearchParams({ name: templateName.trim() });
  const url = `${META_GRAPH_BASE}/${apiVersion}/${wabaId}/message_templates?${params.toString()}`;
  const response = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  const payload = (await response.json().catch(() => ({}))) as {
    error?: { message?: string; code?: number; error_subcode?: number };
  };
  if (!response.ok) {
    const rawMessage = String(payload.error?.message ?? '').toLowerCase();
    const isNotFound =
      response.status === 404 ||
      rawMessage.includes('does not exist') ||
      rawMessage.includes('not found') ||
      rawMessage.includes('unknown template') ||
      rawMessage.includes('invalid parameter');
    if (isNotFound) {
      throw new MetaTemplateDeleteError('Template não encontrado na Meta.', 404);
    }
    throw new MetaTemplateDeleteError('Falha ao excluir template na Meta.', 502);
  }
  cacheEntry = null;
  return payload;
}

export async function listBatchTemplatesFromMetaOrFallback(params?: {
  forceRefresh?: boolean;
}): Promise<{ templates: WhatsAppTemplateCatalogItem[]; fallbackUsed: boolean }> {
  const forceRefresh = params?.forceRefresh === true;
  const now = Date.now();
  if (!forceRefresh && cacheEntry && now - cacheEntry.cachedAt < CACHE_TTL_MS) {
    setRuntimeWhatsAppTemplatesCatalog(cacheEntry.templates);
    return { templates: cacheEntry.templates, fallbackUsed: false };
  }
  try {
    const fromMeta = await fetchMetaTemplatesForBatch();
    const merged = mergeWithLocalHeaderMedia(fromMeta);
    cacheEntry = { templates: merged, cachedAt: now };
    setRuntimeWhatsAppTemplatesCatalog(merged);
    return { templates: merged, fallbackUsed: false };
  } catch {
    const fallback = WHATSAPP_TEMPLATES_CATALOG.map((item) => ({
      ...item,
      source: 'local_fallback' as const,
    }));
    setRuntimeWhatsAppTemplatesCatalog(fallback);
    return { templates: fallback, fallbackUsed: true };
  }
}
