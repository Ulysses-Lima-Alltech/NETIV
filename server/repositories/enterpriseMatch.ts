import { listEnterprises, type EnterpriseRow } from './enterpriseRepository.js';

export function normEnterpriseMatchText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palavras genéricas no nome do empreendimento — não bastam sozinhas para match (evita falso positivo). */
const GENERIC_NAME_TOKENS = new Set([
  'residencial',
  'loteamento',
  'loteamentos',
  'parque',
  'condominio',
  'fase',
  'torre',
  'bloco',
  'edf',
  'edificio',
  'empreendimento',
  'jardim',
  'village',
  'park',
  'club',
]);

/**
 * Pontuação de menção ao empreendimento no texto (quanto maior, mais confiante).
 * - Nome ou slug completo contido no texto: peso alto.
 * - Palavras distintivas do nome (≥3 chars) contidas no texto: peso médio; ignora tokens genéricos se houver outras palavras no nome.
 */
export function scoreEnterpriseMentionInText(enterprise: EnterpriseRow, textNorm: string): number {
  const lower = textNorm;
  if (!lower) return 0;
  const n = normEnterpriseMatchText(enterprise.name);
  const sl = normEnterpriseMatchText(enterprise.slug || '');
  let score = 0;
  if (n.length >= 3 && lower.includes(n)) score = Math.max(score, 1000 + n.length);
  if (sl.length >= 3 && lower.includes(sl)) score = Math.max(score, 950 + sl.length);

  const words = n.split(/\s+/).filter((w) => w.length >= 3);
  for (const w of words) {
    if (GENERIC_NAME_TOKENS.has(w) && words.length > 1) continue;
    if (lower.includes(w)) score = Math.max(score, 100 + w.length * 10);
  }
  return score;
}

/**
 * Melhor empreendimento mencionado no texto; empate em 1º lugar → null (ambíguo).
 * Não consulta o banco — usa a lista passada (ex.: já filtrada por tipo).
 */
export function tryMatchEnterpriseFromUserCorpus(userText: string, enterprises: EnterpriseRow[]): number | null {
  const lower = normEnterpriseMatchText(userText);
  if (!lower || enterprises.length === 0) return null;

  let bestScore = 0;
  const tops: number[] = [];

  for (const p of enterprises) {
    const s = scoreEnterpriseMentionInText(p, lower);
    if (s <= 0) continue;
    if (s > bestScore) {
      bestScore = s;
      tops.length = 0;
      tops.push(p.id);
    } else if (s === bestScore) {
      tops.push(p.id);
    }
  }

  if (bestScore === 0 || tops.length !== 1) return null;
  return tops[0]!;
}

/** Diagnóstico para logs: como o match único foi obtido (nome completo vs slug no texto). */
export function explainEnterpriseMentionMatch(
  userText: string,
  enterprises: EnterpriseRow[],
  matchedId: number | null
): { matchedByName: boolean; matchedBySlug: boolean; bestEnterpriseName: string | null } {
  if (matchedId == null) {
    return { matchedByName: false, matchedBySlug: false, bestEnterpriseName: null };
  }
  const e = enterprises.find((x) => x.id === matchedId);
  if (!e) return { matchedByName: false, matchedBySlug: false, bestEnterpriseName: null };
  const lower = normEnterpriseMatchText(userText);
  const n = normEnterpriseMatchText(e.name);
  const sl = normEnterpriseMatchText(e.slug || '');
  const matchedByName = n.length >= 3 && lower.includes(n);
  const matchedBySlug = sl.length >= 3 && lower.includes(sl);
  return { matchedByName, matchedBySlug, bestEnterpriseName: e.name };
}

/**
 * Sinal forte o suficiente na mensagem atual para trocar foco sem depender de explicitSwitch
 * (nome/slug inteiro, ou mensagem curta com token distintivo do empreendimento).
 */
export function enterpriseHasStrongNameSignalInTrimmed(
  enterpriseId: number,
  userTrimmed: string,
  enterprises: EnterpriseRow[]
): boolean {
  const e = enterprises.find((x) => x.id === enterpriseId);
  if (!e) return false;
  const t = normEnterpriseMatchText(userTrimmed);
  if (!t) return false;
  const s = scoreEnterpriseMentionInText(e, t);
  if (s >= 1000) return true;
  if (t.length <= 56 && s >= 130) return true;
  return false;
}

/** Nomes exibidos após 📍 na última listagem da Ana (catálogo). */
export function extractCatalogEnterpriseNamesFromAssistantReply(assistantText: string): string[] {
  const t = assistantText || '';
  const names: string[] = [];
  const re = /📍\s*([^\n\r]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const raw = (m[1] || '').trim();
    if (raw.length >= 2) names.push(raw.replace(/\s+/g, ' ').trim());
  }
  return names;
}

const ANAPHORA_START =
  /^\s*(esse|essa|este|esta|esse\s+ai|esse\s+aí|esse\s+mesmo|esse\s+da[ií]|esse\s+projeto|quero\s+esse|quero\s+essa|ele|ela)\b/i;

/**
 * "Quero esse" / "esse aí" quando a Ana listou um único nome com 📍 na mensagem anterior.
 */
export function tryMatchEnterpriseAnaphora(
  userMessage: string,
  lastAssistantPlainText: string,
  enterprises: EnterpriseRow[]
): number | null {
  const u = (userMessage || '').trim();
  if (!u || !ANAPHORA_START.test(u)) return null;
  const listed = extractCatalogEnterpriseNamesFromAssistantReply(lastAssistantPlainText);
  if (listed.length !== 1) return null;
  return tryMatchEnterpriseFromUserCorpus(listed[0]!, enterprises);
}

const PRONOUN_IN_MESSAGE =
  /\b(ele|ela|esse|essa|neste|nesta|nesse|nessa|dele|dela|com\s+ele|com\s+ela|sobre\s+ele|sobre\s+ela)\b/i;

/**
 * "Me fale mais sobre ele" após listagem com um único 📍 — pronomes no meio/fim da frase.
 */
export function tryMatchEnterprisePronounAfterCatalog(
  userMessage: string,
  lastAssistantPlainText: string,
  enterprises: EnterpriseRow[]
): number | null {
  const u = (userMessage || '').trim();
  if (!u || !PRONOUN_IN_MESSAGE.test(u)) return null;
  const listed = extractCatalogEnterpriseNamesFromAssistantReply(lastAssistantPlainText);
  if (listed.length !== 1) return null;
  return tryMatchEnterpriseFromUserCorpus(listed[0]!, enterprises);
}

/**
 * "O primeiro" / "o segundo" após listagem com 📍 (ordem = ordem de aparição no texto).
 */
export function tryMatchEnterpriseOrdinalFromCatalog(
  userMessage: string,
  lastAssistantPlainText: string,
  enterprises: EnterpriseRow[]
): number | null {
  const u = normEnterpriseMatchText(userMessage);
  if (!u) return null;
  const listed = extractCatalogEnterpriseNamesFromAssistantReply(lastAssistantPlainText);
  if (listed.length < 2) return null;

  let idx = -1;
  if (/\b(o|a)\s+primeir[oa]\b|\bnumero\s*1\b|\bnúmero\s*1\b|\b1o\b|\b1º\b/.test(u)) idx = 0;
  else if (/\bsegund[oa]\b|\bnumero\s*2\b|\bnúmero\s*2\b|\b2o\b|\b2º\b|\bo\s+2\b/.test(u)) idx = 1;
  else if (/\bterceir[oa]\b|\bnumero\s*3\b|\bnúmero\s*3\b/.test(u)) idx = 2;
  if (idx < 0 || idx >= listed.length) return null;

  return tryMatchEnterpriseFromUserCorpus(listed[idx]!, enterprises);
}

export async function tryMatchActiveEnterpriseId(userMessage: string): Promise<number | null> {
  const active = await listEnterprises(true);
  return tryMatchEnterpriseFromUserCorpus(userMessage, active);
}
