import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';

/** Resultado da validação da resposta da ANA antes do envio ao WhatsApp. */
export interface AnaReplyGuardResult {
  ok: boolean;
  /** Motivo técnico interno (log). */
  reason?: string;
  /** Trecho que disparou o bloqueio (log / auditoria). */
  suspiciousSnippet?: string;
  /** Texto seguro quando ok === false. */
  safeReply?: string;
}

export interface AnaReplyGuardInput {
  conversationId: number;
  reply: string;
  knowledgeText: string;
  variablesMap: Record<string, string>;
  activeEnterprise: EnterpriseRow | null;
  /** Empreendimento de origem (pode estar inativo). */
  originEnterprise: EnterpriseRow | null;
  userMessage: string;
  /** Últimas mensagens do usuário (histórico + atual), só texto. */
  recentUserMessages: string[];
  /** Todos os empreendimentos ativos (cadastro real). */
  allActiveEnterprises: EnterpriseRow[];
}

function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Nome curto: exige limite de palavra no texto original para evitar falso match. */
function wholeWordInText(originalText: string, needle: string): boolean {
  const n = normalizeForMatch(needle);
  if (n.length < 4) return false;
  try {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(n)}([^\\p{L}\\p{N}]|$)`, 'iu');
    return re.test(originalText);
  } catch {
    return originalText.toLowerCase().includes(n);
  }
}

/**
 * Nome “longo”: permitir substring normalizada (empreendimentos compostos).
 * Nome curto: só palavra inteira.
 */
function enterpriseNameAppearsInText(originalText: string, name: string): boolean {
  const nameN = normalizeForMatch(name);
  if (nameN.length < 3) return false;
  const textN = normalizeForMatch(originalText);
  if (nameN.length >= 8) return textN.includes(nameN);
  return wholeWordInText(originalText, name);
}

function enterpriseSlugAppearsInText(originalText: string, slug: string): boolean {
  const s = (slug || '').trim();
  if (s.length < 4) return false;
  const sn = normalizeForMatch(s);
  if (sn.length >= 6) return normalizeForMatch(originalText).includes(sn);
  return wholeWordInText(originalText, s);
}

/**
 * Allowlist de IDs de empreendimento cujo nome pode aparecer na resposta.
 * Fontes: ativo, origem, nome presente no knowledgeText, nome citado pelo cliente (cadastro real).
 */
function buildAllowlistedEnterpriseIdSet(input: {
  knowledgeText: string;
  activeEnterprise: EnterpriseRow | null;
  originEnterprise: EnterpriseRow | null;
  userMessage: string;
  recentUserMessages: string[];
  allActiveEnterprises: EnterpriseRow[];
}): Set<number> {
  const allowed = new Set<number>();
  const { knowledgeText, activeEnterprise, originEnterprise, userMessage, recentUserMessages, allActiveEnterprises } =
    input;

  if (activeEnterprise) allowed.add(activeEnterprise.id);
  if (originEnterprise) allowed.add(originEnterprise.id);

  const know = knowledgeText || '';
  const knowNorm = normalizeForMatch(know);
  const userBlob = [userMessage, ...recentUserMessages].join('\n');

  for (const e of allActiveEnterprises) {
    if (knowNorm.length > 0) {
      if (enterpriseNameAppearsInText(know, e.name)) allowed.add(e.id);
      if (e.slug && enterpriseSlugAppearsInText(know, e.slug)) allowed.add(e.id);
    }
    if (enterpriseNameAppearsInText(userBlob, e.name)) allowed.add(e.id);
    if (e.slug && enterpriseSlugAppearsInText(userBlob, e.slug)) allowed.add(e.id);
  }

  return allowed;
}

/** Lista legível dos empreendimentos permitidos no contexto (ids + nomes cadastrados). */
export function extractAllowedEnterpriseNames(input: {
  knowledgeText: string;
  activeEnterprise: EnterpriseRow | null;
  originEnterprise: EnterpriseRow | null;
  userMessage: string;
  recentUserMessages: string[];
  allActiveEnterprises: EnterpriseRow[];
}): { id: number; name: string }[] {
  const ids = buildAllowlistedEnterpriseIdSet(input);
  const out = input.allActiveEnterprises.filter((e) => ids.has(e.id)).map((e) => ({ id: e.id, name: e.name }));
  const seen = new Set(out.map((x) => x.id));
  if (input.activeEnterprise && ids.has(input.activeEnterprise.id) && !seen.has(input.activeEnterprise.id)) {
    out.push({ id: input.activeEnterprise.id, name: input.activeEnterprise.name });
    seen.add(input.activeEnterprise.id);
  }
  if (input.originEnterprise && ids.has(input.originEnterprise.id) && !seen.has(input.originEnterprise.id)) {
    out.push({ id: input.originEnterprise.id, name: input.originEnterprise.name });
  }
  return out;
}

/** Texto de contexto para checar endereço (conhecimento + variáveis + falas do cliente + nomes permitidos). */
export function buildContextBlobForAddressCheck(input: {
  knowledgeText: string;
  variablesMap: Record<string, string>;
  activeEnterprise: EnterpriseRow | null;
  originEnterprise: EnterpriseRow | null;
  recentUserMessages: string[];
  userMessage: string;
  allowedEnterpriseIds: Set<number>;
  allActiveEnterprises: EnterpriseRow[];
}): string {
  const parts: string[] = [];
  parts.push(input.knowledgeText || '');
  for (const k of ['preco', 'condicoes', 'disponibilidade', 'observacoes'] as const) {
    parts.push(input.variablesMap[k]?.trim() || '');
  }
  parts.push(input.userMessage);
  parts.push(...input.recentUserMessages);
  if (input.activeEnterprise) {
    parts.push(input.activeEnterprise.name);
    parts.push(input.activeEnterprise.slug || '');
  }
  if (input.originEnterprise) {
    parts.push(input.originEnterprise.name);
    parts.push(input.originEnterprise.slug || '');
  }
  for (const e of input.allActiveEnterprises) {
    if (input.allowedEnterpriseIds.has(e.id)) {
      parts.push(e.name);
      if (e.slug) parts.push(e.slug);
    }
  }
  return parts.filter(Boolean).join('\n');
}

/** Padrões conservadores de endereço/localização específica. */
const CEP_RE = /\b\d{5}\s*-\s*\d{3}\b/g;

const STREET_WITH_NUMBER_RE =
  /\b(rua|avenida|av\.|alameda|rodovia|estrada|travessa|trav\.|rod\.|via)\s+[\p{L}0-9\s.'º°-]{2,85}?(\s*,\s*|\s+)(n[º°o]?\s*)?\d{1,5}\b/giu;

const BR_ROAD_RE = /\bbr[-\s]?\d{2,3}\b/giu;

/** "Bairro" + nome próprio (pelo menos uma palavra com inicial maiúscula ou toda em caps). */
const BAIRRO_PROPRIO_RE =
  /\bbairro\s+(?:da|do|de)?\s*([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][a-záàâãéêíóôõúç]+)*|[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{3,}(?:\s+[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ]{3,})*)\b/gu;

function longestCommonSubstringInContext(fragmentNorm: string, contextNorm: string, minLen: number): boolean {
  if (fragmentNorm.length < minLen) return contextNorm.includes(fragmentNorm);
  for (let len = Math.min(50, fragmentNorm.length); len >= minLen; len--) {
    for (let i = 0; i + len <= fragmentNorm.length; i++) {
      const sub = fragmentNorm.slice(i, i + len);
      if (contextNorm.includes(sub)) return true;
    }
  }
  return false;
}

/**
 * Se houver indícios fortes de endereço/localização específica na resposta,
 * exige confirmação no contexto (substring significativa).
 */
export function findUnconfirmedAddressSnippet(reply: string, contextBlob: string): string | null {
  const contextNorm = normalizeForMatch(contextBlob);

  const cepMatches = reply.matchAll(CEP_RE);
  for (const m of cepMatches) {
    const piece = normalizeForMatch(m[0].replace(/\s/g, ''));
    if (piece.length >= 8 && !contextNorm.includes(piece)) {
      return m[0].trim();
    }
  }

  const streetMatches = reply.matchAll(STREET_WITH_NUMBER_RE);
  for (const m of streetMatches) {
    const frag = m[0].trim();
    const fn = normalizeForMatch(frag);
    if (fn.length < 12) continue;
    if (!contextNorm.includes(fn) && !longestCommonSubstringInContext(fn, contextNorm, 18)) {
      return frag.slice(0, 120);
    }
  }

  const brMatches = reply.matchAll(BR_ROAD_RE);
  for (const m of brMatches) {
    const frag = m[0].trim();
    const fn = normalizeForMatch(frag);
    if (!contextNorm.includes(fn)) {
      return frag.slice(0, 80);
    }
  }

  const bairroMatches = reply.matchAll(BAIRRO_PROPRIO_RE);
  for (const m of bairroMatches) {
    const frag = m[0].trim();
    const fn = normalizeForMatch(frag);
    if (fn.length < 10) continue;
    if (!contextNorm.includes(fn) && !longestCommonSubstringInContext(fn, contextNorm, 14)) {
      return frag.slice(0, 120);
    }
  }

  return null;
}

function findForbiddenEnterpriseMention(reply: string, enterprises: EnterpriseRow[], allowedIds: Set<number>): string | null {
  for (const e of enterprises) {
    if (allowedIds.has(e.id)) continue;
    if (enterpriseNameAppearsInText(reply, e.name)) {
      return e.name;
    }
    if (e.slug && enterpriseSlugAppearsInText(reply, e.slug)) {
      return `${e.name} (slug)`;
    }
  }
  return null;
}

const SAFE_FALLBACK_NEUTRAL =
  'Posso te passar apenas as opções confirmadas no meu contexto atual, para não correr o risco de te informar algo incorreto. Se quiser, sigo te ajudando com o que estiver confirmado aqui ou encaminho seu atendimento para a equipe confirmar os detalhes com você.';

const SAFE_FALLBACK_WITH_FOCUS = (enterpriseName: string) =>
  `Posso te passar com segurança as informações confirmadas sobre o empreendimento ${enterpriseName}. Para qualquer outro nome, endereço ou opção que não esteja confirmado no meu contexto agora, prefiro que a equipe confirme com você — assim evitamos qualquer informação imprecisa. Como posso te ajudar em cima do ${enterpriseName}?`;

/**
 * Resposta comercial segura quando a validação bloqueia a saída original.
 */
export function buildSafeFallbackReply(activeEnterprise: EnterpriseRow | null): string {
  if (activeEnterprise?.name?.trim()) {
    return SAFE_FALLBACK_WITH_FOCUS(activeEnterprise.name.trim());
  }
  return SAFE_FALLBACK_NEUTRAL;
}

/**
 * Valida a mensagem ao cliente antes do envio.
 * Em caso de dúvida, bloqueia (conservador).
 */
export function validateAnaReply(input: AnaReplyGuardInput): AnaReplyGuardResult {
  const reply = (input.reply || '').trim();
  if (!reply) {
    return {
      ok: false,
      reason: 'empty_reply',
      suspiciousSnippet: '',
      safeReply: buildSafeFallbackReply(input.activeEnterprise),
    };
  }

  const allowedIds = buildAllowlistedEnterpriseIdSet({
    knowledgeText: input.knowledgeText,
    activeEnterprise: input.activeEnterprise,
    originEnterprise: input.originEnterprise,
    userMessage: input.userMessage,
    recentUserMessages: input.recentUserMessages,
    allActiveEnterprises: input.allActiveEnterprises,
  });

  const mentionCatalog: EnterpriseRow[] = [...input.allActiveEnterprises];
  if (
    input.originEnterprise &&
    !mentionCatalog.some((e) => e.id === input.originEnterprise!.id)
  ) {
    mentionCatalog.push(input.originEnterprise);
  }

  const forbiddenName = findForbiddenEnterpriseMention(reply, mentionCatalog, allowedIds);
  if (forbiddenName) {
    return {
      ok: false,
      reason: 'enterprise_not_in_allowlist',
      suspiciousSnippet: forbiddenName,
      safeReply: buildSafeFallbackReply(input.activeEnterprise),
    };
  }

  const contextBlob = buildContextBlobForAddressCheck({
    knowledgeText: input.knowledgeText,
    variablesMap: input.variablesMap,
    activeEnterprise: input.activeEnterprise,
    originEnterprise: input.originEnterprise,
    recentUserMessages: input.recentUserMessages,
    userMessage: input.userMessage,
    allowedEnterpriseIds: allowedIds,
    allActiveEnterprises: input.allActiveEnterprises,
  });

  const addressSnippet = findUnconfirmedAddressSnippet(reply, contextBlob);
  if (addressSnippet) {
    return {
      ok: false,
      reason: 'address_not_confirmed_in_context',
      suspiciousSnippet: addressSnippet,
      safeReply: buildSafeFallbackReply(input.activeEnterprise),
    };
  }

  return { ok: true };
}

export function logAnaReplyBlocked(meta: {
  conversationId: number;
  reason: string;
  suspiciousSnippet?: string;
}): void {
  console.warn(
    '[ANA_REPLY_GUARD_BLOCKED]',
    JSON.stringify({
      conversationId: meta.conversationId,
      timestamp: new Date().toISOString(),
      reason: meta.reason,
      suspiciousSnippet: (meta.suspiciousSnippet || '').slice(0, 240),
    })
  );
}
