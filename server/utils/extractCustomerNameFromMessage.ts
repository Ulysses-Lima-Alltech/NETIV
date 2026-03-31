/** Palavras que não devem ser capturadas como nome próprio (token isolado). */
const NAME_BLOCKLIST = new Set(
  [
    // Saudações e expressões de confirmação
    'cliente', 'obrigado', 'obrigada', 'whatsapp', 'ok', 'oi', 'ola', 'olá', 'hey',
    'bom', 'boa', 'dia', 'tarde', 'noite', 'e', 'ai', 'aí',
    // Imóvel / produto
    'apartamento', 'loteamento', 'mcmv', 'empreendimento', 'visita', 'imovel', 'imóvel',
    'terreno', 'casa', 'lote', 'obra', 'obras', 'construcao', 'construção',
    // Preposições e artigos comuns que nunca são nomes
    'de', 'do', 'da', 'dos', 'das', 'no', 'na', 'nos', 'nas',
    'ao', 'aos', 'pelo', 'pela', 'pelos', 'pelas', 'por', 'para', 'pra',
    'um', 'uma', 'uns', 'umas', 'o', 'a', 'os', 'as',
  ].map((s) => s.toLowerCase())
);

/** Após `sou …`, estes tokens iniciais não iniciam nome próprio. */
const SOU_LEADING_NON_NAME = new Set(
  [
    'interessado',
    'interessada',
    'cliente',
    'o',
    'a',
    'um',
    'uma',
    'da',
    'de',
    'do',
    'das',
    'dos',
    'com',
    'em',
    'sem',
    'por',
    'muito',
    'pouco',
    'apenas',
    'só',
    'so',
    'procurando',
    'querendo',
    'precisando',
    'falando',
    'mandando',
  ].map((s) => s.toLowerCase())
);

/**
 * Resposta curta só com "aparência de nome" após pergunta da Ana — bloqueia intenção comercial/geo.
 * Esta lista deve ser abrangente: qualquer substantivo comum, advérbio de tempo/lugar ou
 * verbo que não seja um nome próprio precisa estar aqui.
 * (Sem fallback genérico de 2–3 palavras fora desse contexto.)
 */
const SHORT_REPLY_NAME_FORBIDDEN = new Set(
  [
    // Intenção / interesse
    'quero', 'tenho', 'gostaria', 'preciso', 'interesse', 'interessado', 'interessada',
    'detalhes', 'detalhe', 'mais', 'sobre', 'conhecer', 'visitar', 'agendar', 'saber',
    // Preposições / conjunções (duplicadas aqui por segurança)
    'em', 'para', 'pra', 'com', 'sem', 'por', 'de', 'do', 'da',
    // Confirmação / negação
    'sim', 'não', 'nao', 'ok', 'claro',
    // Tempo — nunca são nomes
    'tempo', 'prazo', 'data', 'hora', 'horas', 'quando', 'hoje', 'amanha', 'amanhã',
    'semana', 'semanas', 'mes', 'mês', 'meses', 'ano', 'anos', 'dia', 'dias',
    'periodo', 'período', 'duracao', 'duração', 'inicio', 'início', 'final', 'total',
    'agora', 'logo', 'rapido', 'rápido', 'urgente',
    // Processo / etapas
    'entrega', 'fase', 'etapa', 'cronograma', 'andamento', 'obra', 'obras', 'construcao',
    'construção', 'liberacao', 'liberação', 'implantacao', 'implantação', 'infraestrutura',
    'infra', 'documentacao', 'documentação',
    // Produto imobiliário
    'lote', 'lotes', 'apartamento', 'empreendimento', 'imovel', 'imóvel',
    'terreno', 'casa', 'casas', 'predio', 'prédio', 'condominio', 'condomínio',
    // Localização
    'cidade', 'bairro', 'regiao', 'região', 'endereco', 'endereço', 'localizacao',
    'localização', 'atibaia', 'montaresa', 'campinas', 'paulinia', 'paulínia',
    // Financeiro / comercial
    'valor', 'valores', 'preco', 'preço', 'precos', 'preços', 'financiamento',
    'parcela', 'parcelamento', 'entrada', 'fgts', 'desconto', 'oferta', 'tabela',
    // Informação genérica
    'informação', 'informacao', 'informações', 'informacoes', 'detalhes',
    // Verbos e ações comuns
    'aguardando', 'esperando', 'ligando', 'mandando', 'enviando', 'perguntando',
  ].map((s) => s.toLowerCase())
);

export type ExtractCustomerNameContext = {
  /** Conteúdo da última mensagem da assistente antes desta mensagem do usuário (para autoidentificação curta após pergunta de nome). */
  lastAssistantPlain?: string | null;
};

function titleCaseWords(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function sanitizeNameCandidate(raw: string): string | null {
  let s = raw.replace(/^[,\s:]+|[\s,:]+$/g, '').trim();
  const beforePunct = s.split(/[.!?;]/)[0] ?? s;
  s = beforePunct.trim();
  if (s.length < 2 || s.length > 48) return null;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;
  if (words.some((w) => w.length > 22)) return null;
  if (words.some((w) => /\d/.test(w))) return null;
  for (const w of words) {
    if (NAME_BLOCKLIST.has(w.toLowerCase())) return null;
  }
  return titleCaseWords(s);
}

function normalizeForHeuristic(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normToken(w: string): string {
  return w
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

/** Frases claras de autoidentificação (não confundir com "Oi Ana"). */
export function hasExplicitSelfIdentificationInUtterance(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/meu\s+nome\s+[eé]\b/i.test(t) || /me\s+chamo\b/i.test(t)) return true;
  if (/\bsou\s+(?:o|a)\s+[A-Za-zÀ-ÿ]/i.test(t)) return true;
  if (/pode\s+me\s+chamar\s+de\b/i.test(t) || /pode\s+chamar(?:\s+me)?\s+de\b/i.test(t) || /chama(?:\s+me)?\s+de\b/i.test(t)) {
    return true;
  }
  if (/^\s*sou\s+[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2}\s*\.?\s*$/i.test(t)) {
    const m = t.match(/^\s*sou\s+([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2})\s*\.?\s*$/i);
    const first = m?.[1]?.trim().split(/\s+/)[0];
    if (first && !SOU_LEADING_NON_NAME.has(normToken(first))) return true;
  }
  return false;
}

/**
 * Saudações / vocativos dirigidos à atendente "Ana" — não indicam nome do lead.
 */
function isGreetingOrVocativeToAgentAna(text: string): boolean {
  if (hasExplicitSelfIdentificationInUtterance(text)) return false;
  const n = normalizeForHeuristic(text);
  if (!n) return false;
  if (/^ana\s*[,:]/.test(n)) return true;
  if (/^ana\s+\S/.test(n)) return true;
  if (/^(oi|ola|hey)\b/.test(n) && /\bana\b/.test(n)) return true;
  if (/^bom\s+dia\b.*\bana\b/.test(n) || /^boa\s+tarde\b.*\bana\b/.test(n) || /^boa\s+noite\b.*\bana\b/.test(n)) return true;
  if (/^(oi|ola)\s*,\s*ana\b/.test(n)) return true;
  if (/\btudo\s+bem\b/.test(n) && /^(oi|ola)\b/.test(n) && /\bana\b/.test(n)) return true;
  return false;
}

function assistantRecentlyAskedForName(lastAssistantPlain: string | null | undefined): boolean {
  if (!lastAssistantPlain?.trim()) return false;
  const s = lastAssistantPlain.toLowerCase();
  return (
    /como\s+(?:posso\s+)?(?:te\s+)?chamar/.test(s) ||
    /qual(?:\s+[eé])?\s+seu\s+nome/.test(s) ||
    /como\s+você\s+se\s+chama/.test(s) ||
    /como\s+vc\s+se\s+chama/.test(s) ||
    /posso\s+saber\s+(?:o\s+)?seu\s+nome/.test(s) ||
    /me\s+diz\s+(?:o\s+)?seu\s+nome/.test(s) ||
    /seu\s+nome\s+para/.test(s) ||
    /antes\s+de\s+continu.*seu\s+nome/.test(s)
  );
}

/** Só após pergunta explícita de nome: 1–3 tokens alfabéticos, sem vocabulário de intenção. */
function extractNameShortReplyAfterAssistantAsked(
  text: string,
  lastAssistantPlain: string | null | undefined
): string | null {
  if (!assistantRecentlyAskedForName(lastAssistantPlain)) return null;
  const compact = text.replace(/\.$/, '').trim();
  if (compact.length < 2 || compact.length > 40 || compact.includes('?') || compact.includes('@')) return null;
  if (!/^[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2}$/.test(compact)) return null;

  const words = compact.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 3) return null;
  for (const w of words) {
    if (!/^[A-Za-zÀ-ÿ'-]+$/.test(w) || w.length < 2 || w.length > 22) return null;
    const low = normToken(w);
    if (SHORT_REPLY_NAME_FORBIDDEN.has(low) || NAME_BLOCKLIST.has(low)) return null;
  }
  if (isGreetingOrVocativeToAgentAna(compact)) return null;
  return sanitizeNameCandidate(compact);
}

/**
 * Extrai nome só em:
 * - autoidentificação explícita (regex); ou
 * - resposta curta ao turno anterior com pergunta de nome pela Ana.
 * Sem heurística genérica de 2–3 palavras.
 */
export function extractCustomerNameFromUserUtterance(
  text: string,
  ctx?: ExtractCustomerNameContext
): string | null {
  const t = text.trim();
  if (t.length < 2 || t.length > 200) return null;

  const patterns: RegExp[] = [
    /meu\s+nome\s+[eé]\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,46})/i,
    /me\s+chamo\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,46})/i,
    /\bsou\s+(?:o|a)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,46})/i,
    /pode\s+me\s+chamar\s+de\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,30})/i,
    /pode\s+chamar(?:\s+de|\s+me)?\s+de\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,30})/i,
    /chama(?:\s+me)?\s+de\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,30})/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const name = sanitizeNameCandidate(m[1]);
      if (name) return name;
    }
  }

  const souLine = t.match(/^\s*sou\s+([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2})\s*\.?\s*$/i);
  if (souLine?.[1]) {
    const chunk = souLine[1].trim();
    const tw = chunk.split(/\s+/);
    const bad = tw.some((w) => SOU_LEADING_NON_NAME.has(normToken(w)));
    if (!bad) {
      const name = sanitizeNameCandidate(chunk);
      if (name) return name;
    }
  }

  if (isGreetingOrVocativeToAgentAna(t)) return null;

  return extractNameShortReplyAfterAssistantAsked(t, ctx?.lastAssistantPlain);
}

/**
 * Detecta se o texto enviado pela Ana contém pedido explícito de nome (para marcar ana_asked_customer_name).
 */
export function replyExplicitlyAsksCustomerName(replySentToCustomer: string): boolean {
  const s = replySentToCustomer.trim().toLowerCase();
  if (!s) return false;
  return (
    /como\s+(?:posso\s+)?(?:te\s+)?chamar/.test(s) ||
    /qual(?:\s+[eé])?\s+seu\s+nome/.test(s) ||
    /como\s+você\s+se\s+chama/.test(s) ||
    /como\s+vc\s+se\s+chama/.test(s) ||
    /posso\s+saber\s+(?:o\s+)?seu\s+nome/.test(s) ||
    /me\s+diz\s+(?:o\s+)?seu\s+nome/.test(s) ||
    /(?:seu\s+nome|nome\s+para)\s+(?:para|pra)\s+(?:eu\s+)?(?:te\s+)?(?:chamar|registrar)/.test(s) ||
    /antes\s+de\s+(?:seguir|continuar).*\bnome\b/.test(s) ||
    /só\s+me\s+diz\s+seu\s+nome/.test(s)
  );
}
