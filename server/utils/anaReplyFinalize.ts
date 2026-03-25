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

/**
 * UX: a última ideia da mensagem deve fechar com pergunta e interrogação.
 * Se a última frase for claramente perguntística mas terminou com "." ou "!", promove para "?".
 * Caso contrário, acrescenta pergunta de fechamento variada (não uma única frase fixa).
 */
export function finalizeAnaReplyText(text: string): string {
  let s = (text || '').trim().replace(/\s+/g, ' ');
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
