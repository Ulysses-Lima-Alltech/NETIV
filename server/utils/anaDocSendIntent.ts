import type { FileCategory } from '../repositories/enterpriseRepository.js';

/** Greeting-only message must not trigger material send flow. */
const BARE_GREETING_ONLY_RE =
  /^(oi|ol[aá]|oie|hey|hi|hello|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|td\s+bem|eae|e\s+a[ií])\s*[!.?…]*$/iu;

export function isBareGreetingOnly(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return BARE_GREETING_ONLY_RE.test(t);
}

// Common PT-BR send verbs.
const _SEND_VERBS =
  'mand(?:ar|a|e|ou)|envi(?:ar|a|e|ou)|encaminh(?:ar|a|e|ou)|pass(?:ar|a|e|ou)|compartilh(?:ar|a|e|ou)';

// Optional modal prefix: "pode", "poderia", "consegue", "tem como".
const _MODAL = '(?:(?:pode(?:ria)?|consegue|tem\\s+como|teria\\s+como)\\s+)?';

// Explicit target pronouns.
const _TARGET = '(?:me\\s+|pra\\s+mim\\s+)?';

// Optional article between verb and noun.
const _ARTICLE = '(?:\\s+(?:o|a|os|as|um|uma))?';

// Material/document nouns.
const _MATERIAL =
  '(?:book|ebook|pdf|cat[aá]logo|brochure|dossi[eê]|apresenta(?:c|ç)(?:a|ã)o|tabela(?:\\s+comercial)?|planilha|arquivo|documento|anexo|foto(?:s)?|imagem(?:ens)?|planta(?:s)?|layout|implantac[aã]o|v[ií]deo(?:s)?)';

const _MATERIAL_TOPIC_RE =
  /\b(book|ebook|pdf|material(?:is)?|cat[aá]logo|brochure|dossi[eê]|apresenta[cç][aã]o|planta|plantas?|implantac[aã]o|layout|tabela(?:\s+comercial)?|planilha|arquivo|documento|anexo|foto(?:s)?|imagem(?:ens)?|v[ií]deo(?:s)?)\b/i;

const _FOLLOWUP_MATERIAL_COMMAND_RE =
  /^(?:(?:me\s+manda|me\s+mande|manda\s+pra\s+mim|manda\s+pra\s+gente|me\s+envia|me\s+envie|me\s+passa|me\s+passe|passa\s+pra\s+mim|passe\s+pra\s+mim|pode\s+enviar|pode\s+me\s+enviar|pode\s+me\s+mandar|pode\s+me\s+passar)\s+(?:o\s+|a\s+)?(?:book|pdf|catalogo|catálogo|folder|tabela|planilha|arquivo|documento|anexo|foto|fotos|imagem|imagens|planta|plantas|video|vídeo|videos|vídeos)|quero\s+o\s+material|quero\s+material)\b/i;

export interface MaterialAskResult {
  /** true only when the current message asks explicit send intent. */
  explicit: boolean;
  matchedPattern: 'send_verb_plus_material' | 'want_material' | 'need_material' | null;
}

/**
 * Evaluate only current user message.
 */
export function userExplicitlyAskedForMaterial(userText: string): MaterialAskResult {
  const t = (userText || '').trim();
  if (!t) return { explicit: false, matchedPattern: null };

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

/** Short follow-up command ("me mande", "envie", "quero o material"). */
export function isFollowupMaterialCommand(userText: string): boolean {
  const t = (userText || '').trim();
  if (!t) return false;
  return _FOLLOWUP_MATERIAL_COMMAND_RE.test(t);
}

/** Current message mentions material topic (book/planta/tabela etc). */
export function userAskedAboutMaterialTopic(userText: string): boolean {
  const t = (userText || '').trim();
  if (!t) return false;
  return _MATERIAL_TOPIC_RE.test(t);
}

/**
 * Infer preferred category from current user text (without inventory validation).
 */
export function inferPreferredCategoryFromUserText(userText: string): FileCategory | null {
  const t = (userText || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (/\b(planta|plantas?|layout|implantacao)\b/.test(t)) return 'unidades';
  if (/\b(foto|fotos|imagem|imagens|video|videos)\b/.test(t)) return 'outro';
  // Ana não envia tabela comercial diretamente: pedido de tabela deve cair em oferta textual/book.
  if (/\b(tabela|preco|precos|valor|valores|planilha)\b/.test(t)) return 'book';
  if (
    /\b(book|ebook|pdf|material|catalogo|brochure|dossie|apresentacao|documento|arquivo|anexo)\b/.test(
      t
    )
  ) {
    return 'book';
  }
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
  'Pronto, mandei para voce.',
];

/** Short post-send ack after successful media send. */
export function pickPostMediaAckText(lastAssistantMessage: string | null | undefined): string {
  const last = (lastAssistantMessage ?? '').trim().toLowerCase();
  for (const t of POST_MEDIA_ACK) {
    const prefix = t.slice(0, 14).toLowerCase();
    if (!last.includes(prefix)) return t;
  }
  return POST_MEDIA_ACK[0] ?? 'Perfeito, te enviei aqui.';
}
