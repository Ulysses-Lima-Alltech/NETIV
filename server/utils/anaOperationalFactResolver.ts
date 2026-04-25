/**
 * Resolver determinístico para perguntas operacionais do empreendimento.
 *
 * Objetivo: interceptar perguntas sobre entrega, obras, infraestrutura,
 * liberação para construir e portaria/lazer ANTES que o reply do LLM chegue
 * ao cliente, substituindo-o por uma resposta curta e ancorada nos dados
 * oficiais (variablesMap + knowledgeText).
 *
 * Fluxo:
 *   1. Detecta se userText é sobre um tópico operacional.
 *   2. Extrai evidência textual dos dados oficiais por tópico.
 *   3. Se encontrar → resposta curta ancorada no dado ("No material que tenho aqui, ...").
 *   4. Se não encontrar → resposta explícita de ausência ("não encontrei no material...").
 *   5. Retorna null se a pergunta NÃO for operacional (pipeline segue normalmente).
 */

// ─── Tipos exportados ──────────────────────────────────────────────────────────

export type OperationalTopic =
  | 'entrega_prazo'
  | 'construir_liberacao'
  | 'obra_andamento'
  | 'infraestrutura'
  | 'portaria_lazer';

export interface OperationalFactResolution {
  /** Resposta determinística a usar no lugar do reply do LLM */
  answer: string;
  /** Tópico identificado */
  topic: OperationalTopic;
  /** true = dado encontrado nos dados oficiais; false = resposta de ausência */
  dataFound: boolean;
  /** Fragmento extraído da fonte oficial (para log) */
  fragment: string | null;
}

interface StructuredListResult {
  items: string[];
  source: string | null;
}

interface BuildAnswerOpts {
  enterpriseName?: string | null;
}

// ─── Detecção de tópico ────────────────────────────────────────────────────────

const TOPIC_DETECT: ReadonlyArray<{ re: RegExp; topic: OperationalTopic }> = [
  {
    // entrega, prazo, data de entrega — NÃO inclui "construção" para evitar sobreposição
    re: /\b(entrega|prazo|previs[aã]o|data\s+de\s+entrega|quando\s+(?:entrega|fica\s+pronto|vai\s+(?:estar|ficar|ser\s+entregue))|tempo\s+de\s+entrega)\b/i,
    topic: 'entrega_prazo',
  },
  {
    re: /\b(pode\s+construir|j[áa]\s+(?:pode|d[áa])\s+construir|liberado\s+para\s+construir|libera[cç][aã]o\s+(?:para\s+)?(?:de\s+)?(?:obra|construir|constru[cç][aã]o)|in[íi]cio\s+(?:das?\s+)?obras?|come[cç]ar\s+(?:a\s+)?(?:construir|obra)|constru[cç][aã]o\s+(?:liberada|prevista|autorizada)|quando\s+(?:posso|d[áa])\s+construir)\b/i,
    topic: 'construir_liberacao',
  },
  {
    re: /\b(andamento\s+(?:das?\s+)?obras?|como\s+est[aã]o\s+(?:as\s+)?obras?|cronograma\s+(?:das?\s+)?obras?|fase\s+(?:das?\s+)?obras?|etapa\s+(?:das?\s+)?obras?|status\s+(?:das?\s+)?obras?)\b/i,
    topic: 'obra_andamento',
  },
  {
    re: /\b(infra(?:estrutura)?|rede\s+de\s+[áa]gua|esgoto|pavimenta[cç][aã]o|asfalto|drenagem|ilumina[cç][aã]o\s+p[úu]blica)\b/i,
    topic: 'infraestrutura',
  },
  {
    re: /\b(portaria|lazer|[áa]reas?\s+de\s+lazer|[áa]rea\s+de\s+lazer|sal[aã]o\s+de\s+festas?|piscina|academia|playground|churrasqueira|[áa]reas?\s+comuns?)\b/i,
    topic: 'portaria_lazer',
  },
];

export function detectOperationalTopic(userText: string): OperationalTopic | null {
  const t = (userText || '').trim();
  for (const { re, topic } of TOPIC_DETECT) {
    if (re.test(t)) return topic;
  }
  return null;
}

// ─── Construção do corpus de busca ────────────────────────────────────────────

/**
 * Prioriza os campos mais prováveis de conter dados operacionais:
 * disponibilidade → observacoes → condicoes → preco → knowledgeText.
 */
function buildSearchCorpus(
  knowledgeText: string,
  variablesMap: Record<string, string>,
): string {
  const varData = ['disponibilidade', 'observacoes', 'condicoes', 'preco']
    .map((k) => variablesMap[k] ?? '')
    .filter(Boolean)
    .join('\n');
  // Usa todo o `knowledgeText` já limitado no pipeline (~52k) para evitar falso
  // "não encontrei" quando a evidência está fora dos primeiros 15k caracteres.
  return [varData, knowledgeText].filter(Boolean).join('\n');
}

// ─── Extração por tópico ───────────────────────────────────────────────────────

/**
 * Percorre o corpus linha a linha e retorna a primeira linha que satisfaz `re`.
 * Fallback: busca por janela de texto ao redor do primeiro match no corpus inteiro.
 */
function extractLine(corpus: string, re: RegExp): string | null {
  for (const raw of corpus.split(/[\n\r]+/)) {
    const line = raw.trim();
    if (line && re.test(line)) {
      return line.slice(0, 220);
    }
  }
  // Fallback: janela ao redor do match
  const m = re.exec(corpus);
  if (!m) return null;
  const start = Math.max(0, m.index - 40);
  const end = Math.min(corpus.length, m.index + m[0].length + 160);
  return corpus.slice(start, end).replace(/\s+/g, ' ').trim().slice(0, 220);
}

// --- entrega_prazo ---

const ENTREGA_SEARCH_RE =
  /entrega|prazo\s+de\s+entrega|previs[aã]o\s+de\s+entrega|data\s+de\s+entrega/i;

/** Extrai o período/data mais próximo da menção de entrega no corpus. */
function extractEntregaPeriod(corpus: string): string | null {
  const line = extractLine(corpus, ENTREGA_SEARCH_RE);
  if (!line) return null;
  // Tenta capturar: ano, semestre, trimestre, mês+ano, "em X meses"
  const periodRe =
    /\b(\d+[°º]?\s*(?:semestre|trimestre|bimestre)\s+(?:de\s+)?\d{4}|(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)[a-z]*\.?\s+(?:de\s+)?\d{4}|(?:em\s+)?\d{1,2}\s+(?:meses?|anos?)|20\d{2})\b/i;
  const m = periodRe.exec(line);
  if (m) return m[1].trim();
  // Período não extraível, usa a linha inteira
  return line;
}

// --- construir_liberacao ---

const LIBERA_NEG_RE =
  /não\s+(?:está\s+)?(?:ainda\s+)?liberado|n[aã]o\s+(?:é\s+)?possível\s+construir|aguardando\s+libera[cç][aã]o|ainda\s+não\s+(?:está\s+)?liberado|construção\s+não\s+(?:está\s+)?liberada|proibido\s+construir|imposs[íi]vel\s+construir|obras?\s+não\s+(?:podem|podem\s+ser)\s+iniciadas?/i;
const LIBERA_POS_RE =
  /liberado\s+para\s+construir|pode\s+construir|construção\s+(?:está\s+)?liberada|obras?\s+liberadas?|j[áa]\s+(?:está\s+)?liberado|autorizado\s+para\s+construir/i;
const LIBERA_GEN_RE =
  /libera[cç][aã]o|liberado|construir|in[íi]cio\s+(?:das?\s+)?obras?/i;

function extractLiberacao(corpus: string): { polarity: 'positive' | 'negative' | 'unknown'; line: string | null } {
  if (LIBERA_NEG_RE.test(corpus)) {
    return { polarity: 'negative', line: extractLine(corpus, LIBERA_NEG_RE) };
  }
  if (LIBERA_POS_RE.test(corpus)) {
    return { polarity: 'positive', line: extractLine(corpus, LIBERA_POS_RE) };
  }
  const line = extractLine(corpus, LIBERA_GEN_RE);
  return { polarity: 'unknown', line };
}

// --- obra_andamento ---

const OBRA_SEARCH_RE =
  /obras?\s+(?:em\s+andamento|iniciadas?|conclu[íi]das?|finalizadas?|avançadas?|em\s+execu[cç][aã]o|paralisadas?|suspensas?|\d+\s*%)|(\d+)\s*%\s*(?:conclu[íi]do|executado|da\s+obra)|fase\s+\d|etapa\s+\d|cronograma/i;

// --- infraestrutura ---

const INFRA_SEARCH_RE =
  /infra(?:estrutura)?\s*(?:pronta?|completa?|instalada?|conclu[íi]da?|em\s+andamento|em\s+execu[cç][aã]o|disponível|não\s+(?:instalada?|pronta?|conclu[íi]da?))|rede\s+de\s+[áa]gua\s+(?:pronta?|instalada?|em\s+obras?)|esgoto\s+(?:pronto?|instalado?|em\s+obras?)|pavimenta[cç][aã]o\s+(?:pronta?|conclu[íi]da?|em\s+andamento)/i;

// --- portaria_lazer ---

const PORTARIA_SEARCH_RE =
  /portaria\s*(?:pronta?|entregue|conclu[íi]da?|em\s+obras?|em\s+constru[cç][aã]o)?|[áa]rea\s+de\s+lazer(?:\s*(?:pronta?|entregue|em\s+obras?))?|piscina(?:\s*(?:pronta?|em\s+obras?))?|sal[aã]o\s+de\s+festas?(?:\s*(?:pronto?|entregue|em\s+obras?))?|academia(?:\s*(?:pronta?|em\s+obras?))?|playground(?:\s*(?:pronto?|em\s+obras?))?|churrasqueira(?:\s*(?:pronta?|em\s+obras?))?|[áa]reas?\s+comuns?(?:\s*(?:prontas?|em\s+obras?))?/i;

function extractPortariaLazerList(corpus: string): StructuredListResult {
  const lines = corpus
    .split(/[\n\r]+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const sectionHeaderRe = /(?:[áa]reas?\s+comuns?|[áa]reas?\s+de\s+lazer|lazer)\b/i;
  const sectionLineRe =
    /(portaria|piscina|quadra|academia|playground|churrasqueira|sal[aã]o|espa[cç]o\s+gourmet|pet\s*place|brinquedoteca|coworking|spa|praia\s+artificial)/i;

  const candidates: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!sectionHeaderRe.test(line)) continue;

    candidates.push(...splitAmenityCandidates(line));
    for (let j = i + 1; j < Math.min(lines.length, i + 16); j++) {
      const next = lines[j]!;
      if (/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ0-9\s]{8,}$/.test(next) && !sectionLineRe.test(next)) break;
      if (!sectionLineRe.test(next) && !/^[•\-*]|\d+[.)]/.test(next)) continue;
      candidates.push(...splitAmenityCandidates(next));
    }
  }

  if (candidates.length === 0) {
    const line = extractLine(corpus, PORTARIA_SEARCH_RE);
    if (!line) return { items: [], source: null };
    const parsed = dedupeAmenityItems(
      splitAmenityCandidates(line)
        .map(sanitizeAmenityItem)
        .filter((v): v is string => !!v),
    );
    return { items: parsed, source: line };
  }

  const items = dedupeAmenityItems(
    candidates
      .map(sanitizeAmenityItem)
      .filter((v): v is string => !!v),
  );
  const source = items.length > 0 ? items.join(', ') : null;
  return { items, source };
}

// ─── Montagem da resposta ──────────────────────────────────────────────────────

/** Limpa o fragmento extraído para uso inline em frases. */
function cleanFragment(raw: string): string {
  return raw
    .replace(/^[^\n]{0,80}?(?:[—\-–]|:\s)\s*/u, '') // remove "Nome: " ou "Nome — "
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeToken(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitAmenityCandidates(raw: string): string[] {
  return raw
    .replace(/[•·]/g, ',')
    .replace(/\s+\|\s+/g, ',')
    .replace(/\s{2,}/g, ', ')
    .split(/[;,/]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function sanitizeAmenityItem(raw: string): string | null {
  const base = cleanFragment(raw)
    .replace(/^(?:[•\-*]|\d+[.)])\s*/u, '')
    .replace(
      /^(?:[áa]reas?\s+comuns?|[áa]reas?\s+de\s+lazer|lazer|itens?\s+de\s+lazer|amenidades?)\s*[:\-]\s*/iu,
      '',
    )
    .replace(/[.]+$/g, '')
    .trim();
  if (!base) return null;
  const n = normalizeToken(base);
  if (!n) return null;
  if (
    n === 'areas comuns' ||
    n === 'area comum' ||
    n === 'areas de lazer' ||
    n === 'area de lazer' ||
    n === 'lazer' ||
    n === 'amenidades'
  ) {
    return null;
  }
  if (base.length < 3 || base.length > 90) return null;
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function dedupeAmenityItems(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const n = normalizeToken(item)
      .replace(/\b(com|de|da|do|dos|das|e)\b/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(item);
  }
  return out;
}

function isGenericAmenityHeader(raw: string): boolean {
  const n = normalizeToken(raw);
  return (
    n === 'areas comuns' ||
    n === 'area comum' ||
    n === 'areas de lazer' ||
    n === 'area de lazer' ||
    n === 'lazer'
  );
}

function formatLazerListAnswer(items: string[], enterpriseName?: string | null): string {
  const ent = (enterpriseName || '').trim();
  const header = ent.length >= 2
    ? `No ${ent}, as áreas de lazer incluem:`
    : 'As áreas de lazer incluem:';
  return `${header}\n\n${items.map((i) => `• ${i}`).join('\n')}`;
}

const NOT_FOUND: Record<OperationalTopic, string> = {
  entrega_prazo: 'Não encontrei uma data de entrega no material disponível.',
  construir_liberacao:
    'Não encontrei informação sobre liberação para construir no material disponível.',
  obra_andamento:
    'Não encontrei uma atualização sobre o andamento das obras no material disponível.',
  infraestrutura:
    'Não encontrei informação sobre o status da infraestrutura no material disponível.',
  portaria_lazer:
    'Não encontrei informação suficiente sobre portaria e áreas de lazer no material disponível.',
};

function buildAnswer(
  topic: OperationalTopic,
  corpus: string,
  opts?: BuildAnswerOpts,
): { answer: string; dataFound: boolean; fragment: string | null } {
  switch (topic) {
    case 'entrega_prazo': {
      const period = extractEntregaPeriod(corpus);
      if (!period) return { answer: NOT_FOUND[topic], dataFound: false, fragment: null };
      const isLongPhrase = period.length > 12;
      const answer = isLongPhrase
        ? `${cleanFragment(period)}.`
        : `A entrega está prevista para ${period}.`;
      return { answer: answer.replace(/\.{2,}$/, '.'), dataFound: true, fragment: period };
    }

    case 'construir_liberacao': {
      const { polarity, line } = extractLiberacao(corpus);
      if (polarity === 'negative') {
        return {
          answer: 'Ainda não está liberado para construir.',
          dataFound: true,
          fragment: line,
        };
      }
      if (polarity === 'positive') {
        const fragment = line ?? '';
        const answer = fragment
          ? `${cleanFragment(fragment)}.`
          : 'Está liberado para construir.';
        return { answer: answer.replace(/\.{2,}$/, '.'), dataFound: true, fragment };
      }
      if (line) {
        return {
          answer: `${cleanFragment(line)}.`,
          dataFound: true,
          fragment: line,
        };
      }
      return { answer: NOT_FOUND[topic], dataFound: false, fragment: null };
    }

    case 'obra_andamento': {
      const line = extractLine(corpus, OBRA_SEARCH_RE);
      if (!line) return { answer: NOT_FOUND[topic], dataFound: false, fragment: null };
      return {
        answer: `${cleanFragment(line)}.`,
        dataFound: true,
        fragment: line,
      };
    }

    case 'infraestrutura': {
      const line = extractLine(corpus, INFRA_SEARCH_RE);
      if (!line) return { answer: NOT_FOUND[topic], dataFound: false, fragment: null };
      return {
        answer: `${cleanFragment(line)}.`,
        dataFound: true,
        fragment: line,
      };
    }

    case 'portaria_lazer': {
      const list = extractPortariaLazerList(corpus);
      if (list.items.length >= 2) {
        return {
          answer: formatLazerListAnswer(list.items, opts?.enterpriseName),
          dataFound: true,
          fragment: list.source,
        };
      }
      const line = extractLine(corpus, PORTARIA_SEARCH_RE);
      if (!line) return { answer: NOT_FOUND[topic], dataFound: false, fragment: null };
      if (isGenericAmenityHeader(line)) {
        return { answer: NOT_FOUND[topic], dataFound: false, fragment: null };
      }
      return {
        answer: `${cleanFragment(line)}.`,
        dataFound: true,
        fragment: line,
      };
    }
  }
}

// ─── API principal ─────────────────────────────────────────────────────────────

/**
 * Resolve determinísticamente perguntas operacionais a partir dos dados oficiais.
 *
 * Retorna `null` quando a pergunta NÃO é sobre um tópico operacional
 * (pipeline deve seguir normalmente para o LLM).
 *
 * Quando a pergunta É operacional, SEMPRE retorna uma resolução — seja com
 * dado encontrado ou com resposta explícita de ausência.
 */
export function resolveOperationalFactAnswer(
  userText: string,
  knowledgeText: string,
  variablesMap: Record<string, string>,
  opts?: { enterpriseName?: string | null; hintedTopic?: OperationalTopic | null },
): OperationalFactResolution | null {
  const topic = detectOperationalTopic(userText) ?? (opts?.hintedTopic ?? null);
  if (!topic) return null;

  const corpus = buildSearchCorpus(knowledgeText, variablesMap);
  const { answer, dataFound, fragment } = buildAnswer(topic, corpus, opts);

  return { answer, topic, dataFound, fragment };
}
