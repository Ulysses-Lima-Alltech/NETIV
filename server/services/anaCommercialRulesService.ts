import { ANA_COMMERCIAL_RULES, type AnaCommercialIntent } from '../config/anaCommercialRules.js';

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
    /\b(vi o anuncio|vi o anúncio|me passa mais detalhes|me passar mais detalhes|gostaria de informacoes|gostaria de informações|mais informacoes do empreendimento|mais informações do empreendimento)\b/,
  ];
  return hasAny(n, greeting);
}

export function isGenericInterestFollowup(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  if (!n) return false;
  return hasAny(n, [
    /\b(queria saber mais|quero saber mais|me fala mais|me passa mais detalhes|tem mais informacoes|tem mais informações|quero entender melhor|gostaria de saber mais)\b/,
    /\b(saber mais sobre o evora|mais sobre o evora)\b/,
  ]);
}

function isObraAndamentoIntent(n: string): boolean {
  return hasAny(n, [
    /\b(obra|obras|andamento|fase da obra|qual fase|ja esta pronto|percentual de obra|qual o percentual de obra|quanto da obra)\b/,
    /\b(a obra esta em qual fase|obra em qual fase|como estao as obras|como anda a obra|qual o andamento|andamento da obra|andamento das obras|quanto da obra ja foi executado|qual o percentual de obra|quanto da obra)\b/,
    /\b(obras?)\b[\s\S]{0,28}\b(fase|andamento|percentual|pronto|executad)\b/,
  ]);
}

function isEntregaEmpreendimentoIntent(n: string): boolean {
  return hasAny(n, [
    /\b(quando entrega|entrega quando|qual a previsao de entrega|previsao de entrega|prazo de entrega|data de entrega|quando fica pronto)\b/,
    /\b(entrega|previsao|prazo)\b[\s\S]{0,20}\b(empreendimento|evora|loteamento)?\b/,
  ]);
}

function isValorCondominioIntent(n: string): boolean {
  const hasCondominioRoot = /\bcondom/.test(n);
  const asksAboutCondominio = /\b(tem)\b[\s\S]{0,12}\bcondom/.test(n);
  const asksCondominioValue = hasAny(n, [
    /\b(valor do condomin|taxa condominial|custo mensal do condomin|mensalidade do condomin)\b/,
    /\bquanto\b[\s\S]{0,30}\bcondomin/,
    /\b(tem taxa de condomin|tem taxa condominial)\b/,
    /\b(valor|taxa|mensalidade|custo|quanto)\b[\s\S]{0,30}\bcondom/,
  ]);
  return asksCondominioValue || (hasCondominioRoot && asksAboutCondominio);
}

function isLocalizacaoEnderecoIntent(n: string): boolean {
  return hasAny(n, [
    /\b(endereco|endereço|localizacao exata|bairro|regiao da pedreira|rio abaixo)\b/,
    /\b(qual o endereco|me passa o endereco|endereco exato|onde fica|fica onde|perto de onde)\b/,
  ]);
}

function isLocalizacaoRegiaoIntent(n: string): boolean {
  return hasAny(n, [
    /\b(qual a localizacao|localizacao|regiao|região|como chegar|atibaia|perto de sao paulo|regiao bragantina|bragantina)\b/,
  ]);
}

function isInvestimentoIntent(n: string): boolean {
  return hasAny(n, [
    /\b(investimento|investir|valorizacao|vale a pena|vale a pena investir|bom para investimento|e bom para investir|e bom para investimento|tem potencial de valorizacao|potencial de valorizacao)\b/,
  ]);
}

function detectIntent(userMessage: string): Exclude<AnaCommercialIntent, 'first_contact'> | null {
  const n = normalizeText(userMessage);
  if (!n) return null;

  if (isObraAndamentoIntent(n)) return 'obra_andamento';
  if (isEntregaEmpreendimentoIntent(n)) return 'entrega_empreendimento';
  if (isValorCondominioIntent(n)) return 'valor_condominio';

  if (
    hasAny(n, [
      /\b(qual o tamanho dos lotes|tamanho dos lotes|qual o tamanho do lote|qual a metragem dos lotes|metragem dos lotes|lotes? a partir de quantos m2)\b/,
      /\b(quais tamanhos de lote|quais tamanhos de lotes|tamanho de lote|tamanho do lote)\b/,
      /\b(lote|lotes)\b[\s\S]{0,24}\b(m2|m²|metro quadrado|metros quadrados|metragem|tamanho)\b/,
      /\b(metragem|metros|m2|m²)\b[\s\S]{0,16}\b(lote|lotes)\b/,
    ])
  ) {
    return 'tamanho_lotes';
  }

  if (hasAny(n, [/\b(portaria|controle de acesso)\b/, /\btem seguranca\b.*\b24 horas\b/])) {
    return 'portaria';
  }

  if (hasAny(n, [/\b(tem seguranca|seguranca|e seguro|empreendimento seguro)\b/])) {
    return 'seguranca';
  }

  if (
    hasAny(n, [
      /\b(lazer|area de lazer|área de lazer|piscina|academia|salao de festas|salão de festas|playground|coworking|espaco zen|espaço zen|fireplace|beach tennis|campo society)\b/,
    ])
  ) {
    return 'lazer';
  }

  if (isInvestimentoIntent(n)) return 'investimento_valorizacao';

  if (
    hasAny(n, [
      /\b(qual o preco|quero saber preco|queria saber preco|quanto custa|qual o valor|valor dos lotes|quanto e o lote|a partir de quanto)\b/,
      /\b(quero saber valores|quero saber valor|valores do evora|valor do evora|preco do evora|preço do evora)\b/,
    ])
  ) {
    return 'preco_valor_lote';
  }

  if (
    hasAny(n, [
      /\b(entrada minima|quanto .* entrada|qual a entrada|quanto paga no comeco|quanto preciso dar de entrada|tenho que dar quanto de entrada)\b/,
      /\b(tem entrada|valor de entrada|precisa dar entrada)\b/,
      /\b(entrada)\b/,
    ])
  ) {
    // "entrada" deve seguir condições de pagamento autorizadas.
    return 'formas_pagamento';
  }

  if (hasAny(n, [/\b(formas de pagamento|como posso pagar|tem parcelamento|tem parcelas|quais as condicoes|condicoes de pagamento|como funciona o pagamento|opcoes de pagamento|planos de pagamento)\b/])) {
    return 'formas_pagamento';
  }

  if (hasAny(n, [/\b(tem financiamento|como funciona o financiamento|financia|direto com banco|e pela construtora|financiamento e como)\b/])) {
    return 'financiamento';
  }

  if (isLocalizacaoEnderecoIntent(n)) return 'localizacao_endereco';
  if (isLocalizacaoRegiaoIntent(n)) return 'localizacao_regiao';

  if (hasAny(n, [/\b(quero visitar|pode agendar|quero conhecer|vamos agendar|tenho interesse em visitar|quero marcar|pode marcar)\b/]) || /^(sim|pode ser)$/i.test(userMessage.trim())) {
    return 'visita_agendamento';
  }

  if (hasAny(n, [/\b(quais lotes disponiveis|tem desconto|desconto|negociar|negociacao|qual parcela fica|quanto fica a parcela|faz simulacao|fazer uma simulacao|consigo fazer uma simulacao|simulacao|simular|pre simulacao|tem lote de quanto|qual unidade disponivel|qual lote tem|tem algum lote disponivel)\b/])) {
    return 'disponibilidade_simulacao_desconto';
  }

  if (hasAny(n, [/\b(tabela|planta|book|video|fotos|imagens|apresentacao|pdf|catalogo|catálogo|folder)\b/])) {
    return 'materiais';
  }

  return null;
}

function buildObraAndamentoMessages(userMessage: string): string[] {
  const n = normalizeText(userMessage);
  const askedPercentual = /\b(percentual de obra|qual o percentual de obra|quanto da obra)\b/.test(n);
  if (askedPercentual) {
    return [
      'As obras do Évora estão avançadas, com 55% executado.',
      'Vale muito a pena ver isso de perto. Quer marcar uma visita?',
    ];
  }
  return [
    'Hoje o Évora está com obras avançadas e 55% já executado.',
    'Vale a pena conhecer de perto. Que tal marcarmos uma visita?',
  ];
}

function buildEntregaEmpreendimentoMessages(userMessage: string): string[] {
  const n = normalizeText(userMessage);
  const askedWhen =
    /\b(quando entrega|entrega quando|quando fica pronto)\b/.test(n) &&
    !/\b(qual a previsao de entrega|previsao de entrega|prazo de entrega)\b/.test(n);
  if (askedWhen) {
    return [
      'A entrega do Évora está prevista para dezembro de 2027.',
      'As obras seguem avançadas, com 55% executado e boa margem para a entrega.',
    ];
  }
  return [
    'A previsão de entrega do Évora é dezembro de 2027.',
    'As obras estão avançadas, com 55% executado e boa margem para a entrega.',
  ];
}

export type ResolvedAnaCommercialRule = {
  ruleId: AnaCommercialIntent;
  messages: string[];
  replySource: 'commercial_rules_first_contact' | 'commercial_rules_intent';
  inheritedIntent: 'payment_terms' | null;
};

export type AnaDeterministicOperationalSubtype =
  | 'obra_andamento'
  | 'percentual_obra'
  | 'fase_obra'
  | 'entrega_empreendimento'
  | 'previsao_entrega'
  | 'investimento_valorizacao';

export function detectAnaDeterministicOperationalSubtype(
  userMessage: string
): AnaDeterministicOperationalSubtype | null {
  const n = normalizeText(userMessage);
  if (!n) return null;

  if (
    /\b(percentual de obra|qual o percentual de obra|quanto da obra|quanto da obra ja foi executado)\b/.test(n)
  ) {
    return 'percentual_obra';
  }
  if (/\b(fase da obra|qual fase|obra em qual fase|a obra esta em qual fase)\b/.test(n)) {
    return 'fase_obra';
  }
  if (isObraAndamentoIntent(n)) {
    return 'obra_andamento';
  }
  if (/\b(qual a previsao de entrega|previsao de entrega|prazo de entrega|data de entrega)\b/.test(n)) {
    return 'previsao_entrega';
  }
  if (isEntregaEmpreendimentoIntent(n)) {
    return 'entrega_empreendimento';
  }
  if (isInvestimentoIntent(n)) {
    return 'investimento_valorizacao';
  }
  return null;
}

export function buildAnaDeterministicOperationalMessages(
  subtype: AnaDeterministicOperationalSubtype
): string[] {
  switch (subtype) {
    case 'fase_obra':
      return ['As obras do Évora estão avançadas, com 55% executado.'];
    case 'percentual_obra':
      return ['As obras do Évora estão com 55% executado.'];
    case 'obra_andamento':
      return ['As obras do Évora estão avançadas, com 55% executado.'];
    case 'previsao_entrega':
      return ['A previsão de entrega do Évora é dezembro de 2027.'];
    case 'entrega_empreendimento':
      return ['A entrega do Évora está prevista para dezembro de 2027.'];
    case 'investimento_valorizacao':
      return [
        'Sim, o Évora tem bons pontos para quem pensa em investimento: fica em Atibaia, uma região valorizada, com fácil acesso pela Rodovia Dom Pedro I, infraestrutura planejada, lazer completo e segurança 24 horas.',
        'Além disso, os lotes partem de 360 m² e há opções com características especiais, como vista, área verde, esquina, aclive ou declive.',
        'Para avaliar a melhor opção dentro do seu perfil, o corretor consegue te orientar certinho.',
      ];
    default:
      return [];
  }
}

export function splitCommercialRuleMessages(lines: readonly string[]): string[] {
  return lines.map((line) => line.trim()).filter(Boolean);
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
      messages: splitCommercialRuleMessages(ANA_COMMERCIAL_RULES.firstContactMessages),
      replySource: 'commercial_rules_first_contact',
      inheritedIntent: null,
    };
  }

  if (!params.isFirstAnaReply && isGenericInterestFollowup(params.userMessage)) {
    return {
      ruleId: 'first_contact',
      messages: [
        'Claro. O Évora tem alguns pontos bem importantes: localização em Atibaia, lotes a partir de 360 m², lazer completo, segurança 24 horas e obras avançadas.',
        'Você quer começar por valores, localização ou formas de pagamento?',
      ],
      replySource: 'commercial_rules_intent',
      inheritedIntent: null,
    };
  }

  const intent = detectIntent(params.userMessage);
  if (!intent) return null;

  if (intent === 'obra_andamento') {
    return {
      ruleId: 'obra_andamento',
      messages: splitCommercialRuleMessages(buildObraAndamentoMessages(params.userMessage)),
      replySource: 'commercial_rules_intent',
      inheritedIntent: null,
    };
  }

  if (intent === 'entrega_empreendimento') {
    return {
      ruleId: 'entrega_empreendimento',
      messages: splitCommercialRuleMessages(buildEntregaEmpreendimentoMessages(params.userMessage)),
      replySource: 'commercial_rules_intent',
      inheritedIntent: null,
    };
  }

  return {
    ruleId: intent,
    messages: splitCommercialRuleMessages(ANA_COMMERCIAL_RULES.byIntent[intent]),
    replySource: 'commercial_rules_intent',
    inheritedIntent: null,
  };
}

export function resolveAnaCommercialFollowupMessage(params: {
  enterpriseName: string | null | undefined;
  cycleCount: number;
}): string | null {
  if (!isEvoraEnterpriseName(params.enterpriseName)) return null;
  const idx = Math.max(0, Math.min(params.cycleCount, ANA_COMMERCIAL_RULES.followupWhileNoResponseMessages.length - 1));
  return ANA_COMMERCIAL_RULES.followupWhileNoResponseMessages[idx] ?? null;
}

export function computeCommercialFollowupEligibleAtUtc(lastUserMessageAt: Date, cycleCount: number): Date | null {
  if (cycleCount < 0 || cycleCount >= ANA_COMMERCIAL_RULES.followupWhileNoResponseMessages.length) {
    return null;
  }
  const minuteOffset = cycleCount + 1;
  return new Date(lastUserMessageAt.getTime() + minuteOffset * 60_000);
}
