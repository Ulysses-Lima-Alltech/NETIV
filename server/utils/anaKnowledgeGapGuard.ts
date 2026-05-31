import type { CommercialAxis } from './anaCommercialAxisGuard.js';

export interface AnaKnowledgeGapResult {
  hasKnowledgeGap: boolean;
  reason: string;
  matchedIntent?: string;
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
  'A informação solicitada pelo cliente não está disponível com segurança na base autorizada ou depende de validação humana. Não invente dados. Responda de forma natural, curta e consultiva. Conduza oferecendo duas possibilidades: encaminhar para o corretor responsável ou agendar uma visita.';

function n(text: string | null | undefined): string {
  return String(text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const GAP_PATTERNS: Array<{ pattern: RegExp; intent: string; reason: string }> = [
  { pattern: /\b(quantos?\s+lotes?|numero\s+de\s+lotes?)\b/, intent: 'lot_count', reason: 'lot_count_not_authorized' },
  { pattern: /\b(lote menor|menor lote|quais lotes|lote na quadra|lotes disponiveis|disponibilidade de lote)\b/, intent: 'lot_availability', reason: 'lot_availability_requires_human_validation' },
  { pattern: /\b(preco exato|valor exato|quanto custa exatamente|valor final)\b/, intent: 'exact_price', reason: 'exact_price_not_authorized' },
  { pattern: /\b(me manda a tabela|manda a tabela|tabela comercial)\b/, intent: 'commercial_table', reason: 'commercial_table_blocked' },
  { pattern: /\b(simulacao|simular|faz uma simulacao)\b/, intent: 'simulation', reason: 'simulation_requires_human_validation' },
  { pattern: /\b(consegue desconto|tem desconto|negociar desconto)\b/, intent: 'discount', reason: 'discount_not_authorized' },
  { pattern: /\b(entrada minima|entrada mínima|qual a entrada)\b/, intent: 'minimum_down_payment', reason: 'down_payment_not_authorized' },
  { pattern: /\b(qual lote eu consigo comprar)\b/, intent: 'lot_eligibility', reason: 'eligibility_requires_human_validation' },
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

  if (axis === 'disponibilidade' || axis === 'preco' || axis === 'financiamento') {
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

export function validateKnowledgeGapResolutionOffer(replyText: string): KnowledgeGapResolutionOfferValidation {
  const text = n(replyText);
  const hasBrokerOption =
    /\b(corretor|consultor responsavel|consultor responsável|responsavel pelo atendimento|responsável pelo atendimento|especialista|atendimento humano)\b/.test(
      text
    );
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

export function classifyPendingResolutionChoice(
  userMessage: string
): 'broker' | 'visit' | 'ambiguous' | 'decline_or_ambiguous' {
  const text = n(userMessage);
  if (!text) return 'ambiguous';

  const brokerExplicit =
    /\b(corretor|consultor|especialista|atendimento humano|responsavel|responsável|falar com alguem|falar com alguém|me encaminha|pode encaminhar|melhor o corretor|prefiro o corretor)\b/.test(
      text
    );
  if (brokerExplicit) return 'broker';

  const visitExplicit =
    /\b(visita|agendar visita|marcar visita|quero visitar|conhecer o empreendimento|conhecer o stand|ir ate o local|ir até o local|presencial)\b/.test(
      text
    );
  if (visitExplicit) return 'visit';

  if (
    /\b(nao quero|não quero|nao|não|agora nao|agora não|nao quero visita|não quero visita|nao quero agendar|não quero agendar)\b/.test(
      text
    )
  ) {
    return 'decline_or_ambiguous';
  }

  if (
    /^(sim|ok|pode|pode ser|pode sim|tanto faz|beleza|claro|acho que sim|vamos)$/.test(text)
  ) {
    return 'ambiguous';
  }
  return 'ambiguous';
}
