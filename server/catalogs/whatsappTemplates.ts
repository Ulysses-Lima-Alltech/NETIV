export interface WhatsAppTemplateVariableDef {
  id: number;
  label: string;
  required: boolean;
}

export interface WhatsAppTemplateCatalogItem {
  key: string;
  name: string;
  languageCode: 'pt_BR';
  variables: WhatsAppTemplateVariableDef[];
}

export const WHATSAPP_TEMPLATES_CATALOG: WhatsAppTemplateCatalogItem[] = [
  {
    key: 'primeiro_contato_cliente',
    name: 'primeiro_contato_cliente',
    languageCode: 'pt_BR',
    variables: [
      { id: 1, label: 'Nome Cliente', required: true },
      { id: 2, label: 'Nome do Empreendimento', required: true },
    ],
  },
  {
    key: 'novo_agendamento_corretor',
    name: 'novo_agendamento_corretor',
    languageCode: 'pt_BR',
    variables: [
      { id: 1, label: 'Nome Corretor', required: true },
      { id: 2, label: 'Nome do Cliente', required: true },
      { id: 3, label: 'Data e Hora do Agendamento', required: true },
      { id: 4, label: 'Nome do Empreendimento', required: true },
    ],
  },
];

export function listWhatsAppTemplatesCatalog(): WhatsAppTemplateCatalogItem[] {
  return WHATSAPP_TEMPLATES_CATALOG;
}

export function getWhatsAppTemplateByKey(key: string): WhatsAppTemplateCatalogItem | null {
  return WHATSAPP_TEMPLATES_CATALOG.find((item) => item.key === key) ?? null;
}

export function getWhatsAppTemplates(): WhatsAppTemplateCatalogItem[] {
  return WHATSAPP_TEMPLATES_CATALOG;
}
