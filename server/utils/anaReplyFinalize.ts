/** Delay aleatório entre respostas da ANA (ms), não bloqueia outras conversas (uso com await dentro do handler da conversa). */
export function randomAnaReplyDelayMs(): number {
  const min = 5000;
  const max = 40000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Perguntas curtas só quando o modelo não fechou com interrogação — variadas, não uma frase fixa. */
const FALLBACK_CLOSING_QUESTIONS = [
  'Posso te ajudar com mais algum detalhe?',
  'Você quer que eu aprofunde esse ponto?',
  'Quer que eu te mostre outras opções também?',
  'O que você gostaria de saber em seguida?',
  'Por onde você prefere que a gente continue?',
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

  return `${s} ${randomFallbackClosing()}`;
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
  'Oi! Seja bem-vindo(a). Eu sou a Ana, secretária de vendas. Pra eu te atender melhor, como posso te chamar?',
  'Olá! Fico feliz em falar com você. Como posso te chamar?',
  'Oi! Pra eu te atender melhor, qual é o seu nome?',
  'Olá! Tudo bem? Eu sou a Ana, do time comercial. Como posso te chamar?',
];

const GREETING_REPLY_WITH_NAME = (name: string) => [
  `Oi, ${name}! Em que posso te ajudar hoje?`,
  `Olá, ${name}! O que você gostaria de saber agora?`,
  `Oi, ${name}! Por onde você quer que a gente comece?`,
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
