import type { FileCategory } from '../repositories/enterpriseRepository.js';

/** Saudação isolada — não deve acionar fluxo de material. */
const BARE_GREETING_ONLY_RE =
  /^(oi|ol[aá]|olá|oie|hey|hi|hello|bom\s+dia|boa\s+tarde|boa\s+noite|tudo\s+bem|td\s+bem|eae|e\s+a[ií])\s*[!.?…]*$/iu;

export function isBareGreetingOnly(text: string): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  return BARE_GREETING_ONLY_RE.test(t);
}

/** Pedido explícito de material / arquivo (WhatsApp). */
const MATERIAL_ASK_RE =
  /\b(book|pdf|materia(l|is)|material\s+completo|cat[aá]logo|brochure|dossi[eê]|apresenta(c|ç)(a|ã)o|planta|plantas|layout|tabela(\s+comercial)?|precifica(c|ç)(a|ã)o|pre(c|ç)os?|valores|planilha|anexo|arquivo|documento|mand(ar|a)(\s+o)?\s+pdf|envi(ar|a)(\s+o)?\s+pdf|me\s+(manda|envia)|quero(\s+o)?\s+(pdf|book|material)|tem(\s+(o|a))?\s+(book|pdf|material|cat[aá]logo)|consegue(\s+te)?\s+(mandar|enviar))\b/i;

/**
 * Detecta se a mensagem ATUAL do usuário pede explicitamente um material/arquivo.
 *
 * IMPORTANTE: verifica apenas `userText` (a rajada atual), não o histórico completo.
 * Usar fullUtterances aqui causava falso positivo permanente: depois que o usuário
 * escrevia "me manda o book" uma vez, toda mensagem seguinte ("vamos agendar?",
 * "qual o preço?", etc.) também retornava true, fazendo shouldAttemptDocSend = true
 * para sempre e bloqueando respostas normais da Ana.
 */
export function userAskedForSendableMaterial(userText: string): boolean {
  return MATERIAL_ASK_RE.test((userText || '').trim());
}

function normBlob(userText: string, fullUtterances: string): string {
  return `${userText}\n${fullUtterances}`.toLowerCase();
}

/** Preferência de categoria a partir do texto do cliente (não valida contra o estoque). */
export function inferPreferredCategoryFromUserText(userText: string, fullUtterances: string): FileCategory | null {
  const blob = normBlob(userText, fullUtterances);
  if (/\b(planta|plantas|layout)\b/.test(blob)) return 'unidades';
  if (/\b(tabela|pre[cç]o|pre[cç]os|valores|planilha)\b/.test(blob)) return 'tabela_comercial';
  if (/\b(book|pdf|material|cat[aá]logo|brochure|dossi[eê]|apresenta[cç][aã]o|documento|arquivo|anexo)\b/.test(blob))
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
