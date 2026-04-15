import { buildCatalogListMessage } from './anaCatalogMessages.js';

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

/** Resposta segura quando o modelo repete saudação genérica sem conteúdo útil. */
export function buildGreetingSafeFallback(customerName?: string | null): string {
  const n = (customerName ?? '').trim();
  if (n.length >= 2) {
    return `Oi, ${n}, tudo bem? Eu sou a Ana e posso te ajudar com as informações. O que você quer entender melhor primeiro?`;
  }
  return 'Oi, tudo bem? Eu sou a Ana e posso te ajudar com as informações. O que você quer entender melhor primeiro?';
}

const DUPLICATE_FALLBACKS_GENERIC = [
  'Me diz o que você quer priorizar que eu sigo com você.',
  'Qual região ou perfil você quer explorar primeiro?',
];
export interface PickDuplicateFallbackOpts {
  /** Modo foco: não listar portfólio inteiro; variar dentro do empreendimento atual. */
  scoped?: boolean;
  focusedEnterpriseName?: string | null;
}

/**
 * Fallback enviado quando a reply da IA ficou duplicada/similar à anterior.
 * Se houver nomes reais e contexto de catálogo/escape, lista o portfólio em vez de repetir refinamento.
 */
export function pickDuplicateFallbackReply(
  recentContext?: string,
  allEnterpriseNames?: string[],
  opts?: PickDuplicateFallbackOpts
): string {
  const name = (opts?.focusedEnterpriseName || '').trim();
  if (opts?.scoped && name.length >= 2) {
    return `Vou focar no ${name}: qual ponto você quer aprofundar agora — valor, localização ou lazer?`;
  }
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

export interface FinalizeAnaReplyOptions {
  /** Mensagem atual do cliente — usada para detectar encerramento e não forçar pergunta. */
  userMessage?: string | null;
  /** Modo foco: respostas informativas podem terminar sem "?" forçado. */
  conversationMode?: 'triage' | 'scoped' | 'inactive_linked';
  /** true somente na primeira resposta da Ana na conversa. */
  isFirstAnaReply?: boolean;
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
 * Só higieniza texto para WhatsApp: sem perguntas aleatórias, sem despedidas fixas — o conteúdo vem do modelo.
 */
function splitSentencesCompact(text: string): string[] {
  return (text || '')
    .split(/(?<=[.!?…])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function userAskedForMaterialLikeIntent(userMessage: string | null | undefined): boolean {
  const n = normClosure(userMessage || '');
  if (!n) return false;
  return /\b(book|material|arquivo|apresentacao|apresentação|pdf|catalogo|catálogo)\b/.test(n);
}

function stripMidConversationReintroduction(text: string, isFirstAnaReply: boolean): string {
  if (isFirstAnaReply) return text;
  const sentences = splitSentencesCompact(text);
  if (sentences.length === 0) return text;
  const reintroPatterns: RegExp[] = [
    /\b(sou|meu nome e|eu sou)\s+a?\s*ana\b/i,
    /\b(secret[aá]ria de vendas|consultora|assistente virtual|especialista)\b/i,
  ];
  const kept = sentences.filter((s) => !reintroPatterns.some((re) => re.test(s)));
  const out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  return out || text;
}

function keepTwoShortSentencesMax(text: string): string {
  const sentences = splitSentencesCompact(text);
  if (sentences.length <= 2) {
    const qCount = (text.match(/\?/g) || []).length;
    if (qCount <= 1) return text;
  }
  const kept: string[] = [];
  let questionUsed = false;
  for (const s of sentences) {
    const hasQ = s.includes('?');
    if (hasQ && questionUsed) continue;
    kept.push(s);
    if (hasQ) questionUsed = true;
    if (kept.length >= 2) break;
  }
  return kept.join(' ').replace(/\s{2,}/g, ' ').trim();
}

function applyShortMaterialReplyPolicy(
  text: string,
  userMessage: string | null | undefined
): string {
  if (!userAskedForMaterialLikeIntent(userMessage)) return text;
  const n = normClosure(text);
  if (!n) return text;
  if (
    /\b(nao consegui|não consegui|nao foi enviado|não foi enviado|nao localizei|não localizei|nao encontrei|não encontrei|indisponivel|indisponível)\b/.test(
      n
    )
  ) {
    return keepTwoShortSentencesMax(text);
  }
  if (/\b(vou te (enviar|mandar)|te enviei|mandei|posso te (enviar|mandar)|tenho sim)\b/.test(n)) {
    if (/\b(vou te (enviar|mandar)|te enviei|mandei)\b/.test(n)) return 'Perfeito, vou te enviar aqui.';
    return 'Tenho sim. Posso te enviar aqui.';
  }
  return 'Tenho sim. Posso te enviar aqui.';
}

export function finalizeAnaReplyText(text: string, opts?: FinalizeAnaReplyOptions): string {
  const isFirstAnaReply = opts?.isFirstAnaReply === true;
  const base = normalizeWhitespacePreservingLines(stripMarkdownArtifactsForWhatsApp((text || '').trim()));
  const noReintro = stripMidConversationReintroduction(base, isFirstAnaReply);
  const materialShort = applyShortMaterialReplyPolicy(noReintro, opts?.userMessage ?? null);
  const compact = keepTwoShortSentencesMax(materialShort);
  return compact.slice(0, 4000);
}

function truncateAtWordBoundary(text: string, maxLen: number): string {
  const t = (text || '').trim();
  if (t.length <= maxLen) return t;
  const sliced = t.slice(0, Math.max(0, maxLen));
  const lastSpace = sliced.lastIndexOf(' ');
  const safe = (lastSpace >= 24 ? sliced.slice(0, lastSpace) : sliced).trim();
  return safe.replace(/[,:;.\-–—\s]+$/g, '').trim();
}

function ensureSentenceEnd(text: string): string {
  const t = (text || '').trim();
  if (!t) return t;
  if (/[.!?…]$/.test(t)) return t;
  return `${t}.`;
}

export function applyAnaHardLengthGuard(params: {
  text: string;
  enterpriseName?: string | null;
  maxChars?: number;
}): string {
  const maxChars = Math.max(120, Math.min(360, params.maxChars ?? 300));
  const enterpriseName = (params.enterpriseName || '').trim();
  const cleaned = normalizeWhitespacePreservingLines(
    stripMarkdownArtifactsForWhatsApp((params.text || '').replace(/\r?\n+/g, ' ').trim())
  );
  if (!cleaned) return '';

  const inputSentences = splitSentencesCompact(cleaned);
  const kept: string[] = [];
  let questionUsed = false;
  for (const sRaw of inputSentences) {
    const s = sRaw.replace(/\s+/g, ' ').trim();
    if (!s) continue;
    const hasQ = s.includes('?');
    if (hasQ && questionUsed) continue;
    kept.push(s);
    if (hasQ) questionUsed = true;
    if (kept.length >= 2) break;
  }

  let out = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  if (!out) out = truncateAtWordBoundary(cleaned, 140);
  out = ensureSentenceEnd(out);

  const hasEnterprise =
    enterpriseName.length >= 2 &&
    normClosure(out).includes(normClosure(enterpriseName));
  if (enterpriseName.length >= 2 && !hasEnterprise) {
    out = `${enterpriseName}: ${out}`.replace(/\s{2,}/g, ' ').trim();
  }

  // Reaplica estrutura rígida após eventuais ajustes.
  const normalizedSentences = splitSentencesCompact(out);
  const finalSentences: string[] = [];
  let finalQuestionUsed = false;
  for (const s of normalizedSentences) {
    const sentence = s.trim();
    if (!sentence) continue;
    const hasQ = sentence.includes('?');
    if (hasQ && finalQuestionUsed) continue;
    finalSentences.push(sentence);
    if (hasQ) finalQuestionUsed = true;
    if (finalSentences.length >= 2) break;
  }
  out = finalSentences.join(' ').replace(/\s{2,}/g, ' ').trim();

  if (out.length > maxChars) {
    if (finalSentences.length > 1) {
      const firstOnly = ensureSentenceEnd(finalSentences[0] || '');
      if (firstOnly.length <= maxChars) out = firstOnly;
    }
    if (out.length > maxChars) {
      out = ensureSentenceEnd(truncateAtWordBoundary(out, maxChars));
    }
  }

  return out.slice(0, maxChars).trim();
}

function normalizeForSemanticCheck(text: string): string {
  return (text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function isEmptyOrPunctuationOnly(text: string): boolean {
  const t = normalizeForSemanticCheck(text);
  if (!t) return true;
  // Considera inválido quando não há letras ou números (ex.: ".", "...", "?!", "-").
  return !/[\p{L}\p{N}]/u.test(t);
}

function normOutbound(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function looksLikeInternalControlText(raw: string, normalized: string): boolean {
  if (!raw) return false;
  if (/```/.test(raw)) return true;
  if (/\[ana_[a-z0-9_ -]+\]/i.test(raw)) return true;
  if (
    normalized.includes('contexto persistido') ||
    normalized.includes('evidencia validada do backend') ||
    normalized.includes('estado_comercial_json') ||
    normalized.includes('send_file_category') ||
    normalized.includes('conversationid') ||
    normalized.includes('messageid')
  ) {
    return true;
  }
  const trimmed = raw.trim();
  if (
    /^\{[\s\S]*\}$/.test(trimmed) &&
    /"reply"\s*:/.test(trimmed) &&
    /"classification"\s*:/.test(trimmed)
  ) {
    return true;
  }
  return false;
}

export function evaluateAnaOutboundText(opts: {
  reply: string;
  technicalFallbackText?: string;
  conversationType?: 'CLIENT' | 'CORRETOR' | 'ADMIN' | string | null;
}): { text: string; valid: boolean; reason: string } {
  const conversationType = String(opts.conversationType ?? 'CLIENT').toUpperCase();
  if (conversationType === 'CORRETOR') {
    return { text: '', valid: false, reason: 'conversation_type_corretor' };
  }
  const raw = (opts.reply || '').trim();
  if (!raw) {
    return { text: raw, valid: false, reason: 'empty_text' };
  }
  if (isEmptyOrPunctuationOnly(raw)) {
    return { text: raw, valid: false, reason: 'punctuation_only_or_placeholder' };
  }

  const n = normOutbound(raw);
  const technicalNorm = normOutbound(opts.technicalFallbackText || '');
  if (technicalNorm && n === technicalNorm) {
    return { text: raw, valid: false, reason: 'fallback_technical_blocked' };
  }
  if (
    n.includes('nao consegui continuar daqui agora') ||
    n.includes('me manda novamente em uma frase o que voce quer saber')
  ) {
    return { text: raw, valid: false, reason: 'fallback_technical_blocked' };
  }
  if (
    n.includes('erro tecnico') ||
    n.includes('tente novamente mais tarde') ||
    n.includes('sistema indisponivel')
  ) {
    return { text: raw, valid: false, reason: 'generic_technical_error_blocked' };
  }
  if (looksLikeInternalControlText(raw, n)) {
    return { text: raw, valid: false, reason: 'internal_control_text_blocked' };
  }

  return { text: raw.slice(0, 4000), valid: true, reason: 'valid_semantic_text' };
}

/**
 * Guard leve da primeira resposta: remove apenas trechos de preço/parcelamento/entrada
 * quando o cliente não pediu isso explicitamente.
 */
export function sanitizeFirstReplyCommercialLeak(reply: string): {
  text: string;
  removedCommercialSentences: number;
} {
  const base = normalizeWhitespacePreservingLines(stripMarkdownArtifactsForWhatsApp((reply || '').trim()));
  if (!base) return { text: base, removedCommercialSentences: 0 };

  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

  const hasCommercialLeak = (sentence: string): boolean => {
    const raw = sentence.trim();
    const n = norm(raw);
    if (!n) return false;

    const strongPatterns: RegExp[] = [
      /r\$\s*\d/,
      /\bpreco(?:s)?\b/,
      /\bquanto\s+(?:custa|fica|sai)\b/,
      /\bparcela(?:s)?\b/,
      /\bentrada\b/,
      /\bfinanciamento\b/,
      /\bdesconto\b/,
      /\bcondic(?:ao|oes)\s+de\s+pagamento\b/,
      /\bpagamento\s+facilitado\b/,
      /\bparcelado\b/,
      /\bsinal\s+de\s+entrada\b/,
      /\bqual\s+o\s+valor\b/,
      /\bvalor\s+do\s+(?:lote|terreno|imovel|apartamento|empreendimento)\b/,
      /\bvalor\s+da\s+entrada\b/,
      /\bme\s+passa\s+o\s+valor\b/,
      /\bvalores?\s+a\s+partir\s+de\b/,
    ];
    return strongPatterns.some((re) => re.test(n));
  };

  const splitSentences = (text: string): string[] => {
    const out: string[] = [];
    const simpleAbbrev = new Set([
      'sr',
      'sra',
      'srta',
      'dr',
      'dra',
      'av',
      'al',
      'apt',
      'bl',
      'cj',
      'etc',
    ]);
    let buf = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === '\n') {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
        continue;
      }
      buf += ch;

      if (ch === '!' || ch === '?') {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
        continue;
      }

      if (ch === '.') {
        const prev = text[i - 1] ?? '';
        const next = text[i + 1] ?? '';

        // Não quebra ponto dentro de número: 279.000,00 / 3.500 m²
        if (/\d/.test(prev) && /\d/.test(next)) continue;

        // Não quebra abreviações comuns.
        const beforeDot = buf.slice(0, -1).trim();
        const token = beforeDot.match(/([A-Za-zÀ-ÿ]{1,5})$/)?.[1]?.toLowerCase() ?? '';
        if (simpleAbbrev.has(token)) continue;

        // Acrônimo simples no padrão "S.A." / "U.S.A.".
        if (/[A-Za-z]\.[A-Za-z]$/.test(beforeDot)) continue;

        // Se não há espaço após ".", pode ser token interno, não fim de frase.
        if (next && !/\s/.test(next)) continue;

        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
      }
    }
    const tail = buf.trim();
    if (tail) out.push(tail);
    return out;
  };

  const sentences = splitSentences(base);
  const kept: string[] = [];
  let removed = 0;
  for (const s of sentences) {
    if (hasCommercialLeak(s)) {
      removed += 1;
      continue;
    }
    kept.push(s.trim());
  }

  if (removed === 0) return { text: base, removedCommercialSentences: 0 };

  if (kept.length === 0) {
    return {
      text: 'Posso te explicar por partes, bem direitinho. Por onde você quer começar: valor, planta ou localização?',
      removedCommercialSentences: removed,
    };
  }
  const rebuilt = kept
    .join(' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text: rebuilt.slice(0, 4000), removedCommercialSentences: removed };
}

/**
 * Guard comercial-financeiro: impede que a Ana simule/negocie condições.
 * Remove/substitui apenas sentenças indevidas, preservando o restante do texto.
 */
export function sanitizeFinancialNegotiationOverreach(reply: string): {
  text: string;
  replacedFinancialSentences: number;
} {
  const base = normalizeWhitespacePreservingLines(stripMarkdownArtifactsForWhatsApp((reply || '').trim()));
  if (!base) return { text: base, replacedFinancialSentences: 0 };

  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();

  const splitSentences = (text: string): string[] => {
    const out: string[] = [];
    const simpleAbbrev = new Set([
      'sr',
      'sra',
      'srta',
      'dr',
      'dra',
      'av',
      'al',
      'apt',
      'bl',
      'cj',
      'etc',
    ]);
    let buf = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      if (ch === '\n') {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
        continue;
      }
      buf += ch;

      if (ch === '!' || ch === '?') {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
        continue;
      }

      if (ch === '.') {
        const prev = text[i - 1] ?? '';
        const next = text[i + 1] ?? '';
        if (/\d/.test(prev) && /\d/.test(next)) continue;
        const beforeDot = buf.slice(0, -1).trim();
        const token = beforeDot.match(/([A-Za-zÀ-ÿ]{1,5})$/)?.[1]?.toLowerCase() ?? '';
        if (simpleAbbrev.has(token)) continue;
        if (/[A-Za-z]\.[A-Za-z]$/.test(beforeDot)) continue;
        if (next && !/\s/.test(next)) continue;
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
      }
    }
    const tail = buf.trim();
    if (tail) out.push(tail);
    return out;
  };

  const isAlreadyBrokerRedirect = (n: string): boolean =>
    /\b(corretor|corretora)\b/.test(n) &&
    /\b(entrada|parcela|parcelas|prazo|simulac|pagamento|juros|correcao|desconto|condic)\b/.test(n);

  const prohibitedPatterns: RegExp[] = [
    /\b(consigo|posso|vou|deixa\s+eu|deixe\s+eu)\s+(?:te\s+)?(?:montar|simular|ajustar|calcular)\b/,
    /\b(simulac(?:ao|oes)|pre-?simulac(?:ao|oes)|simulacao\s+personalizada)\b/,
    /\b(cenario\s+financeiro|plano\s+de\s+pagamento|fluxo\s+de\s+pagamento)\b/,
    /\bquanto\s+pode\s+dar\s+de\s+entrada\b/,
    /\bqual\s+(?:valor\s+de\s+)?parcela\b/,
    /\bqual\s+parcela\s+voce\s+quer\s+pagar\b/,
    /\bem\s+quantas?\s+vezes\b/,
    /\bprefere\s+o\s+prazo\s+mais\s+(?:longo|curto)\b/,
    /\bprazo\s+mais\s+longo\s+possivel\b/,
    /\bcom\s+entrada\s+de\s*r?\$?\s*\d/,
    /\bsem\s+entrada\b/,
    /\bquitar\s+em\s+menos\s+tempo\b/,
    /\bassim\s+eu\s+ajusto\b/,
    /\bvou\s+montar\s+(?:esse\s+)?cenario\b/,
  ];

  const safeRedirect =
    'Sobre entrada, parcelas, prazo e simulação, isso precisa ser validado diretamente com o corretor.';

  const sentences = splitSentences(base);
  const kept: string[] = [];
  let replaced = 0;
  let redirectInserted = false;
  for (const s of sentences) {
    const n = norm(s);
    if (!n) continue;
    const prohibited = prohibitedPatterns.some((re) => re.test(n));
    if (prohibited && !isAlreadyBrokerRedirect(n)) {
      replaced += 1;
      if (!redirectInserted) {
        kept.push(safeRedirect);
        redirectInserted = true;
      }
      continue;
    }
    kept.push(s.trim());
  }

  if (replaced === 0) return { text: base, replacedFinancialSentences: 0 };
  if (kept.length === 0) {
    return {
      text: safeRedirect,
      replacedFinancialSentences: replaced,
    };
  }
  const rebuilt = kept
    .join(' ')
    .replace(/\s+([,.;!?])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return { text: rebuilt.slice(0, 4000), replacedFinancialSentences: replaced };
}

/**
 * Guard estrutural para a PRIMEIRA resposta de lead de campanha:
 * - mantém no máximo 2 frases (alinha à progressão comercial: uma informação principal por mensagem)
 * - mantém no máximo 1 pergunta
 * - remove excesso sem reescrever o conteúdo-base
 */
export function sanitizeFirstCampaignReplyShape(reply: string): {
  text: string;
  trimmedSentences: number;
  removedQuestions: number;
} {
  const base = normalizeWhitespacePreservingLines(stripMarkdownArtifactsForWhatsApp((reply || '').trim()));
  if (!base) return { text: base, trimmedSentences: 0, removedQuestions: 0 };

  const splitSentences = (text: string): string[] => {
    const out: string[] = [];
    let buf = '';
    for (let i = 0; i < text.length; i++) {
      const ch = text[i]!;
      buf += ch;
      if (ch === '\n') {
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
        continue;
      }
      if (ch === '!' || ch === '?' || ch === '.') {
        const next = text[i + 1] ?? '';
        if (ch === '.' && next && !/\s/.test(next)) continue;
        const t = buf.trim();
        if (t) out.push(t);
        buf = '';
      }
    }
    const tail = buf.trim();
    if (tail) out.push(tail);
    return out;
  };

  const parts = splitSentences(base).filter(Boolean);
  const kept: string[] = [];
  let questionCount = 0;
  let removedQuestions = 0;

  for (const p of parts) {
    const hasQuestion = p.includes('?');
    if (hasQuestion) {
      if (questionCount >= 1) {
        removedQuestions += 1;
        continue;
      }
      questionCount += 1;
    }
    kept.push(p.trim());
    if (kept.length >= 2) break;
  }

  const trimmedSentences = Math.max(0, parts.length - kept.length);
  const rebuilt = kept.join(' ').replace(/\s{2,}/g, ' ').trim();
  return {
    text: rebuilt.slice(0, 4000),
    trimmedSentences,
    removedQuestions,
  };
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
  'Oi, tudo bem? Eu sou a Ana e posso te ajudar com as informações. O que você quer entender melhor primeiro?',
  'Claro, eu te explico sim. Se você quiser, eu te passo um panorama rápido e depois a gente aprofunda no que fizer mais sentido para você.',
  'Posso te passar um resumo direto e a gente aprofunda no que for mais importante para você.',
];

const GREETING_REPLY_WITH_NAME = (name: string) => [
  `Oi, ${name}, tudo bem? Eu sou a Ana e posso te ajudar com as informações. O que você quer entender melhor primeiro?`,
  `Claro, ${name}. Eu te explico sim e sigo pelo ponto que mais pesa para você agora.`,
  `Perfeito, ${name}. Posso te passar um panorama rápido e depois a gente aprofunda no que for mais importante para você.`,
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
