/**
 * Catálogo local usado pelo disparo em lote. Não consulta a Meta em runtime.
 * Cada `key` deve ser exatamente o nome do template aprovado no WhatsApp Business
 * (ex.: primeiro_contato_cliente, novo_agendamento_corretor). Esse valor é o enviado à Meta.
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
   * Opcional: texto do corpo como na Meta, com placeholders {{1}}, {{2}}, … na ordem dos parâmetros.
   * Se ausente, o inbox usa um resumo por variável (label + valor).
   */
  messageBodyTemplate?: string;
}

const CONVITE_MEETING_ECOGARDEN_TEMPLATE: WhatsAppTemplateCatalogItem = {
  key: 'convite_meeting_ecogarden',
  name: 'Convite Meeting Ecogarden',
  languageCode: 'pt_BR',
  metaTemplateName: 'convite_meeting_ecogarden',
  metaTemplateId: '2641199616165451',
  category: 'CORRETOR',
  variables: [],
  messageBodyTemplate: `Fala, corretor(a)! 📈

Quer um produto com baixa resistência de venda e alta valorização para sua carteira? O Ecogarden chegou.

Com apenas pouquíssimas unidades disponíveis nesta fase e obras a super avançadas, este é o loteamento que vai dominar o seu feed nas próximas semanas. Vamos liberar todas as estratégias de vendas e materiais exclusivos no nosso meeting presencial.

🗓 17/04 às 09h
📍 Pousada Villa Verde - Bom Jesus dos Perdões

O credenciamento é limitado para garantirmos a qualidade do encontro. Não fique de fora da oportunidade que vai acelerar suas comissões em 2026!

Acesse o link e gere seu QR Code de acesso:`,
};

/** Texto a exibir no inbox após substituir {{1}}… pelos valores enviados à API. */
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

export const WHATSAPP_TEMPLATES_CATALOG: WhatsAppTemplateCatalogItem[] = [
  {
    key: 'primeiro_contato_cliente',
    name: 'Primeiro Contato Cliente',
    languageCode: 'pt_BR',
    variables: [
      { id: 1, label: 'Nome Cliente', required: true },
      { id: 2, label: 'Nome do Empreendimento', required: true },
    ],
  },
  {
    key: 'novo_agendamento_corretor',
    name: 'Novo Agendamento Corretor',
    languageCode: 'pt_BR',
    variables: [
      { id: 1, label: 'Nome Corretor', required: true },
      { id: 2, label: 'Nome do Cliente', required: true },
      { id: 3, label: 'Data e Hora do Agendamento', required: true },
      { id: 4, label: 'Nome do Empreendimento', required: true },
    ],
  },
  {
    key: 'chamada_feirao',
    name: 'Chamada Feirão',
    languageCode: 'pt_BR',
    variables: [{ id: 1, label: 'Nome Cliente', required: true }],
    messageBodyTemplate:
      'Olá, {{1}}! Tudo bem?\n\n' +
      'Meu nome é Ana. Estive revisando minha base e encontrei seu contato com interesse em alguns imóveis.\n\n' +
      'Me diz uma coisa: você já comprou seu imóvel ou ainda está buscando? Estamos com uma ótima oportunidade de Feirão que pode fazer sentido para você. Se fizer sentido, me responda por aqui que eu sigo com você.',
  },
  CONVITE_MEETING_ECOGARDEN_TEMPLATE,
];

function getEffectiveTemplatesCatalog(): WhatsAppTemplateCatalogItem[] {
  const byKey = new Map<string, WhatsAppTemplateCatalogItem>();
  for (const item of WHATSAPP_TEMPLATES_CATALOG) {
    byKey.set(item.key, item);
  }
  if (!byKey.has(CONVITE_MEETING_ECOGARDEN_TEMPLATE.key)) {
    byKey.set(CONVITE_MEETING_ECOGARDEN_TEMPLATE.key, CONVITE_MEETING_ECOGARDEN_TEMPLATE);
  }
  return Array.from(byKey.values());
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
