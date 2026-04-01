import type { FileCategory } from '../repositories/enterpriseRepository.js';

/** Saudação isolada — não deve acionar fluxo de material. */
const BARE_GREETING_ONLY_RE =
  /^(oi|ol[aá]|olá|oie|hey|hi|hello|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|td\s+bem|eae|e\s+a[ií])\s*[!.?…]*$/iu;

export function isBareGreetingOnly(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return BARE_GREETING_ONLY_RE.test(t);
}

/**
 * Gate estrito de envio de arquivo.
 *
 * Requer combinação explícita de:
 *   • Verbo de envio (manda/envia/encaminha/passa/compartilha) + substantivo de material, OU
 *   • "quero (o/a) <material>" OU "preciso (do/da) <material>"
 *
 * NÃO dispara para:
 *   - pedidos de preço, parcelamento, localização, metragem, fotos genéricas
 *   - "quero saber mais" / "tem informações?"
 *   - substantivos de material isolados ("tem o book?", "qual a tabela?")
 *   - histórico de mensagens anteriores (só avalia a mensagem ATUAL)
 */

// Verbos de entrega/envio (formas conjugadas mais comuns em PT-BR)
const _SEND_VERBS =
  'mand(?:ar|a|e|ou)|envi(?:ar|a|e|ou)|encaminh(?:ar|a|e|ou)|pass(?:ar|a|e|ou)|compartilh(?:ar|a|e|ou)';

// Prefixo de modalidade: "pode", "poderia", "consegue", "tem como", "teria como"
const _MODAL = '(?:(?:pode(?:ria)?|consegue|tem\\s+como|teria\\s+como)\\s+)?';

// Destinatário explícito: "me ", "pra mim "
const _TARGET = '(?:me\\s+|pra\\s+mim\\s+)?';

// Artigos / determinantes opcionais entre verbo e substantivo
const _ARTICLE = '(?:\\s+(?:o|a|os|as|um|uma))?';

// Substantivos de material/documento (lista estrita — não inclui "valores", "preço", "fotos")
const _MATERIAL =
  '(?:book|pdf|material(?:is)?|material\\s+completo|cat[aá]logo|brochure|dossi[eê]|apresenta(?:c|ç)(?:a|ã)o|tabela(?:\\s+comercial)?|planilha|arquivo|documento|anexo)';

const EXPLICIT_MATERIAL_REQUEST_RE = new RegExp(
  '(?:' +
    // Padrão A: [modal?] [destinatário?] verbo [artigo?] material
    // ex.: "me manda o book", "pode enviar o pdf", "envia a tabela"
    `${_MODAL}${_TARGET}(?:${_SEND_VERBS})${_ARTICLE}\\s+${_MATERIAL}` +
    '|' +
    // Padrão B: "quero (o/a)? <material>"
    // ex.: "quero o book", "quero o pdf"
    `quero\\s+(?:o\\s+|a\\s+)?${_MATERIAL}` +
    '|' +
    // Padrão C: "preciso (do/da)? <material>"
    // ex.: "preciso do catálogo"
    `preciso\\s+(?:do\\s+|da\\s+)?${_MATERIAL}` +
  ')',
  'i',
);

export interface MaterialAskResult {
  /** true somente se a mensagem ATUAL contiver pedido explícito de envio de material */
  explicit: boolean;
  /** Qual padrão foi satisfeito (para debug/log) */
  matchedPattern: 'send_verb_plus_material' | 'want_material' | 'need_material' | null;
}

/**
 * Avalia APENAS a mensagem atual do usuário.
 * NÃO usa histórico acumulado — isso evitava disparar envio em todos os turnos
 * seguintes após qualquer pedido de "book/material" anterior.
 */
export function userExplicitlyAskedForMaterial(userText: string): MaterialAskResult {
  const t = (userText || '').trim();
  if (!t) return { explicit: false, matchedPattern: null };

  // Testar cada sub-padrão separadamente para identificar qual disparou
  const sendVerbRe = new RegExp(
    `(?:${_MODAL}${_TARGET}(?:${_SEND_VERBS})${_ARTICLE}\\s+${_MATERIAL})`,
    'i',
  );
  const wantRe = new RegExp(`(?:quero\\s+(?:o\\s+|a\\s+)?${_MATERIAL})`, 'i');
  const needRe = new RegExp(`(?:preciso\\s+(?:do\\s+|da\\s+)?${_MATERIAL})`, 'i');

  if (sendVerbRe.test(t)) return { explicit: true, matchedPattern: 'send_verb_plus_material' };
  if (wantRe.test(t)) return { explicit: true, matchedPattern: 'want_material' };
  if (needRe.test(t)) return { explicit: true, matchedPattern: 'need_material' };
  return { explicit: false, matchedPattern: null };
}

/**
 * Preferência de categoria a partir do texto ATUAL do cliente (não valida contra o estoque).
 * Usa apenas `userText` — histórico não participa da decisão de qual arquivo enviar.
 */
export function inferPreferredCategoryFromUserText(userText: string): FileCategory | null {
  const t = (userText || '').toLowerCase();
  if (/\b(planta|plantas|layout)\b/.test(t)) return 'unidades';
  if (/\b(tabela|pre[cç]o|pre[cç]os|valores|planilha)\b/.test(t)) return 'tabela_comercial';
  if (/\b(book|pdf|material|cat[aá]logo|brochure|dossi[eê]|apresenta[cç][aã]o|documento|arquivo|anexo)\b/.test(t))
    return 'book';
  return null;
}

export const DOC_CATEGORY_TRY_ORDER: readonly FileCategory[] = ['book', 'unidades', 'tabela_comercial', 'outro'] as const;

export function buildDocCategoryTryOrder(
  llmCategory: FileCategory | null,
  userHint: FileCategory | null,
  sendable: readonly FileCategory[]
): FileCategory[] {
  const ok = new Set(sendable);
  const out: FileCategory[] = [];
  const push = (c: FileCategory | null | undefined) => {
    if (!c || !ok.has(c) || out.includes(c)) return;
    out.push(c);
  };
  push(llmCategory);
  push(userHint);
  for (const c of DOC_CATEGORY_TRY_ORDER) push(c);
  return out;
}

const POST_MEDIA_ACK: readonly string[] = [
  'Perfeito, te enviei aqui.',
  'Claro, acabei de te mandar.',
  'Pronto, mandei para você.',
];

/** Texto curto após envio bem-sucedido de arquivo (evita repetir promessa longa do LLM). */
export function pickPostMediaAckText(lastAssistantMessage: string | null | undefined): string {
  const last = (lastAssistantMessage ?? '').trim().toLowerCase();
  for (const t of POST_MEDIA_ACK) {
    const prefix = t.slice(0, 14).toLowerCase();
    if (!last.includes(prefix)) return t;
  }
  return POST_MEDIA_ACK[0] ?? 'Perfeito, te enviei aqui.';
}
