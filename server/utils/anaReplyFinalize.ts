/** Sem delay artificial — resposta enviada imediatamente após geração. */
export function randomAnaReplyDelayMs(_opts?: {
  burstCount?: number;
  replyLength?: number;
}): number {
  return 0;
}

export function sleepMs(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((r) => setTimeout(r, ms));
}

import { buildCatalogListMessage } from './anaCatalogMessages.js';

const DUPLICATE_FALLBACKS_GENERIC = [
  'Me diz o que você quer priorizar que eu sigo com você.',
  'Qual região ou perfil você quer explorar primeiro?',
];
/**
 * Fallback enviado quando a reply da IA ficou duplicada/similar à anterior.
 * Se houver nomes reais e contexto de catálogo/escape, lista o portfólio em vez de repetir refinamento.
 */
export function pickDuplicateFallbackReply(
  recentContext?: string,
  allEnterpriseNames?: string[]
): string {
  const names = allEnterpriseNames ?? [];
  if (names.length > 0) {
    return buildCatalogListMessage(names, {
      recentContext,
      closingQuestion: 'Qual deles você quer explorar primeiro?',
    });
  }
  const pool = DUPLICATE_FALLBACKS_GENERIC;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

function fingerprintReply(s: string): string {
  return normClosure(s).replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function significantWordSet(s: string): Set<string> {
  const set = new Set<string>();
  for (const w of fingerprintReply(s).split(' ')) {
    if (w.length > 2) set.add(w);
  }
  return set;
}

/**
 * Evita reenviar resposta quase idêntica (similaridade lexical; sem embeddings).
 */
export function repliesSemanticallySimilar(a: string, b: string): boolean {
  const fa = fingerprintReply(a);
  const fb = fingerprintReply(b);
  if (!fa || !fb) return false;
  if (fa === fb) return true;
  const A = significantWordSet(a);
  const B = significantWordSet(b);
  if (A.size === 0 || B.size === 0) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  const union = A.size + B.size - inter;
  const j = union > 0 ? inter / union : 0;
  return j >= 0.88;
}

/** Só quando o modelo não fechou com interrogação — evite variações quase idênticas. */
const FALLBACK_CLOSING_QUESTIONS = [
  'Quer que eu detalhe algum ponto?',
  'Por onde você prefere que a gente continue?',
  'Tem alguma dúvida sobre o que conversamos?',
  'Quer saber mais sobre algum deles?',
];

function normClosure(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Cliente encerrou a conversa (agradecimento / despedida / “por enquanto é só”) —
 * a Ana não deve insistir com pergunta final.
 */
export function detectClientConversationClosure(userMessage: string): boolean {
  const n = normClosure(userMessage);
  if (!n) return false;

  if (/\?\s*$/.test(userMessage.trim())) return false;
  if (/\b(quanto custa|quanto e|qual o valor|me passa o|me envia|manda o|quero saber mais|gostaria de saber|tenho uma duvida|pode me explicar)\b/.test(n)) {
    return false;
  }

  const strongPatterns: RegExp[] = [
    /^no momento nao,? obrigad/,
    /^nao,? obrigad/,
    /^ok,? obrigad/,
    /^ta bom,? obrigad/,
    /^tudo bem,? obrigad/,
    /^perfeito,? obrigad/,
    /^combinado,? obrigad/,
    /\bpor enquanto e so\b/,
    /\bera isso\b/,
    /\bqualquer coisa eu chamo\b/,
    /\bdepois eu vejo\b/,
    /\bnao precisa\b/,
    /\bso isso\b/,
    /\bpor hoje e so\b/,
    /\bvaleu[,!\s]*$/,
    /^obrigad[oa][,!\s]*$/,
    /\btchau\b/,
    /\bate logo\b/,
    /\bno momento nao\b.*\bobrigad/,
  ];
  if (strongPatterns.some((re) => re.test(n))) return true;

  if (n.length <= 160 && (/\bobrigad[oa]\b/.test(n) || /\bvaleu\b/.test(n))) {
    if (/\b(quero|preciso de|gostaria de ver|me mostra|me manda|pode enviar)\b/.test(n)) return false;
    return true;
  }

  return false;
}

const FAREWELL_NO_QUESTION = [
  'Obrigada pelo contato e fico à disposição quando precisar.',
  'Combinado! Obrigada e conte comigo quando precisar.',
  'Sem problema. Obrigada e um ótimo dia!',
  'Perfeito, obrigada pelo contato.',
];

function randomFarewellNoQuestion(): string {
  return FAREWELL_NO_QUESTION[Math.floor(Math.random() * FAREWELL_NO_QUESTION.length)]!;
}

/** Remove sufixo igual ao fallback automático, se o modelo repetir o padrão. */
function stripKnownAppendedClosingQuestion(s: string): string {
  let t = s.trim();
  for (const q of FALLBACK_CLOSING_QUESTIONS) {
    if (t.endsWith(q)) {
      return t.slice(0, -q.length).trim().replace(/[\s,.;:!…]+$/u, '');
    }
  }
  return t;
}

function looksInterrogativeSentence(sentence: string): boolean {
  const t = sentence.trim().toLowerCase();
  if (!t) return false;
  return /\b(qual|quais|quanto|quantas|quantos|como|onde|quando|por que|porque|posso|pode|quer|você quer|tem como|há |existe |me diz|me conta|prefere|gostaria|deseja|seria|está buscando|faz sentido|te interessa|quer que|posso te|devo te|gostaria de|deseja ver)\b/.test(
    t
  );
}

function randomFallbackClosing(): string {
  const i = Math.floor(Math.random() * FALLBACK_CLOSING_QUESTIONS.length);
  return FALLBACK_CLOSING_QUESTIONS[i]!;
}

export interface FinalizeAnaReplyOptions {
  /** Mensagem atual do cliente — usada para detectar encerramento e não forçar pergunta. */
  userMessage?: string | null;
  /** Modo foco: respostas informativas podem terminar sem "?" forçado. */
  conversationMode?: 'triage' | 'scoped' | 'inactive_linked';
}

/**
 * Remove artefatos comuns de markdown que o modelo às vezes devolve (WhatsApp não renderiza bem).
 */
export function stripMarkdownArtifactsForWhatsApp(text: string): string {
  let t = text;
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1');
  t = t.replace(/\*([^*\n]+)\*/g, '$1');
  t = t.replace(/__([^_]+)__/g, '$1');
  t = t.replace(/_([^_\n]+)_/g, '$1');
  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/^#{1,6}\s+/gm, '');
  t = t.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  t = t.replace(/^\s*[*•]\s+/gm, '');
  return t;
}

/** Normaliza espaços mantendo quebras de linha (uma mensagem pode ter vários blocos). Colapsa 3+ quebras em no máximo 2 (uma linha em branco entre parágrafos). */
function normalizeWhitespacePreservingLines(text: string): string {
  const lines = text.split(/\r?\n/);
  const out = lines.map((line) => line.replace(/\s+/g, ' ').trim());
  let joined = out.join('\n');
  while (/\n{3,}/.test(joined)) {
    joined = joined.replace(/\n{3,}/g, '\n\n');
  }
  return joined.trim();
}

/**
 * UX: em conversa aberta, a última ideia deve fechar com pergunta e interrogação.
 * Exceção: se o cliente encerrou claramente, não acrescenta pergunta nem força "?".
 */
export function finalizeAnaReplyText(text: string, opts?: FinalizeAnaReplyOptions): string {
  const closure =
    opts?.userMessage != null && opts.userMessage.length > 0 && detectClientConversationClosure(opts.userMessage);

  let s = normalizeWhitespacePreservingLines(stripMarkdownArtifactsForWhatsApp((text || '').trim()));

  if (closure) {
    if (!s) return randomFarewellNoQuestion();
    return stripKnownAppendedClosingQuestion(s);
  }

  if (!s) return randomFallbackClosing();

  if (s.endsWith('?')) return s;

  if (opts?.conversationMode === 'scoped') {
    const t = s.trim();
    const tail = t.slice(-140);
    if (t.length >= 72 && !tail.includes('?') && /[.!…]$/.test(t)) {
      return t;
    }
  }

  if (s.endsWith('...')) {
    s = s.slice(0, -3).trim();
  }

  const lastCh = s[s.length - 1];
  if (lastCh === '.' || lastCh === '!' || lastCh === '…') {
    const body = s.slice(0, -1).trim();
    const parts = body.split(/(?<=[.!?])\s+/);
    const lastSentence = parts[parts.length - 1] ?? body;
    if (looksInterrogativeSentence(lastSentence)) {
      return `${body}?`;
    }
  }

  const sentences = s.split(/(?<=[.!?])\s+/);
  if (sentences.length >= 4) {
    const last = sentences[sentences.length - 1] ?? '';
    if (looksInterrogativeSentence(last)) {
      return s.replace(/[.!…]$/, '?');
    }
  }

  return `${s}\n\n${randomFallbackClosing()}`;
}

function normGreeting(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Heurística leve: sinais de busca/refinamento imobiliário no texto (mensagem atual + histórico recente fundido).
 * Usada para não aplicar o fallback genérico de incompreensão quando já há contexto aproveitável.
 */
export function userUtteranceHasSearchRefinementSignals(text: string): boolean {
  const raw = (text || '').trim();
  if (raw.length < 2) return false;
  const t = raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (/\b\d{2,5}\s*m[2²]\b/i.test(raw) || /\b\d{2,5}\s*m2\b/i.test(t)) return true;
  if (/\bm[2²]\b/i.test(raw) || /\bmetros(\s+quadrados)?\b/.test(t)) return true;
  if (/\b(uns|com|cerca\s+de)\s+\d{2,5}\b/.test(t) && (/\d+\s*m/i.test(raw) || /\bmetros\b/.test(t))) return true;

  if (
    /\b(em\s+conta|mais\s+em\s+conta|mais\s+barato|barato|economico|preco|precos|valor|valores|faixa|orcamento|investimento|milhao|milhoes|r\$)\b/.test(
      t
    )
  )
    return true;

  if (
    /\b(sao paulo|rio de janeiro|belo horizonte|brasilia|curitiba|porto alegre|salvador|recife|fortaleza|manaus|goiania|vitoria|florianopolis)\b/.test(
      t
    )
  )
    return true;
  if (/\b(sp|rj|bh|df)\b/.test(t)) return true;
  if (/\b(zona\s+(sul|norte|leste|oeste|central)|centro|bairro|cidade|regiao|localizacao)\b/.test(t)) return true;

  if (/\b(quero|queria|preciso|busco|procuro|tem|teria|mostra|mostrar)\b[\s\S]{0,56}\b(em|no|na|pra|para)\b/.test(t))
    return true;
  if (/\b(quais|qual|onde)\b[\s\S]{0,72}\b(empreendimento|empreendimentos|opcao|opcoes|unidades|lancamento)\b/.test(t))
    return true;
  if (/\b(empreendimentos?|lancamentos?|unidades)\b[\s\S]{0,40}\b(em|no|na)\b/.test(t)) return true;
  if (/\b(em|no|na)\s+(sp|sao paulo|rio|bh|rj)\b/.test(t)) return true;

  if (/\b(apartamento|casa|studio|cobertura|dormitorio|dormitorios|quarto|quartos|planta)\b/.test(t)) return true;

  if (/\b(lote|lotes|loteamento|loteamentos|terreno|terrenos|condominio\s+fechado|lote\s+para\s+investir|lote\s+para\s+construir)\b/.test(t)) return true;
  if (/\b(infraestrutura|area\s+de\s+lazer|area\s+verde|metragem\s+do\s+lote)\b/.test(t)) return true;

  if (/\b(me\s+mostr|quero\s+ver|quais\s+opcoes|o\s+que\s+voces?\s+te[mn]|me\s+passa|catalogo|portfolio|quero\s+conhecer|quais\s+empreendimentos)\b/.test(t)) return true;

  if (/\b(nao\s+sei|mostra\s+tudo|ver\s+tudo|quero\s+tudo|tanto\s+faz|qualquer\s+regiao|sem\s+preferencia|me\s+mostra\s+o\s+que\s+tem)\b/.test(t)) return true;

  return false;
}

/**
 * Saudações curtas de abertura — não devem cair em fallback de incompreensão.
 */
export function isSimpleOpeningGreeting(text: string): boolean {
  const n = normGreeting(text);
  if (!n || n.length > 56) return false;
  return (
    /^(oi|ola|oie|opa|eae|e\s*ai|bom\s+dia|boa\s+tarde|boa\s+noite)([!.…]*)?$/.test(n) ||
    /^(oi|ola|oie|opa)\s+[a-z]{1,14}([!.…]*)?$/.test(n)
  );
}

const GREETING_REPLY_NO_NAME = [
  'Oi! Eu sou a Ana. Como posso te chamar?',
  'Olá! Sou a Ana, do comercial. Qual o seu nome?',
  'Oi! Tudo bem? Me diz seu nome que a gente conversa.',
];

const GREETING_REPLY_WITH_NAME = (name: string) => [
  `Oi, ${name}! Como posso te ajudar?`,
  `Olá, ${name}! O que você procura?`,
  `Oi, ${name}! Me conta o que precisa.`,
];

/** Resposta acolhedora para saudação simples (sem chamar a API). */
export function pickRandomGreetingReply(knownCustomerName: string | null | undefined): string {
  const nm = (knownCustomerName || '').trim();
  if (nm.length >= 2) {
    const pool = GREETING_REPLY_WITH_NAME(nm);
    return pool[Math.floor(Math.random() * pool.length)]!;
  }
  return GREETING_REPLY_NO_NAME[Math.floor(Math.random() * GREETING_REPLY_NO_NAME.length)]!;
}

/** Conta menções ao nome do cliente no texto (normalizado, trechos curtos). */
export function countCustomerNameMentionsInText(reply: string, customerName: string | null | undefined): number {
  const name = (customerName || '').trim();
  if (name.length < 2) return 0;
  const n = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  const t = reply
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!n || !t.includes(n)) return 0;
  let count = 0;
  let pos = 0;
  for (;;) {
    const i = t.indexOf(n, pos);
    if (i < 0) break;
    count += 1;
    pos = i + Math.max(1, n.length);
  }
  return count;
}
