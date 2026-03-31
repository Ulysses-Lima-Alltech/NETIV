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
    re: /\b(portaria|[áa]rea\s+de\s+lazer|sal[aã]o\s+de\s+festas?|piscina|academia|playground|churrasqueira|[áa]reas?\s+comuns?)\b/i,
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
 * disponibilidade → observacoes → condicoes → preco → knowledgeText (primeiros 15 k).
 */
function buildSearchCorpus(
  knowledgeText: string,
  variablesMap: Record<string, string>,
): string {
  const varData = ['disponibilidade', 'observacoes', 'condicoes', 'preco']
    .map((k) => variablesMap[k] ?? '')
    .filter(Boolean)
    .join('\n');
  return [varData, knowledgeText.slice(0, 15_000)].filter(Boolean).join('\n');
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
  /portaria\s*(?:pronta?|entregue|conclu[íi]da?|em\s+obras?|em\s+constru[cç][aã]o)|[áa]rea\s+de\s+lazer\s*(?:pronta?|entregue|em\s+obras?)|piscina\s*(?:pronta?|em\s+obras?)|sal[aã]o\s+de\s+festas?\s*(?:pronto?|entregue|em\s+obras?)/i;

// ─── Montagem da resposta ──────────────────────────────────────────────────────

/** Limpa o fragmento extraído para uso inline em frases. */
function cleanFragment(raw: string): string {
  return raw
    .replace(/^[^\n]{0,80}?(?:[—\-–]|:\s)\s*/u, '') // remove "Nome: " ou "Nome — "
    .replace(/\s+/g, ' ')
    .trim();
}

/** Torna minúscula a primeira letra para fluir após vírgula. */
function lcFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toLowerCase() + s.slice(1);
}

const NOT_FOUND: Record<OperationalTopic, string> = {
  entrega_prazo: 'No material de apoio que tenho aqui, não encontrei uma data de entrega.',
  construir_liberacao:
    'No material de apoio que tenho aqui, não encontrei informação sobre liberação para construir.',
  obra_andamento:
    'No material de apoio que tenho aqui, não encontrei uma atualização sobre o andamento das obras.',
  infraestrutura:
    'No material de apoio disponível aqui, não encontrei informação sobre o status da infraestrutura.',
  portaria_lazer:
    'No material de apoio que tenho aqui, não encontrei o status de portaria ou áreas de lazer.',
};

function buildAnswer(
  topic: OperationalTopic,
  corpus: string,
): { answer: string; dataFound: boolean; fragment: string | null } {
  switch (topic) {
    case 'entrega_prazo': {
      const period = extractEntregaPeriod(corpus);
      if (!period) return { answer: NOT_FOUND[topic], dataFound: false, fragment: null };
      // Se "period" é uma linha completa (não só data), usa diretamente
      const isLongPhrase = period.length > 12;
      const answer = isLongPhrase
        ? `No material que tenho aqui, ${lcFirst(cleanFragment(period))}.`
        : `No material que tenho aqui, a entrega está prevista para ${period}.`;
      return { answer: answer.replace(/\.{2,}$/, '.'), dataFound: true, fragment: period };
    }

    case 'construir_liberacao': {
      const { polarity, line } = extractLiberacao(corpus);
      if (polarity === 'negative') {
        return {
          answer: 'Pelo material de apoio que tenho aqui, ainda não está liberado para construir.',
          dataFound: true,
          fragment: line,
        };
      }
      if (polarity === 'positive') {
        const fragment = line ?? '';
        const answer = fragment
          ? `No material de apoio que tenho aqui, ${lcFirst(cleanFragment(fragment))}.`
          : 'No material de apoio que tenho aqui, está liberado para construir.';
        return { answer: answer.replace(/\.{2,}$/, '.'), dataFound: true, fragment };
      }
      if (line) {
        return {
          answer: `No material de apoio que tenho aqui, sobre liberação para construir: ${lcFirst(cleanFragment(line))}.`,
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
        answer: `No material de apoio que tenho aqui, sobre obras: ${lcFirst(cleanFragment(line))}.`,
        dataFound: true,
        fragment: line,
      };
    }

    case 'infraestrutura': {
      const line = extractLine(corpus, INFRA_SEARCH_RE);
      if (!line) return { answer: NOT_FOUND[topic], dataFound: false, fragment: null };
      return {
        answer: `No material de apoio disponível aqui, sobre infraestrutura: ${lcFirst(cleanFragment(line))}.`,
        dataFound: true,
        fragment: line,
      };
    }

    case 'portaria_lazer': {
      const line = extractLine(corpus, PORTARIA_SEARCH_RE);
      if (!line) return { answer: NOT_FOUND[topic], dataFound: false, fragment: null };
      return {
        answer: `No material de apoio que tenho aqui, sobre portaria/lazer: ${lcFirst(cleanFragment(line))}.`,
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
): OperationalFactResolution | null {
  const topic = detectOperationalTopic(userText);
  if (!topic) return null;

  const corpus = buildSearchCorpus(knowledgeText, variablesMap);
  const { answer, dataFound, fragment } = buildAnswer(topic, corpus);

  return { answer, topic, dataFound, fragment };
}
