import type { WhatsAppTemplateCatalogItem } from '../catalogs/whatsappTemplates.js';

export type WhatsAppTemplateHeaderType = 'none' | 'text' | 'image' | 'video' | 'document';

export interface WhatsAppTemplateMediaReference {
  settingId: number | null;
  mediaId: string | null;
  fileName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  storageFolder: string | null;
  /** Indica uso de link configurado sem persistir/expor a URL potencialmente privada. */
  configuredLink: boolean;
}

export interface WhatsAppTemplateButtonSnapshot {
  type: 'url' | 'quick_reply' | 'phone_number' | 'unknown';
  text: string;
  url: string | null;
  payload: string | null;
}

export interface RenderedWhatsAppTemplateMessage {
  messageType: 'template';
  templateName: string;
  templateId: string | null;
  templateLanguage: string;
  category: string | null;
  bodyOriginal: string;
  parameters: Array<{ position: number; value: string }>;
  renderedText: string;
  header: {
    type: WhatsAppTemplateHeaderType;
    text: string | null;
    media: WhatsAppTemplateMediaReference | null;
  };
  buttons: WhatsAppTemplateButtonSnapshot[];
}

type Component = Record<string, unknown>;

function componentType(component: Component): string {
  return String(component.type ?? '').trim().toUpperCase();
}

function replacePositionalPlaceholders(raw: string, values: string[], context: string): string {
  const missing = new Set<number>();
  const rendered = raw.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, rawPosition: string) => {
    const position = Number(rawPosition);
    const value = values[position - 1];
    if (value == null || value === '') {
      missing.add(position);
      return `{{${position}}}`;
    }
    return value;
  });
  if (missing.size > 0) {
    throw new Error(
      `${context}: parâmetro(s) obrigatório(s) ausente(s): ${[...missing].sort((a, b) => a - b).join(', ')}.`
    );
  }
  const unresolved = [...rendered.matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1]));
  if (unresolved.length > 0) {
    throw new Error(`${context}: placeholder(s) não resolvido(s): ${unresolved.join(', ')}.`);
  }
  return rendered;
}

function normalizeHeaderType(component: Component | undefined): WhatsAppTemplateHeaderType {
  if (!component) return 'none';
  const format = String(component.format ?? 'TEXT').trim().toLowerCase();
  if (format === 'image' || format === 'video' || format === 'document' || format === 'text') return format;
  return 'none';
}

function normalizeButtonType(value: unknown): WhatsAppTemplateButtonSnapshot['type'] {
  const type = String(value ?? '').trim().toUpperCase();
  if (type === 'URL') return 'url';
  if (type === 'QUICK_REPLY') return 'quick_reply';
  if (type === 'PHONE_NUMBER') return 'phone_number';
  return 'unknown';
}

export function renderWhatsAppTemplateMessage(params: {
  template: WhatsAppTemplateCatalogItem;
  parameterValues: string[];
  media?: WhatsAppTemplateMediaReference | null;
}): RenderedWhatsAppTemplateMessage {
  const components = Array.isArray(params.template.components)
    ? (params.template.components as Component[])
    : [];
  const bodyComponent = components.find((component) => componentType(component) === 'BODY');
  const bodyOriginal = String(bodyComponent?.text ?? params.template.messageBodyTemplate ?? '').trim();
  if (!bodyOriginal) {
    throw new Error(`Template ${params.template.key}: BODY não disponível; envio bloqueado para não persistir conteúdo inventado.`);
  }

  const parameterValues = params.parameterValues.map((value) => String(value ?? ''));
  const renderedText = replacePositionalPlaceholders(bodyOriginal, parameterValues, `Template ${params.template.key}`);
  const headerComponent = components.find((component) => componentType(component) === 'HEADER');
  const headerType = normalizeHeaderType(headerComponent);
  const headerRawText = headerType === 'text' ? String(headerComponent?.text ?? '').trim() : '';
  const headerText = headerRawText
    ? replacePositionalPlaceholders(headerRawText, parameterValues, `Header do template ${params.template.key}`)
    : null;

  const buttonsComponent = components.find((component) => componentType(component) === 'BUTTONS');
  const rawButtons = Array.isArray(buttonsComponent?.buttons)
    ? (buttonsComponent.buttons as Component[])
    : [];
  const buttons = rawButtons.map((button) => {
    const type = normalizeButtonType(button.type);
    const rawUrl = typeof button.url === 'string' ? button.url : null;
    return {
      type,
      text: String(button.text ?? '').trim(),
      url: rawUrl ? replacePositionalPlaceholders(rawUrl, parameterValues, `Botão do template ${params.template.key}`) : null,
      payload: typeof button.payload === 'string' ? button.payload : type === 'quick_reply' ? String(button.text ?? '') : null,
    };
  });

  if ((headerType === 'image' || headerType === 'video' || headerType === 'document') && !params.media?.mediaId && !params.media?.configuredLink) {
    throw new Error(`Template ${params.template.key}: mídia obrigatória do HEADER não configurada.`);
  }

  return {
    messageType: 'template',
    templateName: params.template.metaTemplateName ?? params.template.key,
    templateId: params.template.metaTemplateId?.trim() || null,
    templateLanguage: params.template.languageCode || 'pt_BR',
    category: params.template.category ? String(params.template.category) : null,
    bodyOriginal,
    parameters: parameterValues.map((value, index) => ({ position: index + 1, value })),
    renderedText,
    header: {
      type: headerType,
      text: headerText,
      media: headerType === 'image' || headerType === 'video' || headerType === 'document'
        ? params.media ?? null
        : null,
    },
    buttons,
  };
}
