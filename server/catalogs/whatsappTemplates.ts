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
  languageCode: string;
  metaTemplateName?: string;
  metaTemplateId?: string;
  category?: 'CLIENT' | 'CORRETOR' | 'ADMIN' | 'MARKETING' | 'UTILITY' | 'AUTHENTICATION' | string;
  status?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  source?: 'meta' | 'local_fallback';
  components?: Array<Record<string, unknown>>;
  hasHeaderImage?: boolean;
  hasHeaderVideo?: boolean;
  hasHeaderDocument?: boolean;
  hasBodyVariables?: boolean;
  bodyVariableCount?: number;
  hasButtons?: boolean;
  requiresHeaderMedia?: boolean;
  variables: WhatsAppTemplateVariableDef[];
  headerImageUrl?: string;
  headerMediaId?: string | null;
  headerMediaFilename?: string | null;
  hasConfiguredHeaderMedia?: boolean;

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
    headerImageUrl: process.env.CONVITE_CHURRAS_HOJE_HEADER_IMAGE_URL || 'https://scontent.whatsapp.net/v/t61.29466-34/658434607_1017161593974881_1032872883820725475_n.jpg?ccb=1-7&_nc_sid=8b1bef&_nc_ohc=V-PXbCP_JWMQ7kNvwFh-cJd&_nc_oc=Adry1_1h95TMF9lGzP3tPA1tJmEW6x6Scg8SNq2_vMYpod-x4RYNP8PUUvTFpLeApcyu27zjnPZg0FYpiyGVhBKp&_nc_zt=3&_nc_ht=scontent.whatsapp.net&edm=AH51TzQEAAAA&_nc_gid=v0PhMZnlYkXNzJstA3Qk2w&_nc_tpa=Q5bMBQGU1GmESz7uhdddz_tMDI0JmZLJ88_uGhuW34p9zCm63tsTgzgwTf2hA5oo6NfAkVvdF42cddUQyg&oh=01_Q5Aa4gEURUfRUFOm9c9LcdNbH07tXZgPDgXHdHm2wGkcipMGNw&oe=6A330E88',
  },
  {
    key: 'corretor_atendimento_pendente',
    name: 'Corretor - Atendimento Pendente',
    languageCode: 'pt_BR',
    metaTemplateName: 'corretor_atendimento_pendente',
    category: 'CORRETOR',
    variables: [
      { id: 1, label: 'Nome do corretor', required: true },
      { id: 2, label: 'Nome do cliente ou telefone', required: true },
      { id: 3, label: 'Nome do empreendimento', required: true },
    ],
  },
  {
    key: 'corretor_agendamento_confirmado',
    name: 'Corretor - Agendamento Confirmado',
    languageCode: 'pt_BR',
    metaTemplateName: 'corretor_agendamento_confirmado',
    category: 'CORRETOR',
    variables: [
      { id: 1, label: 'Nome do corretor', required: true },
      { id: 2, label: 'Nome do cliente ou telefone', required: true },
      { id: 3, label: 'Nome do empreendimento', required: true },
      { id: 4, label: 'Data e horario da visita', required: true },
    ],
  },
];

function getEffectiveTemplatesCatalog(): WhatsAppTemplateCatalogItem[] {
  return runtimeTemplatesCatalog ?? WHATSAPP_TEMPLATES_CATALOG;
}

let runtimeTemplatesCatalog: WhatsAppTemplateCatalogItem[] | null = null;

export function listWhatsAppTemplatesCatalog(): WhatsAppTemplateCatalogItem[] {
  return getEffectiveTemplatesCatalog();
}

export function getWhatsAppTemplateByKey(key: string): WhatsAppTemplateCatalogItem | null {
  return getEffectiveTemplatesCatalog().find((item) => item.key === key) ?? null;
}

export function getWhatsAppTemplates(): WhatsAppTemplateCatalogItem[] {
  return getEffectiveTemplatesCatalog();
}

export function setRuntimeWhatsAppTemplatesCatalog(templates: WhatsAppTemplateCatalogItem[] | null): void {
  runtimeTemplatesCatalog = Array.isArray(templates) ? templates : null;
}
