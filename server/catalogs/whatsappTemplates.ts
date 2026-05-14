/**
 * Catálogo local usado pelo disparo em lote.
 *
 * Cada `key` deve ser exatamente o nome do template aprovado no WhatsApp Business.
 * Esse valor é enviado para a Meta.
 *
 * `name` é apenas rótulo para UI; não use como nome do template na API.
 */

export interface WhatsAppTemplateVariableDef {
  id: number;
  label: string;
  required: boolean;
}

export interface WhatsAppTemplateCatalogItem {
  key: string;
  name: string;
  languageCode: 'pt_BR';
  metaTemplateName?: string;
  metaTemplateId?: string;
  category?: 'CLIENT' | 'CORRETOR' | 'ADMIN';
  variables: WhatsAppTemplateVariableDef[];

  /**
   * Opcional: texto do corpo como na Meta, com placeholders {{1}}, {{2}}, etc.,
   * na mesma ordem dos parâmetros do template.
   *
   * Se ausente, o inbox usa um resumo por variável: label + valor.
   */
  messageBodyTemplate?: string;
}

/**
 * Texto a exibir no inbox após substituir {{1}}, {{2}}, etc.,
 * pelos valores enviados à API.
 */
export function renderTemplateTextForInbox(
  template: WhatsAppTemplateCatalogItem,
  parameterValues: string[]
): string {
  const raw = template.messageBodyTemplate?.trim();

  if (raw) {
    let out = raw;

    for (let i = parameterValues.length - 1; i >= 0; i--) {
      const placeholder = `{{${i + 1}}}`;
      out = out.split(placeholder).join(parameterValues[i] ?? '');
    }

    return out;
  }

  return template.variables
    .map((v, idx) => {
      const val = parameterValues[idx] ?? '';
      return `${v.label}: ${val}`;
    })
    .join('\n');
}

/**
 * Catálogo oficial de templates disponíveis no sistema.
 *
 * Inclua abaixo somente templates aprovados na Meta.
 */
export const WHATSAPP_TEMPLATES_CATALOG: WhatsAppTemplateCatalogItem[] = [
  {
    key: 'convite_churras',
    name: 'Convite Churras',
    languageCode: 'pt_BR',
    metaTemplateName: 'convite_churras',
    metaTemplateId: '1017161590641548',
    category: 'CORRETOR',
    variables: [],
  },
  {
    key: 'convite_churras_v2',
    name: 'Convite Churras V2',
    languageCode: 'pt_BR',
    metaTemplateName: 'convite_churras_v2',
    metaTemplateId: '856738874143229',
    category: 'CORRETOR',
    variables: [],
  },
  {
    key: 'convite_churras_hoje_v1',
    name: 'Convite Churras Hoje V1',
    languageCode: 'pt_BR',
    metaTemplateName: 'convite_churras_hoje_v1',
    metaTemplateId: '1017161590641548',
    category: 'CORRETOR',
    variables: [],
  },
];

function getEffectiveTemplatesCatalog(): WhatsAppTemplateCatalogItem[] {
  return WHATSAPP_TEMPLATES_CATALOG;
}

export function listWhatsAppTemplatesCatalog(): WhatsAppTemplateCatalogItem[] {
  return getEffectiveTemplatesCatalog();
}

export function getWhatsAppTemplateByKey(key: string): WhatsAppTemplateCatalogItem | null {
  return getEffectiveTemplatesCatalog().find((item) => item.key === key) ?? null;
}

export function getWhatsAppTemplates(): WhatsAppTemplateCatalogItem[] {
  return getEffectiveTemplatesCatalog();
}

