export interface ClassificationResult {
  knowledge_block: 'facts' | 'commercial_intent' | 'variable_data' | 'ana_rules';
  block_priority: number;
  city_hint?: string | null;
  enterprise_hint?: string | null;
  intent_tags: string[];
  temporal_status: 'atemporal' | 'current' | 'time_sensitive' | 'expired';
  source_confidence: number;
}

export type KnowledgeBlock = ClassificationResult['knowledge_block'];
export type TemporalStatus = ClassificationResult['temporal_status'];

const COMMERCIAL_KEYWORDS = [
  'preço', 'valor', 'valor de', 'custo', 'investimento', 'financiamento',
  'entrada', 'parcela', 'condições', 'pagamento', 'desconto', 'promocional',
  'oferta', 'venda', 'comprar', 'adquirir', 'negociar', 'comercial',
  'vendedor', 'corretor', 'brokers', 'comissão', 'tabela', 'preços',
];

const VARIABLE_KEYWORDS = [
  'atualizado em', 'data de', 'em', 'ano de', 'mês de', 'dia',
  'disponível', 'estoque', 'unidades', 'lotes', 'apartamentos',
  'casas', 'salas', 'dormitórios', 'suítes', 'vagas', 'área',
];

const ANA_RULES_KEYWORDS = [
  'ana deve', 'ana não deve', 'ana pode', 'ana precisa', 'ana deve informar',
  'ana deve perguntar', 'ana deve responder', 'regra para ana', 'instrução',
  'orientação', 'protocolo', 'procedimento', 'fluxo', 'atendimento',
];

const TIME_SENSITIVE_KEYWORDS = [
  'oferta válida até', 'promocional até', 'desconto por tempo limitado',
  'lançamento', 'breve', 'em breve', 'em construção', 'obra em andamento',
  'entrega', 'previsão', 'previsão de entrega', 'prazo', 'validade',
];

const CITY_PATTERNS = [
  /\b(são paulo|sp|s\.p\.|são paulo\/sp)\b/i,
  /\b(rio de janeiro|rj|r\.j\.|rio\/rj)\b/i,
  /\b(belo horizonte|bh|b\.h\.|belo horizonte\/mg)\b/i,
  /\b(brasília|df|d\.f\.|brasília\/df)\b/i,
  /\b(salvador|ba|salvador\/ba)\b/i,
  /\b(fortaleza|ce|fortaleza\/ce)\b/i,
  /\b(belém|pa|belém\/pa)\b/i,
  /\b(curitiba|pr|curitiba\/pr)\b/i,
  /\b(porto alegre|rs|porto alegre\/rs)\b/i,
  /\b(recife|pe|recife\/pe)\b/i,
];

const ENTERPRISE_PATTERNS = [
  /\b([A-Z][a-z]+ (Residencial|Park|Garden|Village|Square|Center|Plaza|Tower|Building))\b/g,
  /\b(Condomínio (Residencial|Park|Garden|Village|Square|Center|Plaza))\b/g,
  /\b(Empreendimento (Residencial|Park|Garden|Village|Square|Center|Plaza))\b/g,
];

function extractCityHint(text: string): string | null {
  for (const pattern of CITY_PATTERNS) {
    const match = text.match(pattern);
    if (match) return match[0];
  }
  return null;
}

function extractEnterpriseHint(text: string): string | null {
  const matches = [];
  for (const pattern of ENTERPRISE_PATTERNS) {
    const found = text.match(pattern);
    if (found) matches.push(...found);
  }
  return matches.length > 0 ? matches[0] : null;
}

function extractIntentTags(text: string): string[] {
  const tags: string[] = [];
  const lower = text.toLowerCase();
  
  if (COMMERCIAL_KEYWORDS.some(kw => lower.includes(kw))) {
    tags.push('preço', 'comercial');
  }
  if (VARIABLE_KEYWORDS.some(kw => lower.includes(kw))) {
    tags.push('disponibilidade', 'estoque');
  }
  if (TIME_SENSITIVE_KEYWORDS.some(kw => lower.includes(kw))) {
    tags.push('urgente', 'promocional');
  }
  
  if (/\b\d+\s*(apartamentos|casas|lotes|unidades|salas|suítes|dormitórios|vagas)\b/i.test(text)) {
    tags.push('quantidade');
  }
  if (/\bR\$\s*\d+/i.test(text) || /\b\d+\s*(reais|r\$|mil|milhões)/i.test(text)) {
    tags.push('valor');
  }
  if (/\b\d+\s*(m²|m2|metros|metros quadrados)\b/i.test(text)) {
    tags.push('área');
  }
  
  return [...new Set(tags)];
}

export function classifyKnowledgeChunk(
  content: string,
  fileNameOrContext?: string | { enterpriseName?: string | null; enterpriseCity?: string | null }
): ClassificationResult {
  const fileName = typeof fileNameOrContext === 'string' ? fileNameOrContext : undefined;
  const text = content.toLowerCase();
  let knowledge_block: ClassificationResult['knowledge_block'] = 'facts';
  let block_priority = 50;
  let temporal_status: ClassificationResult['temporal_status'] = 'atemporal';
  
  const hasCommercial = COMMERCIAL_KEYWORDS.some(kw => text.includes(kw));
  const hasVariable = VARIABLE_KEYWORDS.some(kw => text.includes(kw));
  const hasAnaRules = ANA_RULES_KEYWORDS.some(kw => text.includes(kw));
  const hasTimeSensitive = TIME_SENSITIVE_KEYWORDS.some(kw => text.includes(kw));
  
  if (hasAnaRules) {
    knowledge_block = 'ana_rules';
    block_priority = 90;
  } else if (hasCommercial) {
    knowledge_block = 'commercial_intent';
    block_priority = 80;
  } else if (hasVariable) {
    knowledge_block = 'variable_data';
    block_priority = 60;
  }
  
  if (hasTimeSensitive) {
    temporal_status = 'time_sensitive';
  } else if (hasVariable) {
    temporal_status = 'current';
  }
  
  const cityHint = extractCityHint(content);
  const enterpriseHint = extractEnterpriseHint(content);
  const intentTags = extractIntentTags(content);
  
  let source_confidence = 50;
  if (fileName && (fileName.includes('.pdf') || fileName.includes('.doc'))) {
    source_confidence = 70;
  } else if (fileName && fileName.includes('.txt')) {
    source_confidence = 60;
  }
  
  return {
    knowledge_block,
    block_priority,
    city_hint: cityHint,
    enterprise_hint: enterpriseHint,
    intent_tags: intentTags,
    temporal_status,
    source_confidence,
  };
}
