import type {
  CommercialFlowState,
  LeadQualificationProductFit,
  LeadQualificationPurpose,
  LeadQualificationState,
} from './commercialFlowState.js';
import { questionsAreEquivalent } from './anaFinalQuestionPolicy.js';
import { extractCustomerNameFromUserUtterance } from './extractCustomerNameFromMessage.js';

export type LeadQualificationQuestionKey =
  | 'name'
  | 'purpose'
  | 'productFit'
  | 'knowsAtibaia'
  | 'topicChoice'
  | 'currentCity'
  | 'buyingTimeline'
  | 'budgetRange'
  | 'visitOrMaterial';

export type LeadQualificationSignals = Partial<
  Pick<
    LeadQualificationState,
    | 'name'
    | 'customerName'
    | 'nameAsked'
    | 'nameCollected'
    | 'purpose'
    | 'productFit'
    | 'knowsAtibaia'
    | 'currentCity'
    | 'buyingTimeline'
    | 'budgetRangeKnown'
    | 'budgetRangeText'
    | 'visitInterest'
    | 'materialOffered'
  >
>;

export interface LeadQualificationQuestionSelection {
  key: LeadQualificationQuestionKey;
  question: string;
}

const DEFAULT_STATE: LeadQualificationState = {
  name: null,
  nameAsked: false,
  nameCollected: false,
  customerName: null,
  purpose: null,
  productFit: null,
  knowsAtibaia: null,
  currentCity: null,
  buyingTimeline: null,
  budgetRangeKnown: null,
  budgetRangeText: null,
  visitInterest: null,
  materialOffered: false,
  lastQualificationQuestion: null,
  askedQualificationKeys: [],
};

function norm(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s$]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanName(value: string | null | undefined): string | null {
  const raw = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!raw || raw.length < 2 || raw.length > 48) return null;
  return raw
    .split(/\s+/)
    .slice(0, 3)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1).toLowerCase()}`)
    .join(' ');
}

function compactAskedKeys(keys: string[] | null | undefined): string[] {
  const out: string[] = [];
  for (const raw of keys ?? []) {
    const key = String(raw || '').trim();
    if (!key || out.includes(key)) continue;
    out.push(key);
  }
  return out.slice(-10);
}

function getDialoguePolicy(flowState: CommercialFlowState | null | undefined): Record<string, unknown> {
  const raw = flowState?.dialoguePolicy;
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

export function getLeadQualificationState(flowState: CommercialFlowState | null | undefined): LeadQualificationState {
  const raw = getDialoguePolicy(flowState).leadQualification;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_STATE };
  const state = raw as Partial<LeadQualificationState>;
  const name = cleanName(state.name ?? state.customerName ?? null);
  return {
    ...DEFAULT_STATE,
    ...state,
    name,
    customerName: cleanName(state.customerName ?? name),
    nameAsked: state.nameAsked === true,
    nameCollected: state.nameCollected === true || Boolean(name),
    materialOffered: state.materialOffered === true,
    askedQualificationKeys: compactAskedKeys(state.askedQualificationKeys),
  };
}

export function qualificationQuestionAlreadyAsked(
  questionKey: LeadQualificationQuestionKey,
  state: LeadQualificationState
): boolean {
  return compactAskedKeys(state.askedQualificationKeys).includes(questionKey);
}

function inferPurpose(n: string): LeadQualificationPurpose | null {
  if (/\b(morar|moradia|minha casa|familia|familia|filhos?)\b/.test(n)) return /\bfamilia|filhos?\b/.test(n) ? 'familia' : 'moradia';
  if (/\b(investir|investimento|valoriza|renda)\b/.test(n)) return 'investimento';
  if (/\b(construir|construcao|obra|fazer uma casa)\b/.test(n)) return 'construcao';
  if (/\b(pesquisando|conhecendo|olhando|comparando|ainda nao sei|ainda n sei)\b/.test(n)) return 'pesquisa';
  return null;
}

function inferProductFit(n: string): LeadQualificationProductFit | null {
  if (/\b(loteamento|lote|terreno|condominio fechado|condominio de lotes)\b/.test(n)) return 'loteamento';
  if (/\b(casa pronta|casa)\b/.test(n)) return 'casa';
  if (/\b(apartamento|ape|apto)\b/.test(n)) return 'apartamento';
  if (/\b(ainda nao sei|nao sei|indefinido|comparando)\b/.test(n)) return 'indefinido';
  return null;
}

function inferKnowsAtibaia(n: string): boolean | null {
  if (/\b(conheco atibaia|conheço atibaia|ja conheco|ja conheço|moro em atibaia|sou de atibaia)\b/.test(n)) return true;
  if (/\b(nao conheco atibaia|não conheço atibaia|nao conheco|nao conheço|estou comecando|estou começando)\b/.test(n)) return false;
  return null;
}

function inferCurrentCity(text: string): string | null {
  const raw = String(text || '').trim();
  const patterns = [
    /\bmoro em\s+([A-Za-zÀ-ÿ\s.'-]{3,40})/i,
    /\bsou de\s+([A-Za-zÀ-ÿ\s.'-]{3,40})/i,
    /\bvenho de\s+([A-Za-zÀ-ÿ\s.'-]{3,40})/i,
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const city = match?.[1]?.replace(/[.!?].*$/g, '').trim();
    if (city && city.split(/\s+/).length <= 4) return city;
  }
  return null;
}

function inferBuyingTimeline(n: string): string | null {
  if (/\b(este ano|esse ano|ainda este ano|ainda esse ano|2026)\b/.test(n)) return 'este_ano';
  if (/\b(agora|urgente|logo|rapido|rapido|proximos meses|próximos meses)\b/.test(n)) return 'curto_prazo';
  if (/\b(pesquisa|sem pressa|mais inicial|ano que vem|futuramente)\b/.test(n)) return 'pesquisa';
  return null;
}

function inferBudget(text: string): { known: boolean | null; text: string | null } {
  const n = norm(text);
  const explicit = String(text || '').match(/(?:r\$\s*)?\d{2,3}(?:[.,]\d{3})*(?:\s*mil)?/i)?.[0]?.trim() ?? null;
  if (explicit && /\b(or[cç]amento|investimento|faixa|ate|até|tenho|penso|valor)\b/i.test(text)) {
    return { known: true, text: explicit };
  }
  if (/\b(ainda nao|nao tenho|não tenho|prefiro entender|quero entender)\b/.test(n) && /\b(or[cç]amento|faixa|investimento|valor)\b/.test(n)) {
    return { known: false, text: null };
  }
  return { known: null, text: null };
}

export function isObjectiveCustomerQuestion(userMessage: string): boolean {
  const n = norm(userMessage);
  if (!n) return false;
  return (
    /\?/.test(userMessage) ||
    /\b(valor|preco|preço|quanto custa|metragem|tamanho|lote de|localizacao|localização|onde fica|endereco|endereço|maps|mapa|lazer|seguranca|segurança|portaria|camera|câmera|monitoramento|lotes|quantos lotes|pagamento|entrada|parcela|financiamento|corretor|consultor|visita|agendar|book|material|foto|video|vídeo)\b/.test(n)
  );
}

export function extractLeadQualificationSignals(
  userMessage: string,
  currentState: LeadQualificationState
): LeadQualificationSignals {
  const n = norm(userMessage);
  const signals: LeadQualificationSignals = {};

  const explicitName = extractCustomerNameFromUserUtterance(userMessage, {
    lastAssistantPlain: currentState.nameAsked ? 'Como posso te chamar?' : null,
  });
  const name = cleanName(explicitName);
  if (name) {
    signals.name = name;
    signals.customerName = name;
    signals.nameCollected = true;
  }

  const purpose = inferPurpose(n);
  if (purpose) signals.purpose = purpose;

  const productFit = inferProductFit(n);
  if (productFit) signals.productFit = productFit;

  const knowsAtibaia = inferKnowsAtibaia(n);
  if (knowsAtibaia !== null) signals.knowsAtibaia = knowsAtibaia;

  const currentCity = inferCurrentCity(userMessage);
  if (currentCity) signals.currentCity = currentCity;

  const buyingTimeline = inferBuyingTimeline(n);
  if (buyingTimeline) signals.buyingTimeline = buyingTimeline;

  const budget = inferBudget(userMessage);
  if (budget.known !== null) signals.budgetRangeKnown = budget.known;
  if (budget.text) signals.budgetRangeText = budget.text;

  if (/\b(quero visitar|quero conhecer|agendar|marcar visita|visita)\b/.test(n)) signals.visitInterest = true;
  if (/\b(book|material|pdf|apresentacao|apresentação)\b/.test(n)) signals.materialOffered = true;

  return signals;
}

export function mergeLeadQualificationState(
  flowState: CommercialFlowState,
  signals: LeadQualificationSignals
): CommercialFlowState {
  const prev = getLeadQualificationState(flowState);
  const name = cleanName(signals.name ?? signals.customerName ?? prev.name ?? prev.customerName);
  const next: LeadQualificationState = {
    ...prev,
    ...signals,
    name,
    customerName: name,
    nameCollected: signals.nameCollected === true || prev.nameCollected || Boolean(name),
    nameAsked: signals.nameAsked === true || prev.nameAsked,
    materialOffered: signals.materialOffered === true || prev.materialOffered,
    askedQualificationKeys: compactAskedKeys(prev.askedQualificationKeys),
  };
  return {
    ...flowState,
    dialoguePolicy: {
      ...(flowState.dialoguePolicy ?? {}),
      leadQualification: next,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function buildLeadQualificationNameQuestion(): string {
  return 'Claro, posso te ajudar com o Évora.\n\nAntes de te passar as melhores informações, me conta seu nome?';
}

export function shouldAskNameFirst(context: {
  isFirstAnaReply: boolean;
  isEvora: boolean;
  hasKnownCustomerName: boolean;
  state: LeadQualificationState;
  userMessage: string;
}): boolean {
  return (
    context.isEvora &&
    context.isFirstAnaReply &&
    !context.hasKnownCustomerName &&
    !context.state.nameAsked &&
    !isObjectiveCustomerQuestion(context.userMessage)
  );
}

function customerNamePrefix(name: string | null | undefined): string {
  const cleaned = cleanName(name);
  return cleaned ? `, ${cleaned.split(/\s+/)[0]}` : '';
}

function questionRecentlyAsked(question: string, recentQuestions: string[] | null | undefined): boolean {
  return (recentQuestions ?? []).some((recent) => questionsAreEquivalent(recent, question));
}

export function selectNextLeadQualificationQuestion(context: {
  state: LeadQualificationState;
  userMessage: string;
  customerName?: string | null;
  answeredTopic?: string | null;
  recentQuestions?: string[] | null;
  preferNameFirst?: boolean;
}): LeadQualificationQuestionSelection | null {
  const state = context.state;
  const asked = new Set(compactAskedKeys(state.askedQualificationKeys));
  const name = context.customerName ?? state.name ?? state.customerName ?? null;
  const prefix = customerNamePrefix(name);
  const candidates: LeadQualificationQuestionSelection[] = [];

  if (context.preferNameFirst && !state.nameCollected && !state.nameAsked) {
    candidates.push({ key: 'name', question: buildLeadQualificationNameQuestion() });
  }
  if (!state.purpose && !asked.has('purpose')) {
    candidates.push({
      key: 'purpose',
      question: `Você está olhando mais para morar, investir ou ainda está conhecendo as possibilidades?`,
    });
  }
  if (!state.productFit && !asked.has('productFit')) {
    candidates.push({
      key: 'productFit',
      question: 'Você já está buscando especificamente um loteamento fechado ou ainda está comparando com outros tipos de imóvel?',
    });
  }
  if (state.knowsAtibaia === null && !asked.has('knowsAtibaia')) {
    candidates.push({
      key: 'knowsAtibaia',
      question: 'Você já conhece Atibaia ou está começando a olhar a região agora?',
    });
  }
  if (
    state.purpose != null &&
    state.productFit != null &&
    (state.knowsAtibaia === false || Boolean(state.currentCity)) &&
    !asked.has('topicChoice')
  ) {
    candidates.push({
      key: 'topicChoice',
      question: 'Você quer entender mais sobre a localização, o lazer ou as opções de lote?',
    });
  }
  if (!state.currentCity && !asked.has('currentCity')) {
    candidates.push({
      key: 'currentCity',
      question: 'Hoje você mora em Atibaia ou vem de outra cidade?',
    });
  }
  if (!state.buyingTimeline && !asked.has('buyingTimeline')) {
    candidates.push({
      key: 'buyingTimeline',
      question: 'Você está pensando em comprar ainda este ano ou está em uma fase mais inicial de pesquisa?',
    });
  }
  if (state.budgetRangeKnown === null && !asked.has('budgetRange')) {
    candidates.push({
      key: 'budgetRange',
      question: 'Você já tem uma faixa de investimento em mente ou prefere primeiro entender as opções do Évora?',
    });
  }
  if (!state.materialOffered && !asked.has('visitOrMaterial') && shouldOfferMaterialOrVisit({ state })) {
    candidates.push({
      key: 'visitOrMaterial',
      question: 'Com base no que você está buscando, quer que eu te envie o material do Évora ou prefere falar com um corretor?',
    });
  }

  const contextual = context.answeredTopic;
  const sorted = [...candidates];
  if (contextual === 'localizacao') {
    sorted.sort((a, b) => (a.key === 'knowsAtibaia' ? -1 : b.key === 'knowsAtibaia' ? 1 : 0));
  } else if (contextual === 'seguranca' || contextual === 'lazer') {
    sorted.sort((a, b) => (a.key === 'purpose' ? -1 : b.key === 'purpose' ? 1 : 0));
  } else if (contextual === 'valores' || contextual === 'preco') {
    sorted.sort((a, b) => (a.key === 'budgetRange' ? -1 : b.key === 'budgetRange' ? 1 : 0));
  } else if (contextual === 'metragem' || contextual === 'lotes') {
    sorted.sort((a, b) => (a.key === 'productFit' ? -1 : b.key === 'productFit' ? 1 : 0));
  }

  for (const candidate of sorted) {
    if (questionRecentlyAsked(candidate.question, context.recentQuestions)) continue;
    return candidate;
  }
  return null;
}

export function markLeadQualificationQuestionAsked(
  flowState: CommercialFlowState,
  selection: LeadQualificationQuestionSelection
): CommercialFlowState {
  const prev = getLeadQualificationState(flowState);
  const next: LeadQualificationState = {
    ...prev,
    nameAsked: prev.nameAsked || selection.key === 'name',
    lastQualificationQuestion: selection.question,
    askedQualificationKeys: compactAskedKeys([selection.key, ...prev.askedQualificationKeys]),
  };
  return {
    ...flowState,
    dialoguePolicy: {
      ...(flowState.dialoguePolicy ?? {}),
      leadQualification: next,
    },
    updatedAt: new Date().toISOString(),
  };
}

export function shouldOfferMaterialOrVisit(context: { state: LeadQualificationState; answeredTopics?: string[] }): boolean {
  const state = context.state;
  const hasNameAttempt = state.nameAsked || state.nameCollected;
  const hasPurposeOrIntent = state.purpose != null || state.visitInterest === true;
  const hasAnsweredCommercial = (context.answeredTopics ?? []).length > 0;
  return hasNameAttempt && hasPurposeOrIntent && hasAnsweredCommercial;
}

export function stripTrailingQuestion(text: string): string {
  const raw = String(text || '').trim();
  if (!raw || !/\?\s*$/.test(raw)) return raw;
  const questionMarkIndex = raw.lastIndexOf('?');
  const beforeQuestion = raw.slice(0, questionMarkIndex);
  const sentenceStart = Math.max(
    beforeQuestion.lastIndexOf('\n'),
    beforeQuestion.lastIndexOf('. '),
    beforeQuestion.lastIndexOf('! '),
    beforeQuestion.lastIndexOf('? ')
  );
  if (sentenceStart < 0) return raw;
  return raw.slice(0, sentenceStart + 1).replace(/\s{2,}/g, ' ').trim();
}

export function buildEvoraShortPresentationAfterName(customerName?: string | null): string {
  const firstName = cleanName(customerName)?.split(/\s+/)[0] ?? null;
  const prefix = firstName ? `Prazer, ${firstName}.` : 'Prazer.';
  return `${prefix}\n\nVou te fazer algumas perguntas rápidas para entender melhor o seu momento e te mostrar a melhor oportunidade no Évora.`;
}

export function buildEvoraLeadQualificationProgressReply(args: {
  previousState: LeadQualificationState;
  currentState: LeadQualificationState;
  userMessage: string;
  nextQuestionKey?: LeadQualificationQuestionKey | null;
}): string {
  const previous = args.previousState;
  const current = args.currentState;
  const nextKey = args.nextQuestionKey ?? null;

  if (!previous.nameCollected && current.nameCollected) {
    return buildEvoraShortPresentationAfterName(current.name ?? current.customerName ?? null);
  }

  if (!previous.purpose && current.purpose) {
    if (current.purpose === 'moradia' || current.purpose === 'familia') {
      return 'Perfeito. Para moradia, o Évora faz bastante sentido porque une loteamento fechado, área verde, lazer e uma região mais tranquila de Atibaia.';
    }
    if (current.purpose === 'investimento') {
      return 'Perfeito. Para investimento, o Évora pode fazer sentido pela proposta de loteamento fechado em Atibaia, com lotes a partir de 360 m² e uma região com boa procura.';
    }
    if (current.purpose === 'construcao') {
      return 'Perfeito. Para construir, o Évora conversa bem com quem quer mais espaço, segurança e liberdade para planejar uma casa em loteamento fechado.';
    }
    return 'Perfeito. Então vou te orientar de um jeito simples para você entender se o Évora combina com o seu momento.';
  }

  if (!previous.productFit && current.productFit === 'loteamento') {
    return 'Ótimo, então o perfil do Évora está bem alinhado com o que você procura.';
  }

  if (nextKey === 'topicChoice' || (!previous.knowsAtibaia && current.knowsAtibaia === false)) {
    return [
      'Atibaia é uma região muito procurada por quem quer sair um pouco da correria de São Paulo sem ficar longe demais.',
      'O Évora fica na região da Pedreira, no bairro Rio Abaixo, com acesso pela Rodovia Dom Pedro I. É uma proposta mais tranquila, com contato com natureza e estrutura de loteamento fechado.',
    ].join('\n\n');
  }

  return 'Certo, vou seguir te orientando pelo que faz mais sentido para o seu perfil.';
}
