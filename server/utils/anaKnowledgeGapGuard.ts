import type { CommercialAxis } from './anaCommercialAxisGuard.js';

export type AnaKnowledgeGapIntent =
  | 'lot_count'
  | 'lot_availability'
  | 'lot_size_options'
  | 'exact_price'
  | 'commercial_table'
  | 'simulation'
  | 'discount'
  | 'minimum_down_payment'
  | 'lot_eligibility'
  | 'surveillance_cameras'
  | 'exact_location_link'
  | 'disponibilidade'
  | 'preco'
  | 'financiamento';

export interface AnaKnowledgeGapResult {
  hasKnowledgeGap: boolean;
  reason: string;
  matchedIntent?: AnaKnowledgeGapIntent | string;
  allowedNextActions: ['offer_broker_handoff', 'offer_visit_scheduling'];
  instructionForModel: string;
}

export interface KnowledgeGapResolutionOfferValidation {
  ok: boolean;
  hasBrokerOption: boolean;
  hasVisitOption: boolean;
  missing: Array<'broker' | 'visit'>;
}

const DEFAULT_MODEL_INSTRUCTION =
  'A informacao solicitada pelo cliente nao esta disponivel com seguranca na base autorizada ou depende de validacao humana. Nao invente dados. Responda de forma natural, curta e consultiva. Conduza oferecendo duas possibilidades: encaminhar para o corretor responsavel ou agendar uma visita.';
const DEFAULT_LOCATION_OVERVIEW =
  'O Evora fica em Atibaia, na regiao da Pedreira, proximo ao bairro Rio Abaixo, com acesso pela Rodovia Dom Pedro I.';

function n(text: string | null | undefined): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const GAP_PATTERNS: Array<{ pattern: RegExp; intent: AnaKnowledgeGapIntent; reason: string }> = [
  { pattern: /\b(lote menor|menor lote|quais lotes|lote na quadra|lotes disponiveis|disponibilidade de lote)\b/, intent: 'lot_availability', reason: 'lot_availability_requires_human_validation' },
  { pattern: /\b(preco exato|valor exato|quanto custa exatamente|valor final)\b/, intent: 'exact_price', reason: 'exact_price_not_authorized' },
  { pattern: /\b(me manda a tabela|manda a tabela|tabela comercial)\b/, intent: 'commercial_table', reason: 'commercial_table_blocked' },
  { pattern: /\b(simulacao|simular|faz uma simulacao)\b/, intent: 'simulation', reason: 'simulation_requires_human_validation' },
  { pattern: /\b(consegue desconto|tem desconto|negociar desconto)\b/, intent: 'discount', reason: 'discount_not_authorized' },
  { pattern: /\b(entrada minima|qual a entrada)\b/, intent: 'minimum_down_payment', reason: 'down_payment_not_authorized' },
  { pattern: /\b(qual lote eu consigo comprar)\b/, intent: 'lot_eligibility', reason: 'eligibility_requires_human_validation' },
  { pattern: /\b(circuito\s+(?:interno\s+)?de\s+cameras?|monitoramento\s+por\s+cameras?|cftv|tem\s+camera|tem\s+cameras?)\b/, intent: 'surveillance_cameras', reason: 'surveillance_confirmation_requires_human_validation' },
  { pattern: /\b(manda\s+a?\s*localizacao|link\s+da\s+localizacao|link\s+com\s+a\s+localizacao|me\s+envia\s+a\s+localizacao|como\s+chegar|localizacao\s+exata|endereco\s+com\s+numero|tem\s+numero|numero\s+do\s+endereco)\b/, intent: 'exact_location_link', reason: 'exact_location_link_requires_authorized_source' },
];

export function detectAnaKnowledgeGap(args: {
  userMessage: string;
  requestedAxis?: CommercialAxis | null;
}): AnaKnowledgeGapResult {
  const text = n(args.userMessage);
  const axis = args.requestedAxis ?? null;

  for (const item of GAP_PATTERNS) {
    if (item.pattern.test(text)) {
      return {
        hasKnowledgeGap: true,
        reason: item.reason,
        matchedIntent: item.intent,
        allowedNextActions: ['offer_broker_handoff', 'offer_visit_scheduling'],
        instructionForModel: DEFAULT_MODEL_INSTRUCTION,
      };
    }
  }

  if (axis === 'financiamento') {
    return {
      hasKnowledgeGap: true,
      reason: `axis_${axis}_requires_authorized_or_human_validation`,
      matchedIntent: axis,
      allowedNextActions: ['offer_broker_handoff', 'offer_visit_scheduling'],
      instructionForModel: DEFAULT_MODEL_INSTRUCTION,
    };
  }

  return {
    hasKnowledgeGap: false,
    reason: 'no_gap',
    allowedNextActions: ['offer_broker_handoff', 'offer_visit_scheduling'],
    instructionForModel: DEFAULT_MODEL_INSTRUCTION,
  };
}

function pickBestLocationSummary(args: {
  locationOverview?: string | null;
  addressComplete?: string | null;
  addressNumber?: string | null;
}): string {
  const addressComplete = String(args.addressComplete ?? '').trim();
  const addressNumber = String(args.addressNumber ?? '').trim();
  const locationOverview = String(args.locationOverview ?? '').trim();

  if (addressComplete) {
    if (addressNumber && !addressComplete.includes(addressNumber)) {
      return `${addressComplete}, numero ${addressNumber}.`;
    }
    return addressComplete.endsWith('.') ? addressComplete : `${addressComplete}.`;
  }
  if (locationOverview) return locationOverview.endsWith('.') ? locationOverview : `${locationOverview}.`;
  return DEFAULT_LOCATION_OVERVIEW;
}

export interface BuildLeadQualificationBridgeReplyArgs {
  matchedIntent?: string | null;
  locationOverview?: string | null;
  locationLink?: string | null;
  addressComplete?: string | null;
  addressNumber?: string | null;
}

export function buildLeadQualificationBridgeReply(args: BuildLeadQualificationBridgeReplyArgs): string {
  const intent = String(args.matchedIntent ?? '').trim();
  const link = String(args.locationLink ?? '').trim();

  if (intent === 'lot_size_options') {
    return [
      'Os lotes do Evora ficam na faixa de 360 m2 a 725 m2.',
      'Para confirmar metragem especifica e unidade disponivel, o corretor responsavel valida em tempo real.',
      'Posso te encaminhar para o corretor responsavel ou, se preferir, te ajudar a agendar uma visita?',
    ].join(' ');
  }

  if (intent === 'surveillance_cameras') {
    return [
      'Sobre circuito interno de cameras, eu nao tenho essa confirmacao liberada com seguranca por aqui.',
      'Posso te encaminhar para o corretor responsavel confirmar esse ponto ou, se preferir, te ajudar a agendar uma visita.',
    ].join(' ');
  }

  if (intent === 'exact_location_link') {
    const summary = pickBestLocationSummary({
      locationOverview: args.locationOverview,
      addressComplete: args.addressComplete,
      addressNumber: args.addressNumber,
    });
    if (link) {
      return [
        summary,
        `Aqui esta a localizacao: ${link}.`,
        'Se preferir, posso te encaminhar para o corretor responsavel ou te ajudar a agendar uma visita.',
      ].join(' ');
    }
    return [
      summary,
      'Eu nao tenho um link de localizacao exata liberado por aqui.',
      'Posso te encaminhar para o corretor responsavel ou te ajudar a agendar uma visita.',
    ].join(' ');
  }

  if (intent === 'lot_count' || intent === 'lot_availability' || intent === 'lot_eligibility') {
    return [
      'Eu nao tenho essa informacao de disponibilidade liberada com seguranca por aqui.',
      'Posso te encaminhar para o corretor responsavel confirmar as opcoes ou, se preferir, te ajudar a agendar uma visita.',
    ].join(' ');
  }

  if (intent === 'exact_price' || intent === 'discount' || intent === 'commercial_table' || intent === 'simulation') {
    return [
      'Eu nao tenho esse detalhe comercial liberado com seguranca por aqui.',
      'Posso te encaminhar para o corretor responsavel para te passar certinho ou, se preferir, te ajudar a agendar uma visita.',
    ].join(' ');
  }

  return [
    'Essa informacao precisa ser confirmada com seguranca.',
    'Posso te encaminhar para o corretor responsavel ou, se preferir, te ajudar a agendar uma visita?',
  ].join(' ');
}

export function validateKnowledgeGapResolutionOffer(replyText: string): KnowledgeGapResolutionOfferValidation {
  const text = n(replyText);
  const hasBrokerOption =
    /\b(corretor|consultor responsavel|responsavel pelo atendimento|especialista|atendimento humano)\b/.test(text);
  const hasVisitOption =
    /\b(visita|agendar visita|agendamento de visita|marcar visita|conhecer o empreendimento|conhecer o stand)\b/.test(
      text
    );
  const missing: Array<'broker' | 'visit'> = [];
  if (!hasBrokerOption) missing.push('broker');
  if (!hasVisitOption) missing.push('visit');

  return {
    ok: hasBrokerOption && hasVisitOption,
    hasBrokerOption,
    hasVisitOption,
    missing,
  };
}

const SUBSTANTIVE_RESOLUTION_BYPASS_PATTERNS: RegExp[] = [
  /\?/,
  /\b(tem|qual|quais|quantos?|onde|como|manda|me fala|seguranca|segurança|lazer|valor|preco|preço|metragem|lote|condominio|condomínio|camera|câmera|portaria|obra|entrega|localizacao|localização|endereco|endereço)\b/,
];

const EXPLICIT_BROKER_CHOICE_PATTERN =
  /\b(corretor|consultor|humano|pessoa|alguem|alguém|atendimento|me encaminha|me encaminhe|falar com alguem|falar com alguém)\b/;
const EXPLICIT_VISIT_CHOICE_PATTERN =
  /\b(visita|agendar|marcar|conhecer o stand|ir ate o local|ir até o local)\b/;
const AMBIGUOUS_RESOLUTION_CHOICE_PATTERN =
  /^(sim|pode|ok|pode ser|tanto faz|claro|beleza|fechado|perfeito|isso)$/;

export function isSubstantiveQuestionThatBypassesResolutionChoice(userMessage: string): boolean {
  const text = n(userMessage);
  if (!text) return false;
  return SUBSTANTIVE_RESOLUTION_BYPASS_PATTERNS.some((pattern) => pattern.test(text));
}

export function isExplicitResolutionChoice(userMessage: string): 'broker' | 'visit' | 'ambiguous' | null {
  const text = n(userMessage);
  if (!text) return null;

  if (EXPLICIT_BROKER_CHOICE_PATTERN.test(text)) return 'broker';
  if (EXPLICIT_VISIT_CHOICE_PATTERN.test(text)) return 'visit';
  if (isSubstantiveQuestionThatBypassesResolutionChoice(text)) return null;
  if (AMBIGUOUS_RESOLUTION_CHOICE_PATTERN.test(text)) return 'ambiguous';

  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 3) return 'ambiguous';
  return null;
}

export function classifyPendingResolutionChoice(
  userMessage: string
): 'broker' | 'visit' | 'ambiguous' | null {
  return isExplicitResolutionChoice(userMessage);
}
