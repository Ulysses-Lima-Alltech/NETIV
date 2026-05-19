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
  void customerName;
  return '';
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
  void recentContext;
  void allEnterpriseNames;
  void opts;
  return '';
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

const HUMAN_EVORA_LOCATION_REPLY =
  'O Évora fica em Atibaia, em uma das melhores localizações da cidade, com fácil acesso pela Rodovia Dom Pedro I, perto da região da Pedreira. É uma região que combina tranquilidade, natureza e acesso rápido aos principais pontos da cidade. Me conta, você quer entender melhor o entorno, os acessos ou a estrutura do empreendimento?';

function isUserAskingAboutLocation(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(localizacao|localização|onde fica|endereco|endereço|fica onde|qual a regiao|qual a região|como chegar|mapa|google maps|acesso|bairro)\b/.test(n);
}

function isEvoraContext(reply: string, userMessage?: string | null): boolean {
  const combined = normClosure(`${reply || ''} ${userMessage || ''}`);
  return /\b(evora|évora)\b/.test(combined);
}

function forceEvoraLocationReplyWhenNeeded(reply: string, userMessage?: string | null): string {
  const clean = (reply || '').trim();
  if (!clean) return clean;

  if (!isUserAskingAboutLocation(userMessage)) return clean;
  if (!isEvoraContext(clean, userMessage)) return clean;

  return HUMAN_EVORA_LOCATION_REPLY;
}

const HUMAN_LAZER_REPLY =
  'Tem uma estrutura de lazer bem completa, com piscinas, academia, salão de festas, playground, quadras e espaços de convivência. A ideia é atender tanto momentos em família quanto atividades do dia a dia. Quer que eu te conte mais sobre os espaços para família, esportes ou convivência?';

function isUserAskingAboutLazer(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return /\b(lazer|area de lazer|área de lazer|piscina|piscinas|academia|salao de festas|salão de festas|playground|quadra|quadras|beach tennis|campo society|coworking|espaco zen|espaço zen|fireplace|praca interna|praça interna|area verde|área verde)\b/.test(n);
}

function looksLikeDryLazerList(reply: string): boolean {
  const raw = (reply || '').trim();
  const n = normClosure(raw);
  if (!n) return false;

  const hasLazerTerms =
    /\b(piscina|piscinas|academia|salao de festas|playground|coworking|espaco zen|fireplace|beach tennis|campo society|praca interna|area verde|quadra|quadras)\b/.test(n);

  if (!hasLazerTerms) return false;

  const bulletCount = (raw.match(/(^|\n)\s*[-•*]\s+/g) || []).length;
  const commaCount = (raw.match(/,/g) || []).length;

  const lazerTermCount = [
    'piscina',
    'academia',
    'salão de festas',
    'salao de festas',
    'playground',
    'coworking',
    'espaço zen',
    'espaco zen',
    'fireplace',
    'beach tennis',
    'campo society',
    'praça interna',
    'praca interna',
    'área verde',
    'area verde',
    'quadra',
    'quadras',
  ].reduce((acc, term) => acc + (n.includes(normClosure(term)) ? 1 : 0), 0);

  return bulletCount >= 3 || commaCount >= 5 || lazerTermCount >= 6;
}

function humanizeLazerReplyWhenNeeded(reply: string, userMessage?: string | null): string {
  const clean = (reply || '').trim();
  if (!clean) return clean;

  if (!isUserAskingAboutLazer(userMessage)) return clean;
  if (!looksLikeDryLazerList(clean)) return clean;

  return HUMAN_LAZER_REPLY;
}

const GENERAL_ENTERPRISE_INTRO_OPEN_QUESTION = 'Finalizar com pergunta aberta e natural, sem resposta fixa determinística.';

function replyAlreadyEndsWithQuestion(text: string): boolean {
  return /\?\s*$/.test((text || '').trim());
}

function hasQuestionNearEnd(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  const tail = t.slice(Math.max(0, t.length - 140));
  return /\?/.test(tail);
}

function isSpecificCommercialOrOperationalTopic(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;

  return /\b(valor|preco|preço|quanto custa|quanto e|quanto é|r\$|entrada|parcela|parcelamento|financiamento|tabela|condicao|condição|pagamento|desconto|disponibilidade|lote disponivel|lote disponível|reservar|reserva|documentacao|documentação|contrato|iptu|condominio|condomínio|taxa|obra|entrega|prazo|quando posso construir|book|material|foto|fotos|video|vídeo|planta|implantacao|implantação|visita|agendar|agenda|horario|horário|corretor|humano|atendente|endereco|endereço|localizacao|localização)\b/.test(n);
}

function isGeneralEnterpriseIntroUserMessage(text: string | null | undefined): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  if (isSpecificCommercialOrOperationalTopic(text)) return false;

  return (
    /\b(quero saber|queria saber|gostaria de saber|tenho interesse|me fala|me conte|me passa mais detalhes|mais informacoes|mais informações|saber mais|conhecer melhor|informacoes sobre|informações sobre)\b/.test(n) ||
    /\b(o que e|o que é)\b.*\b(evora|empreendimento|loteamento|condominio|condomínio)\b/.test(n) ||
    /\b(evora|évora)\b/.test(n)
  );
}

function looksLikeGeneralEnterpriseIntroReply(text: string): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  if (replyAlreadyEndsWithQuestion(text) || hasQuestionNearEnd(text)) return false;
  if (/\br\$\b|\br\$|\bvalor\b|\bpreco\b|\bpreço\b|\bentrada\b|\bparcela\b|\bfinanciamento\b|\btabela\b|\bpagamento\b/.test(n)) {
    return false;
  }

  const hasEnterpriseShape = /\b(evora|évora|empreendimento|loteamento|condominio|condomínio)\b/.test(n);
  const hasIntroFacts = /\b(atibaia|lotes?|360\s*m|360m|infraestrutura|lazer|seguranca|segurança|rodovia dom pedro|pedreira)\b/.test(n);

  return hasEnterpriseShape && hasIntroFacts;
}

function appendOpenQuestionForGeneralEnterpriseIntro(
  reply: string,
  userMessage?: string | null
): string {
  const clean = (reply || '').trim();
  if (!clean) return clean;
  if (replyAlreadyEndsWithQuestion(clean) || hasQuestionNearEnd(clean)) return clean;

  const shouldApplyByUser = isGeneralEnterpriseIntroUserMessage(userMessage);
  const shouldApplyByReply = looksLikeGeneralEnterpriseIntroReply(clean);

  if (!shouldApplyByUser && !shouldApplyByReply) return clean;

  if (isSpecificCommercialOrOperationalTopic(userMessage)) return clean;

  return `${clean} ${GENERAL_ENTERPRISE_INTRO_OPEN_QUESTION}`;
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
  // Nunca cria promessa de envio aqui. O claim de envio deve vir somente
  // do fluxo determinístico após tentativa real de outbound.
  return keepTwoShortSentencesMax(text);
}

const BROKER_DETAIL_ROUTING_TEXT =
  'Esses detalhes variam conforme as opcoes disponiveis. O corretor te passa tudo certinho no atendimento. Que tal marcarmos uma visita?';

function removeInternalLimitationSentences(text: string): { text: string; changed: boolean } {
  const lines = (text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { text, changed: false };
  const forbidden = [
    /\bnao tenho essa informacao liberada\b/i,
    /\bnao tenho acesso\b/i,
    /\bnao consta na base\b/i,
    /\bmaterial liberad/i,
    /\bbase da ana\b/i,
    /\binformacao nao liberada\b/i,
    /\bnao fui autorizad/i,
    /\bno material de apoio\b/i,
    /\bnao encontrei\b/i,
    /\bnao localizei\b/i,
  ];
  let changed = false;
  const kept = lines.filter((line) => {
    const hit = forbidden.some((re) => re.test(line));
    if (hit) changed = true;
    return !hit;
  });
  if (!changed) return { text, changed: false };
  const next = kept.join('\n').trim();
  if (!next) return { text: BROKER_DETAIL_ROUTING_TEXT, changed: true };
  return { text: `${next}\n\n${BROKER_DETAIL_ROUTING_TEXT}`, changed: true };
}

function sanitizeUnsupportedSpecificOffers(text: string): { text: string; changed: boolean } {
  const raw = (text || '').trim();
  if (!raw) return { text: raw, changed: false };
  const forbiddenOfferPatterns = [
    /\bplanta(?:s)? dos lotes?\b/i,
    /\bmodelos? de construc/i,
    /\btabela\b/i,
    /\bvalores? exatos?\b/i,
    /\bdisponibilidade em tempo real\b/i,
    /\bsimulac/i,
    /\bdesconto\b/i,
    /\bdetalhes? juridic/i,
    /\bdetalhes? contratuais?\b/i,
  ];
  if (!forbiddenOfferPatterns.some((re) => re.test(raw))) return { text: raw, changed: false };
  const replaced = raw.replace(
    /.*(?:planta(?:s)? dos lotes?|modelos? de construc[aã]o|tabela|valores? exatos?|disponibilidade em tempo real|simulac[aã]o|desconto|detalhes? juridic[oa]s?|detalhes? contratuais?).*/gi,
    'Se quiser, eu te explico localizacao, estrutura, lazer e seguranca, e ja te ajudo a marcar visita.'
  ).replace(/\s+/g, ' ').trim();
  return { text: replaced || 'Se quiser, eu te explico os diferenciais gerais e ja te ajudo a marcar visita.', changed: true };
}

export function containsInternalLimitationLanguage(text: string): boolean {
  const n = normClosure(text || '');
  if (!n) return false;
  return (
    n.includes('nao tenho essa informacao liberada') ||
    n.includes('nao tenho acesso') ||
    n.includes('nao consta na base') ||
    n.includes('material liberado') ||
    n.includes('base da ana') ||
    n.includes('informacao nao liberada') ||
    n.includes('nao fui autorizada') ||
    n.includes('no material de apoio') ||
    n.includes('nao encontrei') ||
    n.includes('nao localizei')
  );
}

export function finalizeAnaReplyText(text: string, opts?: FinalizeAnaReplyOptions): string {
  const isFirstAnaReply = opts?.isFirstAnaReply === true;
  const base = normalizeWhitespacePreservingLines(stripMarkdownArtifactsForWhatsApp((text || '').trim()));
  const noReintro = stripMidConversationReintroduction(base, isFirstAnaReply);
  const materialShort = applyShortMaterialReplyPolicy(noReintro, opts?.userMessage ?? null);
  const compact = keepTwoShortSentencesMax(materialShort);
  const evoraLocation = forceEvoraLocationReplyWhenNeeded(compact, opts?.userMessage ?? null);
  const humanLazer = humanizeLazerReplyWhenNeeded(evoraLocation, opts?.userMessage ?? null);
  const withOpenQuestion = appendOpenQuestionForGeneralEnterpriseIntro(humanLazer, opts?.userMessage ?? null);
  const sanitized = removeInternalLimitationSentences(withOpenQuestion);
  const safeOffers = sanitizeUnsupportedSpecificOffers(sanitized.text);
  const dedupGreeting = sanitizeDuplicatedGreetingPrefix(safeOffers.text);
  return dedupGreeting.slice(0, 4000);
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

const LEADING_LABEL_PREFIX_RE = /^([A-ZÁÀÂÃÉÈÊÍÌÎÓÒÔÕÚÙÛÇ0-9 _-]{2,}):\s+/i;

function normalizeLabelToken(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[_-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isGreetingLikeReply(text: string): boolean {
  const n = normClosure(text || '');
  if (!n || n.length > 120) return false;
  const greetingStart = /^(oi|ola|bom dia|boa tarde|boa noite|opa|e ai)\b/.test(n);
  if (!greetingStart) return false;
  if (/\b(preco|valor|lazer|portaria|metragem|localizacao|financiamento|visita|agenda|endereco)\b/.test(n)) {
    return false;
  }
  return true;
}

function sanitizeLeadingLabelPrefix(text: string, enterpriseName?: string | null): string {
  const raw = (text || '').trim();
  if (!raw) return raw;

  const m = LEADING_LABEL_PREFIX_RE.exec(raw);
  if (!m) return raw;

  const label = (m[1] || '').trim();
  const body = raw.slice(m[0].length).trim();
  const normalizedLabel = normalizeLabelToken(label);
  const normalizedEnterprise = normalizeLabelToken(enterpriseName || '');
  const isEnterpriseLabel = normalizedEnterprise.length >= 2 && normalizedLabel === normalizedEnterprise;

  if (!body || isGreetingLikeReply(body)) return body || raw;
  if (isEnterpriseLabel) return body;
  return body;
}

export function applyAnaHardLengthGuard(params: {
  text: string;
  enterpriseName?: string | null;
  maxChars?: number;
  preserveLineBreaks?: boolean;
}): string {
  const maxChars = Math.max(120, Math.min(360, params.maxChars ?? 300));
  const enterpriseName = (params.enterpriseName || '').trim();
  const sourceText = params.preserveLineBreaks
    ? (params.text || '').trim()
    : (params.text || '').replace(/\r?\n+/g, ' ').trim();
  const cleaned = normalizeWhitespacePreservingLines(stripMarkdownArtifactsForWhatsApp(sourceText));
  if (!cleaned) return '';

  if (params.preserveLineBreaks) {
    const lines = cleaned.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    const kept: string[] = [];
    let total = 0;
    for (const line of lines) {
      const plus = (kept.length > 0 ? 1 : 0) + line.length;
      if (total + plus > maxChars) break;
      kept.push(line);
      total += plus;
    }
    const out = (kept.join('\n').trim() || truncateAtWordBoundary(cleaned.replace(/\n+/g, ' '), maxChars))
      .slice(0, maxChars)
      .trim();
    return sanitizeLeadingLabelPrefix(out, enterpriseName);
  }

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

  const sanitized = sanitizeLeadingLabelPrefix(out.slice(0, maxChars).trim(), enterpriseName);
  return appendOpenQuestionForGeneralEnterpriseIntro(sanitized, null);
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
  enterpriseName?: string | null;
}): { text: string; valid: boolean; reason: string } {
  const conversationType = String(opts.conversationType ?? 'CLIENT').toUpperCase();
  if (conversationType === 'CORRETOR') {
    return { text: '', valid: false, reason: 'conversation_type_corretor' };
  }
  const raw = sanitizeLeadingLabelPrefix((opts.reply || '').trim(), opts.enterpriseName);
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

function normFinalGuard(text: string): string {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function userAskedObjectiveQuestion(text: string | null | undefined): boolean {
  const n = normFinalGuard(text || '');
  if (!n) return false;
  return (
    /\?/.test(text || '') ||
    /\b(qual|quais|quanto|custa|valor|preco|metragem|metros|m2|m²|onde fica|localizacao|endereco|lazer|area de lazer|areas de lazer|financiamento|pagamento|entrada|parcela|disponibilidade)\b/.test(n)
  );
}

function userSentOnlyGreeting(text: string | null | undefined): boolean {
  const n = normFinalGuard(text || '');
  if (!n || n.length > 48) return false;
  return /^(oi|ola|oie|opa|bom dia|boa tarde|boa noite|tudo bem|td bem)[!.? ]*$/.test(n);
}

function replyStartsWithGreeting(text: string): boolean {
  return /^(oi|ola|olá|bom dia|boa tarde|boa noite|opa)\b/i.test((text || '').trim());
}

function countQuestions(text: string): number {
  return ((text || '').match(/\?/g) || []).length;
}

export function sanitizeTooManyQuestionsReply(reply: string): string {
  const raw = (reply || '').replace(/\s+/g, ' ').trim();
  if (!raw) return '';

  const questionCount = countQuestions(raw);
  if (questionCount <= 1) return raw;

  let base = raw;
  while (/\?\s*$/.test(base)) {
    const next = base.replace(/(?:^|[\s.!])[^.!?]*\?\s*$/u, '').trim();
    if (!next || next === base) break;
    base = next;
  }

  base = base.replace(/\?+/g, '.').replace(/\s+/g, ' ').trim();
  base = base.replace(/[,:;\-]\s*$/g, '').trim();
  if (base && !/[.!]$/.test(base)) base = `${base}.`;

  const safeQuestion =
    /\b(localizacao|localização|bairro|onde fica|endereco|endereço|atibaia)\b/i.test(base)
      ? 'Quer que eu te fale mais sobre a localização?'
      : 'Quer saber mais sobre a localização ou prefere falar com um corretor?';

  if (!base) {
    const head = raw.split('?')[0]?.trim() ?? '';
    if (!head) return '';
    const normalizedHead = /[.!]$/.test(head) ? head : `${head}.`;
    return `${normalizedHead} ${safeQuestion}`.trim();
  }
  return `${base} ${safeQuestion}`.trim();
}

function hasAxisAnswerSignal(replyNorm: string, userNorm: string): boolean {
  if (!replyNorm || !userNorm) return false;
  if (/\b(valor|preco|quanto|custa|r\$)\b/.test(userNorm)) {
    return /\b(r\$|valor|preco|a partir de|entrada|parcela|condic)/.test(replyNorm);
  }
  if (/\b(metragem|metros|m2|m²|tamanho|planta|tipologia)\b/.test(userNorm)) {
    return /\b(metragem|metros|m2|m²|planta|tipologia|quarto|dormitorio|\d+\s*m)/.test(replyNorm);
  }
  if (/\b(lazer|area de lazer|areas de lazer|areas comuns|amenidades)\b/.test(userNorm)) {
    return /\b(lazer|piscina|academia|quadra|salao|playground|areas comuns|area comum|churrasqueira|coworking|pet|fitness)\b/.test(replyNorm);
  }
  if (/\b(onde fica|localizacao|endereco|bairro|cidade)\b/.test(userNorm)) {
    return /\b(fica|localizacao|endereco|bairro|cidade|rua|avenida)\b/.test(replyNorm);
  }
  if (/\b(financiamento|pagamento|entrada|parcela|condic)\b/.test(userNorm)) {
    return /\b(financiamento|pagamento|entrada|parcela|condic|corretor)\b/.test(replyNorm);
  }
  return true;
}

function sanitizeDuplicatedGreetingPrefix(text: string): string {
  const raw = (text || '').trim();
  if (!raw) return raw;
  return raw
    .replace(/^(oi|ol[aá]|bom dia|boa tarde|boa noite)[!,. ]+\s*(oi|ol[aá]|bom dia|boa tarde|boa noite)\b[!,. ]*/i, '$1! ')
    .replace(/^(oi|ol[aá])\s*,\s*(oi|ol[aá])\b[!,. ]*/i, '$1! ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function saysInfoMissingDespiteEvidence(replyNorm: string, knowledgeNorm: string): boolean {
  if (!replyNorm || !knowledgeNorm) return false;
  const missingClaim =
    /\b(nao encontrei|nao consta|nao tenho essa informacao|nao achei|nao localizei|preciso confirmar)\b/.test(replyNorm);
  if (!missingClaim) return false;
  const evidenceMarkers = [
    /\br\$\s*\d/,
    /\bvalor(?:es)?\b/,
    /\bpreco\b/,
    /\bmetragem\b/,
    /\b\d+\s*m(?:2|²)?\b/,
    /\blazer\b/,
    /\bpiscina\b/,
    /\bacademia\b/,
    /\bquadra\b/,
    /\bfica em\b/,
    /\bendereco\b/,
    /\bentrega\b/,
  ];
  return evidenceMarkers.some((re) => re.test(knowledgeNorm));
}

export function evaluateAnaEmptyFallbackGuard(opts: {
  reply: string;
  userMessage: string | null | undefined;
  lastAssistantMessage?: string | null;
  isFirstAnaReply?: boolean;
  knowledgeText?: string | null;
}): { blocked: boolean; reason: string | null } {
  const n = normFinalGuard(opts.reply || '');
  if (!n) return { blocked: true, reason: 'empty_after_guards' };
  const userNorm = normFinalGuard(opts.userMessage || '');

  const badPatterns: Array<[RegExp, string]> = [
    [/\bposso te explicar\b/, 'empty_phrase_posso_te_explicar'],
    [/\bposso apresentar\b/, 'empty_phrase_posso_apresentar'],
    [/\bprincipais pontos\b/, 'empty_phrase_principais_pontos'],
    [/\bqual ponto voce quer\b/, 'empty_phrase_qual_ponto_voce_quer'],
    [/\bforma objetiva\b/, 'empty_phrase_forma_objetiva'],
    [/\bquer que eu detalhe\b/, 'empty_phrase_quer_que_eu_detalhe'],
    [/\bqualquer coisa estou a disposicao\b/, 'empty_closure_vague_disposition'],
    [/\bveja bem\b/, 'empty_phrase_veja_bem'],
  ];
  for (const [re, reason] of badPatterns) {
    if (re.test(n)) return { blocked: true, reason };
  }

  if (/\bmorar ou investir\b/.test(n) && userAskedObjectiveQuestion(opts.userMessage)) {
    return { blocked: true, reason: 'empty_phrase_morar_ou_investir_after_objective_ask' };
  }
  if (countQuestions(opts.reply || '') > 1) {
    return { blocked: true, reason: 'too_many_questions' };
  }
  if (opts.isFirstAnaReply === true && !replyStartsWithGreeting(opts.reply || '')) {
    return { blocked: true, reason: 'first_reply_missing_greeting' };
  }
  if (/^(oi|ola|bom dia|boa tarde|boa noite)[!. ]*(eu sou|sou)?\s*(a\s*)?ana[!. ]*$/.test(n)) {
    return { blocked: true, reason: 'dry_robotic_greeting' };
  }
  if (userSentOnlyGreeting(opts.userMessage) && n.split(/\s+/).filter(Boolean).length < 7) {
    return { blocked: true, reason: 'too_dry_for_opening_greeting' };
  }
  if (userSentOnlyGreeting(opts.userMessage) && isGreetingLikeReply(opts.reply || '')) {
    return { blocked: true, reason: 'isolated_greeting_without_contextual_followup' };
  }
  if (userAskedObjectiveQuestion(opts.userMessage) && countQuestions(opts.reply || '') > 0 && n.split(/\s+/).filter(Boolean).length <= 5) {
    return { blocked: true, reason: 'objective_question_turned_into_question' };
  }
  if (userAskedObjectiveQuestion(opts.userMessage) && !hasAxisAnswerSignal(n, userNorm)) {
    return { blocked: true, reason: 'objective_question_not_answered' };
  }
  if (
    userAskedObjectiveQuestion(opts.userMessage) &&
    /\b(encaminhar|vou passar|passar para|um consultor|um corretor|atendente)\b/.test(n) &&
    !hasAxisAnswerSignal(n, userNorm)
  ) {
    return { blocked: true, reason: 'handoff_before_helping' };
  }
  if (/\b(como ja expliquei|obviamente|voce precisa entender|nao foi isso que eu disse|ja falei)\b/.test(n)) {
    return { blocked: true, reason: 'defensive_or_superior_tone' };
  }
  if (/\b(nao posso fazer nada|isso nao e comigo|voce deve procurar|sem essa informacao nao consigo ajudar)\b/.test(n)) {
    return { blocked: true, reason: 'cold_or_unhelpful_tone' };
  }
  if (saysInfoMissingDespiteEvidence(n, normFinalGuard(opts.knowledgeText || ''))) {
    return { blocked: true, reason: 'claims_missing_info_present_in_rag' };
  }

  return { blocked: false, reason: null };
}

function contextualGreeting(referenceNow?: Date | string | null): 'Bom dia' | 'Boa tarde' | 'Boa noite' {
  const d = referenceNow instanceof Date ? referenceNow : referenceNow ? new Date(referenceNow) : new Date();
  const hourText = new Intl.DateTimeFormat('pt-BR', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    hour12: false,
  }).format(d);
  const hour = Number(hourText.replace(/\D/g, ''));
  if (Number.isFinite(hour) && hour >= 5 && hour < 12) return 'Bom dia';
  if (Number.isFinite(hour) && hour >= 12 && hour < 18) return 'Boa tarde';
  return 'Boa noite';
}

export function applyFirstUsefulGreetingStyle(opts: {
  text: string;
  isFirstAnaReply?: boolean;
  referenceNow?: Date | string | null;
}): { text: string; changed: boolean; greeting: string | null } {
  const raw = (opts.text || '').trim();
  void opts.referenceNow;
  if (!raw) return { text: raw, changed: false, greeting: null };
  if (opts.isFirstAnaReply !== true) return { text: raw, changed: false, greeting: null };
  if (replyStartsWithGreeting(raw)) return { text: raw, changed: false, greeting: null };

  const compact = raw.replace(/\s+/g, ' ').trim();
  const words = compact.split(/\s+/).filter(Boolean);
  const hasUsefulAndReasonableContent =
    compact.length >= 24 &&
    words.length >= 5 &&
    /[\p{L}\p{N}]/u.test(compact);
  if (!hasUsefulAndReasonableContent) return { text: raw, changed: false, greeting: null };

  const greeting = 'Oi';
  return { text: `${greeting}! ${raw}`, changed: true, greeting };
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
      text: '',
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

  const sentences = splitSentences(base);
  const kept: string[] = [];
  let replaced = 0;
  for (const s of sentences) {
    const n = norm(s);
    if (!n) continue;
    const prohibited = prohibitedPatterns.some((re) => re.test(n));
    if (prohibited && !isAlreadyBrokerRedirect(n)) {
      replaced += 1;
      continue;
    }
    kept.push(s.trim());
  }

  if (replaced === 0) return { text: base, replacedFinancialSentences: 0 };
  if (kept.length === 0) {
    return {
      text: '',
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
  return { text: base, trimmedSentences: 0, removedQuestions: 0 };

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
  'Oi, tudo bem? Eu sou a Ana. Me diz qual informação você quer confirmar.',
];

const GREETING_REPLY_WITH_NAME = (name: string) => [
  `Oi, ${name}, tudo bem? Eu sou a Ana e posso te ajudar com as informações. O que você quer entender melhor primeiro?`,
  `Oi, ${name}. Me diz qual informação você quer confirmar.`,
];

/** Resposta acolhedora para saudação simples (sem chamar a API). */
export function pickRandomGreetingReply(knownCustomerName: string | null | undefined): string {
  void knownCustomerName;
  return '';
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





