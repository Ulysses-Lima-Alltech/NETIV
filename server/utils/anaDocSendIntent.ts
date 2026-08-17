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
  matchedPattern: 'send_verb_plus_material' | 'want_material' | 'need_material' | 'asks_if_available' | null;
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
  // "tem fotos?", "vocês têm book?", "possui planta?", "há fotos?" — pergunta
  // se existe material tende a ser, na prática, um pedido implícito de envio
  // (se a resposta é sim, o cliente quer ver). Tratado igual a explícito.
  const asksIfAvailableRe = new RegExp(
    `\\b(?:tem|t[eê]m|voc[eê]s?\\s+t[eê]m|possui(?:em)?|h[aá]|existe(?:m)?)\\b[^?]{0,25}${_MATERIAL}`,
    'i',
  );

  if (sendVerbRe.test(t)) return { explicit: true, matchedPattern: 'send_verb_plus_material' };
  if (wantRe.test(t)) return { explicit: true, matchedPattern: 'want_material' };
  if (needRe.test(t)) return { explicit: true, matchedPattern: 'need_material' };
  if (asksIfAvailableRe.test(t)) return { explicit: true, matchedPattern: 'asks_if_available' };
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
  if (/\b(foto|fotos|imagem|imagens)\b/.test(t)) return 'foto';
  if (/\b(video|videos)\b/.test(t)) return 'video';
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

export type AnaImageFilenameTopic =
  | 'piscina'
  | 'academia'
  | 'playground'
  | 'portaria'
  | 'fire_place'
  | 'salao_festas'
  | 'pet_place'
  | 'quadra_beach_tennis';

export type AnaSpecificMediaSpace =
  | AnaImageFilenameTopic
  | 'churrasqueira'
  | 'quadra'
  | 'area_lazer'
  | 'lote'
  | 'planta'
  | 'mapa_localizacao';

const IMAGE_FILENAME_TOPIC_KEYWORDS: Record<AnaImageFilenameTopic, readonly string[]> = {
  piscina: ['piscina', 'pool', 'solarium'],
  academia: ['academia', 'fitness', 'gym'],
  playground: ['playground', 'parquinho', 'infantil', 'crianca', 'criancas'],
  portaria: ['portaria', 'entrada', 'seguranca'],
  fire_place: ['fire place', 'fireplace', 'lareira', 'fogo'],
  salao_festas: ['salao', 'festas', 'espaco gourmet'],
  pet_place: ['pet', 'pet place'],
  quadra_beach_tennis: ['quadra', 'beach', 'tennis', 'beach tennis'],
};

const SPECIFIC_MEDIA_SPACE_KEYWORDS: Record<AnaSpecificMediaSpace, readonly string[]> = {
  piscina: ['piscina', 'pool', 'solarium'],
  academia: ['academia', 'fitness', 'gym'],
  playground: ['playground', 'parquinho', 'infantil', 'crianca', 'criancas'],
  portaria: ['portaria', 'entrada', 'seguranca'],
  fire_place: ['fire place', 'fireplace', 'lareira', 'fogo'],
  salao_festas: ['salao de festas', 'salao festas', 'salao', 'festas', 'espaco festas', 'espaco gourmet'],
  pet_place: ['pet place', 'pet'],
  quadra_beach_tennis: ['quadra beach tennis', 'beach tennis'],
  churrasqueira: ['churrasqueira', 'churrasco', 'area churrasco', 'espaco churrasco'],
  quadra: ['quadra', 'campo society', 'campo', 'society'],
  area_lazer: ['area de lazer', 'lazer'],
  lote: ['lote', 'lotes', 'terreno', 'terrenos'],
  planta: ['planta', 'plantas', 'floorplan', 'layout', 'implantacao'],
  mapa_localizacao: ['mapa', 'localizacao', 'localizacao exata', 'maps', 'google maps', 'rota'],
};

const SPECIFIC_MEDIA_SPACE_LABELS: Record<AnaSpecificMediaSpace, string> = {
  piscina: 'piscina',
  academia: 'academia',
  playground: 'playground',
  portaria: 'portaria',
  fire_place: 'fireplace',
  salao_festas: 'salão de festas',
  pet_place: 'pet place',
  quadra_beach_tennis: 'quadra de beach tennis',
  churrasqueira: 'churrasqueira',
  quadra: 'quadra',
  area_lazer: 'área de lazer',
  lote: 'lote',
  planta: 'planta',
  mapa_localizacao: 'mapa/localização',
};

const SPECIFIC_MEDIA_SPACE_ARTICLES: Record<AnaSpecificMediaSpace, 'da' | 'do'> = {
  piscina: 'da',
  academia: 'da',
  playground: 'do',
  portaria: 'da',
  fire_place: 'do',
  salao_festas: 'do',
  pet_place: 'do',
  quadra_beach_tennis: 'da',
  churrasqueira: 'da',
  quadra: 'da',
  area_lazer: 'da',
  lote: 'do',
  planta: 'da',
  mapa_localizacao: 'do',
};

const SPECIFIC_MEDIA_SPACE_DETECTION_ORDER: readonly AnaSpecificMediaSpace[] = [
  'quadra_beach_tennis',
  'salao_festas',
  'mapa_localizacao',
  'area_lazer',
  'churrasqueira',
  'piscina',
  'academia',
  'playground',
  'portaria',
  'fire_place',
  'pet_place',
  'quadra',
  'planta',
  'lote',
];

const MEDIA_REQUEST_WORD_RE =
  /\b(foto|fotos|imagem|imagens|galeria|video|videos|ver|mostrar|mostra|manda|mandar|mande|envia|enviar|envie)\b/;

const VISUAL_MEDIA_REQUEST_WORD_RE = /\b(foto|fotos|imagem|imagens|galeria|ver|mostrar|mostra)\b/;

export function normalizeAnaImageFilenameSearchText(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizedKeywordPattern(keyword: string): RegExp {
  const normalized = normalizeAnaImageFilenameSearchText(keyword);
  const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`);
}

export function extractAnaImageFilenameTopic(text: string | null | undefined): AnaImageFilenameTopic | null {
  const normalized = normalizeAnaImageFilenameSearchText(text);
  if (!normalized) return null;
  for (const [topic, keywords] of Object.entries(IMAGE_FILENAME_TOPIC_KEYWORDS)) {
    if (keywords.some((keyword) => normalizedKeywordPattern(keyword).test(normalized))) {
      return topic as AnaImageFilenameTopic;
    }
  }
  return null;
}

export function extractAnaSpecificMediaSpace(text: string | null | undefined): AnaSpecificMediaSpace | null {
  const normalized = normalizeAnaImageFilenameSearchText(text);
  if (!normalized) return null;
  for (const space of SPECIFIC_MEDIA_SPACE_DETECTION_ORDER) {
    const keywords = SPECIFIC_MEDIA_SPACE_KEYWORDS[space];
    if (keywords.some((keyword) => normalizedKeywordPattern(keyword).test(normalized))) {
      return space;
    }
  }
  return null;
}

export function formatAnaSpecificMediaSpaceLabel(space: AnaSpecificMediaSpace): string {
  return SPECIFIC_MEDIA_SPACE_LABELS[space] ?? space.replace(/_/g, ' ');
}

export function anaImageFilenameMatchesTopic(
  fileName: string | null | undefined,
  topic: AnaImageFilenameTopic | null
): boolean {
  if (!topic) return true;
  const normalized = normalizeAnaImageFilenameSearchText(fileName);
  if (!normalized) return false;
  return IMAGE_FILENAME_TOPIC_KEYWORDS[topic].some((keyword) => normalizedKeywordPattern(keyword).test(normalized));
}

export function anaMediaFilenameMatchesSpecificSpace(
  fileName: string | null | undefined,
  space: AnaSpecificMediaSpace | null
): boolean {
  if (!space) return true;
  const normalized = normalizeAnaImageFilenameSearchText(fileName);
  if (!normalized) return false;
  return SPECIFIC_MEDIA_SPACE_KEYWORDS[space].some((keyword) => normalizedKeywordPattern(keyword).test(normalized));
}

export function filterAnaImageFilesByFilenameTopic<T extends { originalName?: string | null; relativeStoragePath?: string | null }>(
  files: readonly T[],
  topic: AnaImageFilenameTopic | null
): T[] {
  if (!topic) return [...files];
  return files.filter((file) =>
    anaImageFilenameMatchesTopic(`${file.originalName ?? ''} ${file.relativeStoragePath ?? ''}`, topic)
  );
}

export function filterAnaMediaFilesBySpecificSpace<T extends { originalName?: string | null; relativeStoragePath?: string | null }>(
  files: readonly T[],
  space: AnaSpecificMediaSpace | null
): T[] {
  if (!space) return [...files];
  return files.filter((file) =>
    anaMediaFilenameMatchesSpecificSpace(`${file.originalName ?? ''} ${file.relativeStoragePath ?? ''}`, space)
  );
}

export function listAnaSpecificMediaSpacesAvailableFromFiles<T extends { originalName?: string | null; relativeStoragePath?: string | null }>(
  files: readonly T[],
  limit = 4
): AnaSpecificMediaSpace[] {
  const out: AnaSpecificMediaSpace[] = [];
  for (const space of SPECIFIC_MEDIA_SPACE_DETECTION_ORDER) {
    if (out.length >= Math.max(1, limit)) break;
    if (files.some((file) => anaMediaFilenameMatchesSpecificSpace(`${file.originalName ?? ''} ${file.relativeStoragePath ?? ''}`, space))) {
      out.push(space);
    }
  }
  return out;
}

function joinPtList(items: readonly string[]): string {
  const unique = items.map((item) => item.trim()).filter(Boolean);
  if (unique.length === 0) return '';
  if (unique.length === 1) return unique[0]!;
  if (unique.length === 2) return `${unique[0]} e ${unique[1]}`;
  return `${unique.slice(0, -1).join(', ')} e ${unique[unique.length - 1]}`;
}

export function buildAnaSpecificMediaUnavailableReply(params: {
  requestedSpace: AnaSpecificMediaSpace;
  mediaKind: 'foto' | 'video';
  enterpriseName?: string | null;
  availableSpaces?: readonly AnaSpecificMediaSpace[];
}): string {
  const spaceLabel = formatAnaSpecificMediaSpaceLabel(params.requestedSpace);
  const mediaPlural = params.mediaKind === 'video' ? 'vídeos' : 'fotos';
  const article = SPECIFIC_MEDIA_SPACE_ARTICLES[params.requestedSpace];
  const requestedWithArticle = `${article} ${spaceLabel}`;
  const unavailablePhrase =
    params.mediaKind === 'video'
      ? `vídeos específicos ${requestedWithArticle} cadastrados`
      : `fotos específicas ${requestedWithArticle} cadastradas`;
  const availableLabels = (params.availableSpaces ?? [])
    .filter((space) => space !== params.requestedSpace)
    .map(formatAnaSpecificMediaSpaceLabel);
  const enterprise = String(params.enterpriseName ?? '').trim();
  const enterpriseSuffix = enterprise ? ` do ${enterprise}` : '';

  if (availableLabels.length > 0) {
    return `No momento eu não tenho ${unavailablePhrase} aqui. Tenho ${mediaPlural} de outros espaços${enterpriseSuffix}, como ${joinPtList(
      availableLabels
    )}. Quer que eu te envie alguma dessas ou prefere que eu peça para a equipe te mandar as ${mediaPlural} ${requestedWithArticle}?`;
  }

  return `No momento eu não tenho ${unavailablePhrase} aqui. Prefere que eu peça para a equipe te mandar as ${mediaPlural} ${requestedWithArticle}?`;
}

export function userAskedForSpecificImageFilenameTopic(userText: string): boolean {
  const topic = extractAnaImageFilenameTopic(userText);
  if (!topic) return false;
  const normalized = normalizeAnaImageFilenameSearchText(userText);
  return /\b(foto|fotos|imagem|imagens|galeria|ver|mostrar|mostra|manda|mandar|mande|envia|enviar|envie)\b/.test(
    normalized
  );
}

export function userAskedForSpecificMediaSpace(userText: string): boolean {
  const space = extractAnaSpecificMediaSpace(userText);
  if (!space) return false;
  const normalized = normalizeAnaImageFilenameSearchText(userText);
  if (space === 'planta' || space === 'mapa_localizacao') {
    return VISUAL_MEDIA_REQUEST_WORD_RE.test(normalized);
  }
  return MEDIA_REQUEST_WORD_RE.test(normalized);
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
