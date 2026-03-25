import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
/** Raiz do monorepo (inbox-app): `server/utils` → 2 níveis; `server/dist/utils` → 3 níveis. */
function monorepoRoot(): string {
  const normalized = __dirname.replace(/\\/g, '/');
  if (normalized.includes('/dist/')) {
    return join(__dirname, '..', '..', '..');
  }
  return join(__dirname, '..', '..');
}

/** Dados do banco passados à ANA para consultas por localização. */
export interface LocationEnterprisePayload {
  name: string;
  city: string | null;
  commercial_region: string | null;
}

export interface LocationQueryContext {
  /** Rótulo amigável (cidade ou região comercial). */
  userMentionLabel: string;
  matchMethod: 'city' | 'region';
  availableEnterprises: LocationEnterprisePayload[];
  /** IDs dos empreendimentos ativos do resultado filtrado (para bloquear match de outro foco). */
  filteredEnterpriseIds: number[];
  /** Lista vazia no banco para o critério usado. */
  isEmpty: boolean;
}

interface MunicipioIbge {
  i: number;
  n: string;
  u: string;
  ri: string;
  rint: string;
}

let municipiosCache: MunicipioIbge[] | null = null;

function loadMunicipios(): MunicipioIbge[] {
  if (municipiosCache) return municipiosCache;
  const path = join(monorepoRoot(), 'public', 'data', 'municipios-ibge.json');
  const raw = readFileSync(path, 'utf-8');
  municipiosCache = JSON.parse(raw) as MunicipioIbge[];
  return municipiosCache;
}

export function normGeoText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Evita match no meio de palavra (no texto já normalizado). */
function isPhraseAtWordEdges(hayNorm: string, needleNorm: string): boolean {
  let idx = 0;
  while ((idx = hayNorm.indexOf(needleNorm, idx)) >= 0) {
    const before = idx === 0 ? ' ' : hayNorm[idx - 1]!;
    const after = idx + needleNorm.length >= hayNorm.length ? ' ' : hayNorm[idx + needleNorm.length]!;
    const edge = (c: string) => !/[a-z0-9]/.test(c);
    if (edge(before) && edge(after)) return true;
    idx += 1;
  }
  return false;
}

/**
 * Encontra município IBGE mencionado no texto (maior nome primeiro para desambiguar).
 */
export function findMunicipioInMessage(text: string): MunicipioIbge | null {
  const hay = normGeoText(text);
  if (hay.length < 3) return null;
  const municipios = loadMunicipios();
  const sorted = [...municipios].sort((a, b) => b.n.length - a.n.length);
  for (const m of sorted) {
    const cn = normGeoText(m.n);
    if (cn.length < 3) continue;
    if (!isPhraseAtWordEdges(hay, cn)) continue;
    return m;
  }
  return null;
}

function toPayload(e: EnterpriseRow): LocationEnterprisePayload {
  return {
    name: e.name,
    city: e.city ?? null,
    commercial_region: e.commercial_region ?? null,
  };
}

function idsFrom(rows: EnterpriseRow[]): number[] {
  return rows.map((e) => e.id);
}

/** "Região Metropolitana de Campinas" ↔ menção "campinas" no texto. */
function hayMatchesCommercialRegion(hay: string, commercialRegion: string): boolean {
  const r = normGeoText(commercialRegion);
  if (r.length < 4) return false;
  if (hay.includes(r)) return true;
  const tokens = r.split(/[^a-z0-9]+/).filter((t) => t.length >= 5);
  return tokens.some((t) => hay.includes(t));
}

/** Indícios de pergunta por localização (evita ativar só por menção acidental à região). */
const LOCATION_QUERY_HINT =
  /\b(em|na|no|pra|regi|lote|cidade|local|onde|qual|quais|o que|tem|tem algo|algum|empreendimentos|oportunidades|dispon|marcar|visita|mostra|sabe|faz|trabalha|atende|vc|vcs|voces|vocês)\b/i;

function enterprisesMatchingCommercialRegionInText(text: string, enterprises: EnterpriseRow[]): EnterpriseRow[] {
  const hay = normGeoText(text);
  return enterprises.filter((e) => e.commercial_region && hayMatchesCommercialRegion(hay, e.commercial_region));
}

function pickDisplayRegionLabel(rows: EnterpriseRow[]): string {
  const sorted = [...rows].sort(
    (a, b) => (b.commercial_region || '').length - (a.commercial_region || '').length
  );
  return (sorted[0]?.commercial_region || 'região').trim();
}

function ibgeRegionMatchesEnterprise(m: MunicipioIbge, e: EnterpriseRow): boolean {
  const cr = normGeoText(e.commercial_region || '');
  if (!cr) return false;
  const ri = normGeoText(m.ri);
  const rint = normGeoText(m.rint);
  return cr === ri || cr === rint || cr.includes(ri) || cr.includes(rint) || ri.includes(cr) || rint.includes(cr);
}

/**
 * Quando o cliente fala de cidade/região/localização, resolve empreendimentos ativos do banco:
 * 1) cidade exata (campo `city`);
 * 2) fallback região IBGE / `commercial_region` (imediata ou intermediária do município);
 * 3) menção direta a `commercial_region` cadastrada.
 */
export function resolveEnterpriseLocationContext(
  userMessage: string,
  extraContext: string,
  activeEnterprises: EnterpriseRow[]
): LocationQueryContext | null {
  const text = `${userMessage || ''} ${extraContext || ''}`.trim();
  if (!text) return null;

  const m = findMunicipioInMessage(text);

  if (m) {
    const cityNorm = normGeoText(m.n);
    const byCity = activeEnterprises.filter((e) => e.city && normGeoText(e.city) === cityNorm);
    if (byCity.length > 0) {
      return {
        userMentionLabel: m.n,
        matchMethod: 'city',
        availableEnterprises: byCity.map(toPayload),
        filteredEnterpriseIds: idsFrom(byCity),
        isEmpty: false,
      };
    }
    const byRegion = activeEnterprises.filter((e) => ibgeRegionMatchesEnterprise(m, e));
    if (byRegion.length > 0) {
      return {
        userMentionLabel: m.n,
        matchMethod: 'region',
        availableEnterprises: byRegion.map(toPayload),
        filteredEnterpriseIds: idsFrom(byRegion),
        isEmpty: false,
      };
    }
    return {
      userMentionLabel: m.n,
      matchMethod: 'city',
      availableEnterprises: [],
      filteredEnterpriseIds: [],
      isEmpty: true,
    };
  }

  const byCommercialRegion = enterprisesMatchingCommercialRegionInText(text, activeEnterprises);
  if (byCommercialRegion.length > 0 && LOCATION_QUERY_HINT.test(text)) {
    return {
      userMentionLabel: pickDisplayRegionLabel(byCommercialRegion),
      matchMethod: 'region',
      availableEnterprises: byCommercialRegion.map(toPayload),
      filteredEnterpriseIds: idsFrom(byCommercialRegion),
      isEmpty: false,
    };
  }

  return null;
}
