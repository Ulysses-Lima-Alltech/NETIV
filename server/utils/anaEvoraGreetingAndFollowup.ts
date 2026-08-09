export function buildCanonicalLazerFullReply(): string {
  return [
    'As áreas de lazer do Évora incluem:',
    'Piscina adulto',
    'Academia',
    'Salão de festas',
    'Playground',
    'Coworking',
    'Espaço zen',
    'Fireplace',
    'Quadra de beach tennis',
    'Campo society',
    'Estação para carros elétricos',
    'Portaria 24h com controle de acesso.',
  ].join('\n');
}

export function buildEvoraFirstReplySafeFallback(): string {
  return 'O Évora é um loteamento fechado em Atibaia, com lotes a partir de 360 m². Seu interesse é para morar ou investir?';
}

export function normalizeAnaLocalTextForRules(value: string | null | undefined): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

export function isGratitudeOnlyMessage(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text).replace(/[.!?]+$/g, '').trim();
  return /^(obrigado|obrigada|muito obrigado|muito obrigada|ok obrigado|ok obrigada|valeu|vlw|agradeco|agradeço)$/.test(n);
}

export function isGenericFirstGreetingMessage(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text).replace(/[.!?]+$/g, '').trim();
  return /^(oi|ola|olá|bom dia|boa tarde|boa noite|oi tudo bem|ola tudo bem|olá tudo bem|tudo bem|td bem)$/.test(n);
}

export function isFirstContactGeneralInterestMessage(text: string): boolean {
  return isFirstContactEnterpriseInterestMessage(text);
}

export function isFirstContactEnterpriseInterestMessage(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text);
  const asksCommercialInfo =
    /\b(tenho interesse|gostaria de saber mais|quero saber mais|queria saber mais|me fala mais|me fale mais|quero entender melhor|vi o anuncio|vi o anúncio|me passa mais detalhes|me manda mais informacoes|me manda mais informações|gostaria de informacoes|gostaria de informações|quero informacoes|quero informações|queria informacoes|queria informações|informacoes sobre|informações sobre)\b/.test(
      n
    );
  const mentionsEnterprise = /\b(evora|empreendimento|projeto|loteamento|lote|lotes|atibaia)\b/.test(n);
  return asksCommercialInfo && mentionsEnterprise;
}

export function hasEnterprisePresentationContent(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text);
  if (!n) return false;
  return /\b(evora|empreendimento|projeto|loteamento|lote|lotes|atibaia|pedreira|rodovia dom pedro|dom pedro|seguranca|portaria|lazer|infraestrutura|obras|financiamento|pagamento)\b/.test(
    n
  );
}

export function isFirstReplyGreetingOnlyMessage(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) return true;
  const words = n.split(' ').filter(Boolean);
  if (words.length === 0) return true;
  if (words.length > 16) return false;
  const allowed = new Set([
    'oi',
    'ola',
    'bom',
    'boa',
    'dia',
    'tarde',
    'noite',
    'tudo',
    'bem',
    'td',
    'como',
    'vai',
    'voce',
    'esta',
    'claro',
    'sim',
    'ok',
    'opa',
    'e',
    'ai',
    'te',
    'ajudo',
    'ajudar',
    'posso',
  ]);
  if (words.every((word) => allowed.has(word))) return true;
  return /^(oi|ola|bom dia|boa tarde|boa noite)(\s+(tudo bem|como vai|claro|sim|ok))*$/.test(n);
}

export function buildFirstGreetingSafeFallback(text: string): string {
  void text;
  return buildEvoraFirstReplySafeFallback();
}

export function isGenericInterestFollowup(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text);
  return /\b(queria saber mais|quero saber mais|me fala mais|me passa mais detalhes|tem mais informacoes|tem mais informações|quero entender melhor|gostaria de saber mais|saber mais sobre o evora|mais sobre o evora)\b/.test(n);
}

export function isConversationalGenericFollowup(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text);
  if (!n) return false;
  return (
    n === 'que mais' ||
    n === 'que mais?' ||
    n === 'show' ||
    n === 'legal' ||
    n === 'e ai' ||
    n === 'e aí' ||
    n === 'tem mais' ||
    n === 'o que mais' ||
    /\b(me fala mais|quero saber mais|que mais|tem mais|o que mais)\b/.test(n)
  );
}

export function buildConversationalCanonicalContext(lastAxis: string | null): string {
  return [
    'CONTEXTO CANÔNICO AUTORIZADO',
    '- Évora: empreendimento em Atibaia.',
    '- Quantidade total de lotes: 145.',
    '- Lotes na faixa de 360 m² a 725 m².',
    '- Valor inicial a partir de R$279.000,00.',
    '- Metro quadrado a partir de R$775,00.',
    '- Região da Pedreira / bairro Rio Abaixo.',
    '- Acesso pela Rodovia Dom Pedro I, a cerca de 50 minutos de São Paulo.',
    '- Lazer: Piscina adulto, Academia, Salão de festas, Playground, Coworking, Espaço zen, Fireplace, Quadra de beach tennis, Campo society, Estação para carros elétricos.',
    '- Portaria 24h com controle de acesso.',
    '- Formas de pagamento: planos estendidos em até 120x, parcelamento sem juros em até 48x, financiamento direto com a construtora, menos burocracia e mais facilidade.',
    `- Último eixo da conversa: ${lastAxis ?? 'indefinido'}.`,
    'Responda com tom natural e útil, sem inventar fatos fora desse contexto.',
  ].join('\n');
}

export function hasUnauthorizedPriceClaimInConversationalReply(text: string): boolean {
  const n = normalizeAnaLocalTextForRules(text);
  if (!/\br\$\s*\d/.test(n) && !/\b\d+\s*(?:mil|milhao|milhões|milhao)\b/.test(n)) return false;
  const allowsMainPrice = /\br\$\s*279[\.\s]*000(?:,\s*00)?\b/.test(n) || /\b279[\.\s]*000\b/.test(n);
  const allowsM2 = /\br\$\s*775(?:,\s*00)?\b/.test(n) || /\b775\b/.test(n);
  if (allowsMainPrice || allowsM2) return false;
  return true;
}

export function buildConversationalCanonicalFallback(lastAxis: string | null): string {
  if (lastAxis === 'lazer' || lastAxis === 'areas_lazer') return buildCanonicalLazerFullReply();
  if (lastAxis === 'localizacao' || lastAxis === 'localizacao_endereco') {
    return 'O Évora fica em Atibaia, na região da Pedreira/Rio Abaixo, com acesso pela Rodovia Dom Pedro I, a cerca de 50 minutos de São Paulo.';
  }
  if (lastAxis === 'preco' || lastAxis === 'preco_valor_lote') {
    return 'O Évora tem lotes a partir de R$279.000,00, com metro quadrado a partir de R$775,00. O valor final depende da unidade e das condições escolhidas.';
  }
  if (lastAxis === 'financiamento' || lastAxis === 'formas_pagamento') {
    return 'De forma geral, o Évora trabalha com planos estendidos em até 120x para parcelas mais baixas, parcelamento sem juros em até 48x e financiamento direto com a construtora, com menos burocracia e mais facilidade.';
  }
  return 'Posso te ajudar de forma objetiva com as informações do empreendimento.';
}
