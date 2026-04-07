export type KnowledgeBlock = 'facts' | 'commercial_intent' | 'variable_data' | 'ana_rules';

export type TemporalStatus = 'atemporal' | 'current' | 'time_sensitive' | 'expired';

export interface ChunkClassification {
  block: KnowledgeBlock;
  blockPriority: number;
  cityHint: string | null;
  enterpriseHint: string | null;
  intentTags: string[];
  temporalStatus: TemporalStatus;
  sourceConfidence: number;
}

export interface ChunkClassificationContext {
  enterpriseName?: string | null;
  enterpriseCity?: string | null;
}

function normalizeText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(norm: string, terms: readonly string[]): boolean {
  return terms.some((t) => norm.includes(t));
}

function unique(arr: string[]): string[] {
  return [...new Set(arr)];
}

const RULE_TERMS = [
  'nao pode',
  'não pode',
  'proibido',
  'restricao',
  'restrição',
  'handoff',
  'corretor',
  'negociar',
  'nao negociar',
  'não negociar',
  'juros',
  'nao inventar',
  'não inventar',
  'nao prometer',
  'não prometer',
] as const;

const VARIABLE_TERMS = [
  'valor',
  'valores',
  'preco',
  'preços',
  'preco',
  'condicoes',
  'condições',
  'pagamento',
  'disponibilidade',
  'campanha',
  'vigente',
  'validade',
  'horario',
  'horário',
  'plantao',
  'plantão',
] as const;

const COMMERCIAL_INTENT_TERMS = [
  'morar',
  'investir',
  'investimento',
  'valorizacao',
  'valorização',
  'diferencial comercial',
  'argumento',
  'visita',
  'agendamento',
  'book',
  'catalogo',
  'catálogo',
  'material',
] as const;

const FACT_TERMS = [
  'empreendimento',
  'cidade',
  'metragem',
  'lazer',
  'infraestrutura',
  'diferenciais',
  'seguranca',
  'segurança',
  'mobilidade',
  'unidades',
  'lotes',
  'condominio',
  'condomínio',
] as const;

export function classifyKnowledgeChunk(
  chunk: string,
  context?: ChunkClassificationContext
): ChunkClassification {
  const norm = normalizeText(chunk);
  const enterpriseNameNorm = normalizeText(context?.enterpriseName || '');
  const enterpriseCityNorm = normalizeText(context?.enterpriseCity || '');

  const isRule = hasAny(norm, RULE_TERMS);
  const isVariable = hasAny(norm, VARIABLE_TERMS);
  const isCommercialIntent = hasAny(norm, COMMERCIAL_INTENT_TERMS);
  const isFact = hasAny(norm, FACT_TERMS);

  let block: KnowledgeBlock = 'facts';
  let blockPriority = 60;
  if (isRule) {
    block = 'ana_rules';
    blockPriority = 100;
  } else if (isVariable) {
    block = 'variable_data';
    blockPriority = 85;
  } else if (isCommercialIntent) {
    block = 'commercial_intent';
    blockPriority = 70;
  } else if (isFact) {
    block = 'facts';
    blockPriority = 65;
  }

  const intentTags: string[] = [];
  if (norm.includes('morar')) intentTags.push('morar');
  if (norm.includes('invest') || norm.includes('valoriz')) intentTags.push('investir');
  if (norm.includes('visita') || norm.includes('agend')) intentTags.push('visita');
  if (norm.includes('book') || norm.includes('material') || norm.includes('catalog')) intentTags.push('material');
  if (hasAny(norm, ['valor', 'preco', 'condic', 'juros', 'parcela', 'entrada'])) intentTags.push('financeiro');
  if (hasAny(norm, ['cidade', 'localizacao', 'localização', 'endereco', 'endereço', 'mapa'])) {
    intentTags.push('localizacao');
  }

  let temporalStatus: TemporalStatus = 'atemporal';
  if (hasAny(norm, ['encerrad', 'expirad', 'nao vigente', 'não vigente'])) {
    temporalStatus = 'expired';
  } else if (hasAny(norm, ['vigente', 'valido ate', 'válido até', 'ate', 'até'])) {
    temporalStatus = block === 'variable_data' ? 'current' : 'time_sensitive';
  } else if (block === 'variable_data') {
    temporalStatus = 'time_sensitive';
  }

  const mentionsEnterprise = enterpriseNameNorm.length >= 3 && norm.includes(enterpriseNameNorm);
  const mentionsCity = enterpriseCityNorm.length >= 3 && norm.includes(enterpriseCityNorm);
  const sourceConfidence = Math.max(
    10,
    Math.min(
      100,
      (mentionsEnterprise ? 45 : 0) +
        (mentionsCity ? 35 : 0) +
        (block === 'ana_rules' ? 15 : 0) +
        (intentTags.length > 0 ? 10 : 0)
    )
  );

  return {
    block,
    blockPriority,
    cityHint: mentionsCity ? context?.enterpriseCity?.trim() || null : null,
    enterpriseHint: mentionsEnterprise ? context?.enterpriseName?.trim() || null : null,
    intentTags: unique(intentTags),
    temporalStatus,
    sourceConfidence,
  };
}

