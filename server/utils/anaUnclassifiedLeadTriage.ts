import { ANA_EMERGENCY_HANDOFF_MESSAGE } from '../constants/anaMessages.js';
import { normEnterpriseMatchText } from '../repositories/enterpriseMatch.js';
import type { UnclassifiedLeadTriageState } from './commercialFlowState.js';

export interface TriageEnterprise {
  id: number;
  name: string;
  city?: string | null;
  state_uf?: string | null;
  ibge_code?: string | null;
}

interface TriageCity {
  key: string;
  cityKey: string;
  locationKey: string;
  label: string;
  normalizedCity: string;
}

export type TriageDecision =
  | { kind: 'resolved'; enterpriseId: number }
  | { kind: 'reply'; text: string; nextState: UnclassifiedLeadTriageState };

export function parseUnclassifiedLeadTriageState(raw: unknown): UnclassifiedLeadTriageState | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const state = raw as Partial<UnclassifiedLeadTriageState>;
  if (state.stage !== 'awaiting_city' && state.stage !== 'awaiting_enterprise') return null;
  if (state.cityKey !== null && typeof state.cityKey !== 'string') return null;
  if (!Array.isArray(state.offeredEnterpriseIds) ||
      state.offeredEnterpriseIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) return null;
  return {
    stage: state.stage,
    cityKey: state.cityKey ?? null,
    offeredEnterpriseIds: state.offeredEnterpriseIds.slice(0, 50),
    pageOffset:
      Number.isSafeInteger(state.pageOffset) && (state.pageOffset ?? 0) >= 0
        ? state.pageOffset
        : 0,
  };
}

function getTriageCityOptions(enterprises: TriageEnterprise[]): TriageCity[] {
  const groups = new Map<string, Map<string, TriageCity>>();
  for (const enterprise of enterprises) {
    const city = enterprise.city?.trim();
    if (!city) continue;
    const normalizedCity = normEnterpriseMatchText(city);
    const locationKey = normEnterpriseMatchText(enterprise.state_uf ?? '') ||
      String(enterprise.ibge_code ?? '').trim() ||
      'unknown';
    const variants = groups.get(normalizedCity) ?? new Map<string, TriageCity>();
    if (!variants.has(locationKey)) {
      variants.set(locationKey, {
        key: normalizedCity,
        cityKey: normalizedCity,
        locationKey,
        label: city,
        normalizedCity,
      });
      groups.set(normalizedCity, variants);
    }
  }
  const result: TriageCity[] = [];
  for (const [cityKey, variants] of groups) {
    if (variants.size === 1) {
      result.push(variants.values().next().value as TriageCity);
      continue;
    }
    for (const variant of variants.values()) {
      const representative = enterprises.find((enterprise) =>
        normEnterpriseMatchText(enterprise.city ?? '') === cityKey &&
        (normEnterpriseMatchText(enterprise.state_uf ?? '') ||
          String(enterprise.ibge_code ?? '').trim() ||
          'unknown') === variant.locationKey
      );
      const qualifier = representative?.state_uf?.trim()
        ? `/${representative.state_uf.trim()}`
        : representative?.ibge_code
          ? ` (IBGE ${representative.ibge_code})`
          : ' (UF não cadastrada)';
      result.push({
        ...variant,
        key: `${cityKey}::${variant.locationKey}`,
        label: `${variant.label}${qualifier}`,
      });
    }
  }
  return result.sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
}

export function getTriageCities(enterprises: TriageEnterprise[]): string[] {
  return getTriageCityOptions(enterprises).map((city) => city.label);
}

export function renderInitialTriageMessage(template: string | null, cities: string[]): string {
  const selected = template?.trim() || ANA_EMERGENCY_HANDOFF_MESSAGE;
  const list = cities.length > 1
    ? `${cities.slice(0, -1).join(', ')} e ${cities[cities.length - 1]}`
    : cities[0] ?? 'cidades a confirmar com nossa equipe';
  const rendered = selected.replaceAll('{cidades}', list);
  return rendered.length <= 4096 ? rendered : ANA_EMERGENCY_HANDOFF_MESSAGE;
}

function readCityAnswer(text: string, cities: TriageCity[]): TriageCity | null {
  const normalized = normEnterpriseMatchText(text)
    .replace(/^(?:tenho interesse em|me interesso por|quero em|minha regiao e|a cidade e|sou de|cidade de|regiao de|em)\s+/, '')
    .replace(/[.!?,;:]+$/g, '')
    .replace(/\s+(?:por favor|pfv)$/g, '')
    .trim();
  const exactLabelMatches = cities.filter((city) => normEnterpriseMatchText(city.label) === normalized);
  if (exactLabelMatches.length === 1) return exactLabelMatches[0] ?? null;
  const cityNameMatches = cities.filter((city) =>
    city.cityKey === city.normalizedCity && city.normalizedCity === normalized
  );
  return cityNameMatches.length === 1 ? cityNameMatches[0] ?? null : null;
}

function enterpriseMatchesCityKey(enterprise: TriageEnterprise, city: TriageCity): boolean {
  if (normEnterpriseMatchText(enterprise.city ?? '') !== city.cityKey) return false;
  if (city.key === city.cityKey) return true;
  const locationKey = normEnterpriseMatchText(enterprise.state_uf ?? '') ||
    String(enterprise.ibge_code ?? '').trim() ||
    'unknown';
  return `${city.cityKey}::${locationKey}` === city.key;
}

export function isTriageCityAnswer(text: string, enterprises: TriageEnterprise[]): boolean {
  return readCityAnswer(text, getTriageCityOptions(enterprises)) != null;
}

export function decideUnclassifiedLeadTriage(params: {
  text: string;
  enterprises: TriageEnterprise[];
  previousState: UnclassifiedLeadTriageState | null;
  initialMessage: string | null;
  explicitEnterpriseId: number | null;
  ambiguousEnterpriseOptions?: Array<{ id: number; name: string }>;
}): TriageDecision {
  const { enterprises, previousState } = params;
  const explicit = enterprises.find((item) => item.id === params.explicitEnterpriseId);
  if (explicit) return { kind: 'resolved', enterpriseId: explicit.id };

  const ambiguousOptions = (params.ambiguousEnterpriseOptions ?? [])
    .filter((candidate) => enterprises.some((enterprise) => enterprise.id === candidate.id))
    .slice(0, 10);
  if (ambiguousOptions.length > 1) {
    return {
      kind: 'reply',
      text: [
        'Encontrei mais de um empreendimento possível. Qual deles você procura?',
        ...ambiguousOptions.map((item, index) => `${index + 1}. ${item.name}`),
        '',
        'Responda com o nome ou o número da opção.',
      ].join('\n'),
      nextState: {
        stage: 'awaiting_enterprise',
        cityKey: null,
        offeredEnterpriseIds: ambiguousOptions.map((item) => item.id),
      },
    };
  }

  const cityOptions = getTriageCityOptions(enterprises);
  const cities = cityOptions.map((item) => item.label);
  const city = readCityAnswer(params.text, cityOptions);
  const numeric = /^\d+$/.test(params.text.trim()) ? Number(params.text.trim()) : null;
  const wantsMoreOptions = /^(?:mais|mais opcoes|outras opcoes)$/i.test(
    normEnterpriseMatchText(params.text)
  );

  if (!city && numeric != null && previousState?.stage === 'awaiting_enterprise') {
    const id = previousState.offeredEnterpriseIds[numeric - 1];
    const selected = enterprises.find((item) =>
      item.id === id &&
      (previousState.cityKey === null ||
        cityOptions.some((option) =>
          option.key === previousState.cityKey && enterpriseMatchesCityKey(item, option)
        ))
    );
    if (selected) return { kind: 'resolved', enterpriseId: selected.id };
  }

  if (
    !city &&
    numeric == null &&
    previousState?.stage === 'awaiting_enterprise' &&
    previousState.cityKey === null
  ) {
    const options = previousState.offeredEnterpriseIds
      .map((id) => enterprises.find((enterprise) => enterprise.id === id))
      .filter((enterprise): enterprise is TriageEnterprise => enterprise != null);
    if (options.length > 0) {
      return {
        kind: 'reply',
        text: [
          'Qual destes empreendimentos você procura?',
          ...options.map((item, index) =>
            `${index + 1}. ${item.name.replace(/[\r\n\t]+/g, ' ').slice(0, 160)}`
          ),
          '',
          'Responda com o nome ou o número da opção.',
        ].join('\n'),
        nextState: previousState,
      };
    }
  }

  const cityKey = city?.key ??
    (previousState?.stage === 'awaiting_enterprise' ? previousState.cityKey : null);
  const selectedCity = cityOptions.find((option) => option.key === cityKey) ?? null;
  const options = cityKey
    ? enterprises.filter((item) => selectedCity && enterpriseMatchesCityKey(item, selectedCity))
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id - b.id)
    : [];

  if (options.length > 0) {
    const currentOffset =
      !city && previousState?.stage === 'awaiting_enterprise' && previousState.cityKey === cityKey
        ? previousState.pageOffset ?? 0
        : 0;
    const nextOffset = currentOffset + 10;
    const pageOffset = wantsMoreOptions && nextOffset < options.length ? nextOffset : currentOffset;
    const page = options.slice(pageOffset, pageOffset + 10);
    const cityLabel = (selectedCity?.label ?? page[0]?.city?.trim() ?? '')
      .replace(/[\r\n\t]+/g, ' ')
      .slice(0, 100);
    const hasMore = pageOffset + page.length < options.length;
    return {
      kind: 'reply',
      text: [
        `Algum destes empreendimentos em ${cityLabel} te interessou?`,
        ...page.map((item, index) =>
          `${index + 1}. ${item.name.replace(/[\r\n\t]+/g, ' ').slice(0, 160)}`
        ),
        '',
        hasMore
          ? 'Responda com o nome ou o número da opção. Para ver mais, escreva "mais opções".'
          : 'Responda com o nome ou o número da opção.',
      ].join('\n'),
      nextState: {
        stage: 'awaiting_enterprise',
        cityKey,
        offeredEnterpriseIds: page.map((item) => item.id),
        pageOffset,
      },
    };
  }

  const firstReply = !previousState;
  const clarification = cities.length > 0
    ? `Em qual destas cidades você procura um empreendimento: ${cities.join(', ')}?`
    : 'Ainda não tenho cidades cadastradas para listar. Você sabe o nome do empreendimento?';

  return {
    kind: 'reply',
    text: firstReply
      ? renderInitialTriageMessage(params.initialMessage, cities)
      : clarification,
    nextState: {
      stage: 'awaiting_city',
      cityKey: null,
      offeredEnterpriseIds: [],
    },
  };
}
