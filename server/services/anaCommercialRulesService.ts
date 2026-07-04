import { ANA_COMMERCIAL_RULES, type AnaCommercialIntent } from '../config/anaCommercialRules.js';
import { computeAnaFollowupAtUtc } from '../utils/anaFollowupCadence.js';

export type AnaCommercialAxis =
  | 'price'
  | 'installment'
  | 'payment_terms'
  | 'custom_simulation'
  | 'entry'
  | 'location'
  | 'visit'
  | 'delivery'
  | 'condo_fee'
  | 'leisure'
  | 'security'
  | 'availability'
  | 'materials'
  | 'unknown';

export type AnaFinancialIntentType =
  | 'payment_terms_general'
  | 'personalized_financial_simulation';

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function hasAny(n: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(n));
}

function isGreetingInitialInterest(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  if (!n) return false;
  const greeting = [
    /\b(gostaria de saber sobre|quero saber mais|tenho interesse|me fala sobre o empreendimento)\b/,
    /\b(ol[ae]|oi)\b.*\b(interesse|evora|empreendimento)\b/,
  ];
  return hasAny(n, greeting);
}

function isShortAffirmativePaymentFollowup(userMessage: string, previousAssistantMessage?: string | null): boolean {
  const n = normalizeText(userMessage).replace(/[.!?]+$/g, '').trim();
  if (!/^(sim|quero|quero sim|pode|pode ser|claro|ok|beleza|perfeito)$/.test(n)) return false;

  const previous = normalizeText(previousAssistantMessage);
  if (!previous) return false;
  return /\bquer\b[\s\S]{0,80}\b(?:formas? de pagamento|pagamento|condicoes de pagamento)\b/.test(previous);
}

function isEntregaEmpreendimentoIntent(n: string): boolean {
  const hasCondo = /\bcondomin/.test(n);
  const hasEntregaTerm = /\b(quando|entrega|entregue|previsao|prazo|pronto|obra|obras|libera|liberacao|lotes|construir|construcao|andamento)\b/.test(n);
  if (hasCondo && hasEntregaTerm) return true;
  return hasAny(n, [
    /\b(quando sera entregue|quando entrega|previsao de entrega|prazo de entrega|quando ficam prontos os lotes|quando libera os lotes|quando posso construir|andamento das obras|como estao as obras|esta com quanto de obra|ja esta pronto|quando posso usar o lote)\b/,
  ]);
}

function isValorCondominioIntent(n: string): boolean {
  if (isEntregaEmpreendimentoIntent(n)) return false;
  return hasAny(n, [
    /\b(valor do condomin|taxa condominial|custo mensal do condomin|mensalidade do condomin)\b/,
    /\bquanto\b[\s\S]{0,30}\bcondomin/,
    /\b(tem taxa de condomin|tem taxa condominial)\b/,
  ]);
}

function detectIntent(userMessage: string): Exclude<AnaCommercialIntent, 'first_contact'> | null {
  const n = normalizeText(userMessage);
  if (!n) return null;
  const asksSurveillanceCamera = hasAny(n, [
    /\b(cameras?|circuito\s+interno|monitoramento|cftv)\b/,
  ]);
  const installmentTerms = [
    /\bvalor\s+da?\s+parcela\b/,
    /\bvalor\s+parcela\b/,
    /\bparcela(s)?\b/,
    /\bparcelamento\s+mensal\b/,
    /\bpor\s+mes\b/,
    /\bmensalidade\b/,
    /\bsimulac(?:ao|oes|a|o)\b/,
    /\bfaz(?:er)?\s+uma?\s+simulac(?:ao|oes|a|o)\b/,
    /\b(consegue|pode|faz)\s+simular\b/,
    /\bfinanciamento\s+mensal\b/,
    /\bquanto\s+fica\s+por\s+mes\b/,
    /\bquanto\s+vou\s+pagar\s+por\s+mes\b/,
  ];

  if (hasAny(n, [/\b(lazer|areas? de lazer|area comum|amenidades|piscina|academia|playground|coworking|beach tennis|campo society)\b/])) {
    return 'areas_lazer';
  }
  if (!asksSurveillanceCamera && hasAny(n, [/\b(seguranca|portaria|controle de acesso)\b/])) {
    return 'seguranca_portaria';
  }
  if (hasAny(n, [/\b(quantos lotes|numero de lotes|vai ter quantos lotes)\b/])) {
    return 'quantidade_lotes_info_gap';
  }
  if (
    hasAny(n, [
      /\b(lote|terreno)\s*(de|com)?\s*\d{2,4}\s*m(?:2|²)?\b/,
      /\btem\s+\d{2,4}\s*m(?:2|²)?\b/,
      /\bquero\s+um\s+lote\s+de\s+\d{2,4}\s*m(?:2|²)?\b/,
    ])
  ) {
    return 'metragem_especifica';
  }
  if (
    hasAny(n, [
      /\b(quais?\s+os?\s+tamanhos?|qual\s+o\s+tamanho|metragem|metragens|tamanho\s+dos\s+lotes?)\b/,
    ])
  ) {
    return 'metragem_faixa';
  }
  if (isEntregaEmpreendimentoIntent(n)) return 'entrega_empreendimento';
  if (isValorCondominioIntent(n)) return 'valor_condominio';
  if (hasAny(n, installmentTerms)) return 'parcela_simulacao';

  if (
    hasAny(n, [
      /\b(qual o preco|quero saber preco|queria saber preco|quanto custa|qual o valor|valor do lote|valor dos lotes|quanto e o lote|a partir de quanto|preco|valor|investimento|metro quadrado|m2|m²)\b/,
    ])
  ) {
    return 'preco_valor_lote';
  }

  if (
    hasAny(n, [
      /\b(tem entrada|existe entrada|precisa de entrada|entrada minima|quanto .* entrada|qual a entrada|quanto paga no comeco|quanto preciso dar de entrada|tenho que dar quanto de entrada|valor de entrada|valor da entrada)\b/,
      /^entrada\??$/,
    ])
  ) {
    return 'entrada';
  }

  if (
    hasAny(n, [
      /\b(formas? de pagamento|como posso pagar|tem parcelamento|quais as condicoes de pagamento|condicoes de pagamento|como funciona o pagamento|planos de pagamento|opcoes de pagamento)\b/,
      /\b(da|dá)\s+para\s+parcelar\b/,
      /\b(da|dá)\s+pra\s+parcelar\b/,
      /\bposso\s+parcelar\b/,
      /\btem\s+como\s+parcelar\b/,
    ])
  ) {
    return 'formas_pagamento';
  }

  if (hasAny(n, [/\b(tem financiamento|como funciona o financiamento|financia|direto com banco|e pela construtora|financiamento e como)\b/])) {
    return 'financiamento';
  }

  if (
    hasAny(n, [
      /^(localizacao|qual a localizacao|onde fica|fica onde|bairro|pedreira|rio abaixo)$/,
      /\b(qual a localizacao|onde fica|fica onde|como chegar|me enviar a localizacao|me manda a localizacao|manda localizacao|manda a localizacao|manda o mapa|google maps|link do maps|rota)\b/,
    ])
  ) {
    return 'localizacao_endereco';
  }
  if (hasAny(n, [/\b(endereco|qual o endereco|me passa o endereco)\b/])) {
    return 'endereco';
  }

  if (hasAny(n, [/\b(quero visitar|pode agendar|quero conhecer|vamos agendar|tenho interesse em visitar|quero marcar|pode marcar)\b/]) || /^(sim|pode ser)$/i.test(userMessage.trim())) {
    return 'visita_agendamento';
  }

  if (
    hasAny(n, [
      /\b(quais lotes disponiveis|quero saber sobre os lotes disponiveis|lotes disponiveis|disponibilidade de lotes?|tem desconto|qual parcela fica|faz simulacao|tem lote de quanto|qual unidade disponivel|qual lote tem|tem algum lote disponivel)\b/,
      /\b(tabela comercial|condicao individual|condicao especifica|condicoes individuais|condicoes especificas)\b/,
    ])
  ) {
    return 'disponibilidade_simulacao_desconto';
  }

  if (hasAny(n, [/\b(tabela|planta|book|video|fotos|imagens|material|apresentacao|pdf)\b/])) {
    return 'materiais';
  }

  return null;
}

export type ResolvedAnaCommercialRule = {
  ruleId: AnaCommercialIntent;
  commercialAxis: AnaCommercialAxis;
  messages: string[];
  replySource: 'commercial_rules_first_contact' | 'commercial_rules_intent';
  inheritedIntent: 'payment_terms' | null;
  financialIntentType: AnaFinancialIntentType | null;
};

function axisFromIntent(intent: AnaCommercialIntent): AnaCommercialAxis {
  if (intent === 'preco_valor_lote') return 'price';
  if (intent === 'metragem_faixa') return 'availability';
  if (intent === 'metragem_especifica') return 'availability';
  if (intent === 'parcela_simulacao') return 'installment';
  if (intent === 'formas_pagamento' || intent === 'financiamento') return 'payment_terms';
  if (intent === 'entrada') return 'entry';
  if (intent === 'localizacao_endereco' || intent === 'endereco') return 'location';
  if (intent === 'visita_agendamento') return 'visit';
  if (intent === 'entrega_empreendimento') return 'delivery';
  if (intent === 'valor_condominio') return 'condo_fee';
  if (intent === 'areas_lazer') return 'leisure';
  if (intent === 'seguranca_portaria') return 'security';
  if (intent === 'quantidade_lotes_info_gap') return 'availability';
  if (intent === 'disponibilidade_simulacao_desconto') return 'availability';
  if (intent === 'materiais') return 'materials';
  return 'unknown';
}

function financialIntentTypeFromIntent(intent: AnaCommercialIntent): AnaFinancialIntentType | null {
  if (intent === 'formas_pagamento' || intent === 'financiamento') return 'payment_terms_general';
  if (
    intent === 'parcela_simulacao' ||
    intent === 'entrada' ||
    intent === 'disponibilidade_simulacao_desconto'
  ) {
    return 'personalized_financial_simulation';
  }
  return null;
}

export function splitCommercialRuleMessages(lines: readonly string[]): string[] {
  const raw = lines.map((line) => line.trim()).filter(Boolean);
  if (raw.length === 0) return [];
  if (raw.length > 1) return raw;

  const only = raw[0] ?? '';
  if (/^as areas de lazer do evora incluem:/.test(normalizeText(only))) {
    return [only];
  }

  return only
    .split(/---MSG---|\r?\n\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

export function isEvoraEnterpriseName(enterpriseName: string | null | undefined): boolean {
  const n = normalizeText(enterpriseName);
  return n === ANA_COMMERCIAL_RULES.enterpriseKey || n.includes(ANA_COMMERCIAL_RULES.enterpriseKey);
}

export function isVisitSchedulingRefusal(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  return /\b(nao quero agendar|nao quero visita|nao quero marcar|nao quero horario|nao quero isso|ja falei|so quero detalhes|quero detalhes)\b/.test(n);
}

export function isUserIrritated(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  return /\b(ta doida|caramba|ja falei|nao e isso|vc nao entendeu|voce nao entendeu|quis dizer)\b/.test(n);
}

export function shouldUseShortRecoveryPrompt(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  return n.length <= 5 || /\b(ta|oi|ok|hm|aff)\b/.test(n);
}

export function resolveAnaCommercialRule(params: {
  enterpriseName: string | null | undefined;
  userMessage: string;
  isFirstAnaReply: boolean;
  previousAssistantMessage?: string | null;
}): ResolvedAnaCommercialRule | null {
  if (!isEvoraEnterpriseName(params.enterpriseName)) return null;

  if (params.isFirstAnaReply && isGreetingInitialInterest(params.userMessage)) {
    return {
      ruleId: 'first_contact',
      commercialAxis: 'unknown',
      messages: splitCommercialRuleMessages(ANA_COMMERCIAL_RULES.firstContactMessages),
      replySource: 'commercial_rules_first_contact',
      inheritedIntent: null,
      financialIntentType: null,
    };
  }

  if (isShortAffirmativePaymentFollowup(params.userMessage, params.previousAssistantMessage)) {
    return {
      ruleId: 'formas_pagamento',
      commercialAxis: axisFromIntent('formas_pagamento'),
      messages: splitCommercialRuleMessages(ANA_COMMERCIAL_RULES.byIntent.formas_pagamento),
      replySource: 'commercial_rules_intent',
      inheritedIntent: 'payment_terms',
      financialIntentType: 'payment_terms_general',
    };
  }

  const intent = detectIntent(params.userMessage);
  if (!intent) return null;

  return {
    ruleId: intent,
    commercialAxis: axisFromIntent(intent),
    messages: splitCommercialRuleMessages(ANA_COMMERCIAL_RULES.byIntent[intent]),
    replySource: 'commercial_rules_intent',
    inheritedIntent: null,
    financialIntentType: financialIntentTypeFromIntent(intent),
  };
}

export function resolveAnaCommercialFollowupMessage(params: {
  enterpriseName: string | null | undefined;
  cycleCount: number;
}): string | null {
  if (!isEvoraEnterpriseName(params.enterpriseName)) return null;
  if (!Number.isInteger(params.cycleCount) || params.cycleCount < 0) return null;
  const message = ANA_COMMERCIAL_RULES.followupWhileNoResponseMessages[params.cycleCount] ?? null;
  return message && message.trim() ? message : null;
}

export function computeCommercialFollowupEligibleAtUtc(lastAnaMessageAt: Date, cycleCount: number): Date | null {
  if (!Number.isInteger(cycleCount) || cycleCount < 0) return null;
  return computeAnaFollowupAtUtc({
    anchor: lastAnaMessageAt,
    attemptIndex: cycleCount + 1,
  });
}


