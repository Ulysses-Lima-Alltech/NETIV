export function normalizeHeaderForDetection(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function includesAny(normalizedHeader: string, terms: string[]): boolean {
  return terms.some((term) => normalizedHeader.includes(term));
}

export interface BatchColumnSuggestions {
  phoneColumn: string | null;
  customerNameColumn: string | null;
  enterpriseColumn: string | null;
}

export function detectBatchColumns(headers: string[]): BatchColumnSuggestions {
  let phoneColumn: string | null = null;
  let customerNameColumn: string | null = null;
  let enterpriseColumn: string | null = null;

  const phoneTerms = ['telefone', 'celular', 'whatsapp', 'phone', 'numero', 'contato'];
  const customerNameTerms = ['nome', 'cliente', 'lead', 'contato'];
  const enterpriseTerms = ['empreendimento', 'interesse', 'produto', 'imovel'];

  for (const header of headers) {
    const normalized = normalizeHeaderForDetection(header);
    if (!normalized) continue;
    if (!phoneColumn && includesAny(normalized, phoneTerms)) phoneColumn = header;
    if (!customerNameColumn && includesAny(normalized, customerNameTerms)) customerNameColumn = header;
    if (!enterpriseColumn && includesAny(normalized, enterpriseTerms)) enterpriseColumn = header;
  }

  return { phoneColumn, customerNameColumn, enterpriseColumn };
}
