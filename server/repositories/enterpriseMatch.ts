import { query } from '../db/pg.js';
import { listEnterprises, type EnterpriseRow } from './enterpriseRepository.js';

export function normEnterpriseMatchText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type EnterpriseResolutionSource =
  | 'message_alias'
  | 'conversation'
  | 'campaign'
  | 'contact'
  | 'unresolved'
  | 'ambiguous';

export interface EnterpriseResolutionCandidate {
  enterpriseId: number;
  enterpriseName: string;
  matchedAliases: string[];
}

export interface EnterpriseMessageAliasResolution {
  source: 'message_alias' | 'unresolved' | 'ambiguous';
  enterpriseId: number | null;
  enterpriseName: string | null;
  candidates: EnterpriseResolutionCandidate[];
  reasonWhenNoEnterprise: string | null;
}

export interface AnaEnterpriseResolution {
  source: EnterpriseResolutionSource;
  enterpriseId: number | null;
  enterpriseName: string | null;
  candidates: EnterpriseResolutionCandidate[];
  reasonWhenNoEnterprise: string | null;
}

interface EnterpriseAliasRow {
  enterprise_id: number;
  alias: string;
  normalized_alias: string | null;
}

interface EnterpriseAliasCandidate {
  enterpriseId: number;
  enterpriseName: string;
  alias: string;
  normalizedAlias: string;
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

const GENERIC_ALIAS_TOKENS = new Set([
  ...GENERIC_NAME_TOKENS,
  'condominio',
  'condominios',
  'lote',
  'lotes',
  'terreno',
  'terrenos',
  'apartamento',
  'apartamentos',
  'unidade',
  'unidades',
  'pirituba',
]);

const VARIANT_NAME_TOKENS = new Set([
  'fase',
  'torre',
  'bloco',
  'quadra',
  'etapa',
  'modulo',
  'modulos',
  'ala',
  'setor',
]);

const MESSAGE_STOPWORDS = new Set([
  'o',
  'a',
  'os',
  'as',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'no',
  'na',
  'nos',
  'nas',
  'em',
  'sobre',
  'quero',
  'saber',
  'informacoes',
  'informacao',
  'me',
  'fale',
  'fala',
  'tem',
  'empreendimento',
  'residencial',
  'condominio',
]);

export function normalizeEnterpriseAliasText(input: string): string {
  return normEnterpriseMatchText(input);
}

function isGenericEnterpriseAlias(normalizedAlias: string): boolean {
  const words = normalizedAlias.split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  return words.every((word) => GENERIC_ALIAS_TOKENS.has(word));
}

function addAliasCandidate(
  target: EnterpriseAliasCandidate[],
  seen: Set<string>,
  enterprise: EnterpriseRow,
  alias: string
): void {
  const normalizedAlias = normalizeEnterpriseAliasText(alias);
  if (normalizedAlias.length < 3) return;
  if (isGenericEnterpriseAlias(normalizedAlias)) return;
  const key = `${enterprise.id}:${normalizedAlias}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push({
    enterpriseId: enterprise.id,
    enterpriseName: enterprise.name,
    alias: alias.trim(),
    normalizedAlias,
  });
}

function firstDistinctiveNameToken(enterpriseName: string): string | null {
  const tokens = normalizeEnterpriseAliasText(enterpriseName).split(/\s+/).filter(Boolean);
  return tokens.find((token) => token.length >= 3 && !GENERIC_ALIAS_TOKENS.has(token)) ?? null;
}

function buildAliasCandidates(
  enterprises: EnterpriseRow[],
  aliasRows: EnterpriseAliasRow[]
): EnterpriseAliasCandidate[] {
  const byEnterprise = new Map<number, EnterpriseRow>();
  for (const enterprise of enterprises) byEnterprise.set(enterprise.id, enterprise);

  const out: EnterpriseAliasCandidate[] = [];
  const seen = new Set<string>();
  for (const enterprise of enterprises) {
    addAliasCandidate(out, seen, enterprise, enterprise.name);
    addAliasCandidate(out, seen, enterprise, enterprise.slug || '');
    const firstToken = firstDistinctiveNameToken(enterprise.name);
    if (firstToken) addAliasCandidate(out, seen, enterprise, firstToken);
  }
  for (const row of aliasRows) {
    const enterprise = byEnterprise.get(row.enterprise_id);
    if (!enterprise) continue;
    addAliasCandidate(out, seen, enterprise, row.alias || row.normalized_alias || '');
  }
  return out;
}

export async function listEnterpriseAliasRowsForActiveEnterprises(
  enterpriseIds: number[]
): Promise<EnterpriseAliasRow[]> {
  if (enterpriseIds.length === 0) return [];
  try {
    const { rows } = await query<EnterpriseAliasRow>(
      `SELECT enterprise_id, alias, normalized_alias
       FROM enterprise_aliases
       WHERE enterprise_id = ANY($1::int[])`,
      [enterpriseIds]
    );
    return rows;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/enterprise_aliases/i.test(message)) return [];
    throw error;
  }
}

function aliasAppearsInMessage(messageNorm: string, aliasNorm: string): boolean {
  if (!messageNorm || !aliasNorm) return false;
  const escaped = aliasNorm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(messageNorm);
}

export function resolveEnterpriseFromMessageAliases(
  userMessage: string,
  enterprises: EnterpriseRow[],
  aliasRows: EnterpriseAliasRow[] = []
): EnterpriseMessageAliasResolution {
  const messageNorm = normalizeEnterpriseAliasText(userMessage);
  if (!messageNorm || enterprises.length === 0) {
    return {
      source: 'unresolved',
      enterpriseId: null,
      enterpriseName: null,
      candidates: [],
      reasonWhenNoEnterprise: 'message_without_enterprise_alias',
    };
  }

  const candidatesByEnterprise = new Map<number, EnterpriseResolutionCandidate>();
  for (const aliasCandidate of buildAliasCandidates(enterprises, aliasRows)) {
    if (!aliasAppearsInMessage(messageNorm, aliasCandidate.normalizedAlias)) continue;
    const current = candidatesByEnterprise.get(aliasCandidate.enterpriseId);
    if (current) {
      if (!current.matchedAliases.includes(aliasCandidate.alias)) {
        current.matchedAliases.push(aliasCandidate.alias);
      }
      continue;
    }
    candidatesByEnterprise.set(aliasCandidate.enterpriseId, {
      enterpriseId: aliasCandidate.enterpriseId,
      enterpriseName: aliasCandidate.enterpriseName,
      matchedAliases: [aliasCandidate.alias],
    });
  }

  const candidates = Array.from(candidatesByEnterprise.values()).sort((a, b) =>
    a.enterpriseName.localeCompare(b.enterpriseName, 'pt-BR')
  );
  if (candidates.length === 1) {
    const only = candidates[0]!;
    return {
      source: 'message_alias',
      enterpriseId: only.enterpriseId,
      enterpriseName: only.enterpriseName,
      candidates,
      reasonWhenNoEnterprise: null,
    };
  }
  if (candidates.length > 1) {
    return {
      source: 'ambiguous',
      enterpriseId: null,
      enterpriseName: null,
      candidates,
      reasonWhenNoEnterprise: 'message_alias_ambiguous',
    };
  }
  return {
    source: 'unresolved',
    enterpriseId: null,
    enterpriseName: null,
    candidates: [],
    reasonWhenNoEnterprise: 'message_without_enterprise_alias',
  };
}

export async function resolveEnterpriseForAnaTurn(params: {
  userMessage: string;
  activeEnterprises: EnterpriseRow[];
  conversationEnterpriseId?: number | null;
  campaignEnterpriseId?: number | null;
  contactEnterpriseId?: number | null;
}): Promise<AnaEnterpriseResolution> {
  const activeById = new Map(params.activeEnterprises.map((enterprise) => [enterprise.id, enterprise]));
  const aliasRows = await listEnterpriseAliasRowsForActiveEnterprises(params.activeEnterprises.map((e) => e.id));
  const messageResolution = resolveEnterpriseFromMessageAliases(
    params.userMessage,
    params.activeEnterprises,
    aliasRows
  );
  if (messageResolution.source !== 'unresolved') return messageResolution;

  const fromConversation =
    params.conversationEnterpriseId != null ? activeById.get(params.conversationEnterpriseId) ?? null : null;
  if (fromConversation) {
    return {
      source: 'conversation',
      enterpriseId: fromConversation.id,
      enterpriseName: fromConversation.name,
      candidates: [],
      reasonWhenNoEnterprise: null,
    };
  }

  const fromContact =
    params.contactEnterpriseId != null ? activeById.get(params.contactEnterpriseId) ?? null : null;
  if (fromContact) {
    return {
      source: 'contact',
      enterpriseId: fromContact.id,
      enterpriseName: fromContact.name,
      candidates: [],
      reasonWhenNoEnterprise: null,
    };
  }

  const fromCampaign =
    params.campaignEnterpriseId != null ? activeById.get(params.campaignEnterpriseId) ?? null : null;
  if (fromCampaign) {
    return {
      source: 'campaign',
      enterpriseId: fromCampaign.id,
      enterpriseName: fromCampaign.name,
      candidates: [],
      reasonWhenNoEnterprise: null,
    };
  }

  return {
    source: 'unresolved',
    enterpriseId: null,
    enterpriseName: null,
    candidates: [],
    reasonWhenNoEnterprise: 'no_enterprise_resolved_from_message_conversation_campaign_or_contact',
  };
}

function hasVariantMarker(nameNorm: string): boolean {
  const words = nameNorm.split(/\s+/).filter(Boolean);
  for (const w of words) {
    if (VARIANT_NAME_TOKENS.has(w)) return true;
    if (/^\d+$/.test(w)) return true;
  }
  return false;
}

/**
 * Desempate conservador:
 * - só atua em consulta curta com 1 token distintivo (ex.: "evora");
 * - e quando existe exatamente um "nome-base" sem marcador de variante
 *   (enquanto os demais empatados são variantes tipo "Fase 2").
 */
function breakEnterpriseMentionTie(
  userTextNorm: string,
  enterprises: EnterpriseRow[],
  topIds: number[]
): number | null {
  const msgTokens = userTextNorm
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 3 && !MESSAGE_STOPWORDS.has(w));
  const uniqueMsgTokens = Array.from(new Set(msgTokens));
  if (uniqueMsgTokens.length !== 1) return null;

  const token = uniqueMsgTokens[0]!;
  const candidates = topIds
    .map((id) => enterprises.find((e) => e.id === id))
    .filter((e): e is EnterpriseRow => !!e);
  if (candidates.length <= 1) return null;

  const tokenCandidates = candidates.filter((e) =>
    normEnterpriseMatchText(`${e.name} ${e.slug || ''}`).split(/\s+/).includes(token)
  );
  if (tokenCandidates.length <= 1) return null;

  const base = tokenCandidates.filter((e) => !hasVariantMarker(normEnterpriseMatchText(e.name)));
  const variants = tokenCandidates.filter((e) => hasVariantMarker(normEnterpriseMatchText(e.name)));
  if (base.length === 1 && variants.length >= 1) {
    return base[0]!.id;
  }
  return null;
}

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

  if (bestScore === 0) return null;
  if (tops.length !== 1) {
    return breakEnterpriseMentionTie(lower, enterprises, tops);
  }
  return tops[0]!;
}

export function debugEnterpriseMentionScores(
  userText: string,
  enterprises: EnterpriseRow[],
  topN = 5
): Array<{ id: number; name: string; slug: string; score: number }> {
  const lower = normEnterpriseMatchText(userText);
  if (!lower) return [];
  return enterprises
    .map((e) => ({
      id: e.id,
      name: e.name,
      slug: e.slug || '',
      score: scoreEnterpriseMentionInText(e, lower),
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, topN));
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
