export type AnaCommercialIntent =
  | 'first_contact'
  | 'preco_valor_lote'
  | 'metragem_faixa'
  | 'metragem_especifica'
  | 'parcela_simulacao'
  | 'entrada'
  | 'formas_pagamento'
  | 'financiamento'
  | 'localizacao_endereco'
  | 'endereco'
  | 'visita_agendamento'
  | 'entrega_empreendimento'
  | 'valor_condominio'
  | 'areas_lazer'
  | 'seguranca_portaria'
  | 'quantidade_lotes_info_gap'
  | 'disponibilidade_simulacao_desconto'
  | 'materiais';

export const ANA_COMMERCIAL_RULES = {
  enterpriseKey: 'evora',
  askNameMessage: 'Antes de te passar as melhores informações, me conta seu nome?',
  firstContactMessages: [
    'Claro, posso te ajudar com o Évora.\n\nAntes de te passar as melhores informações, me conta seu nome?',
  ],
  byIntent: {
    preco_valor_lote: [
      'O Évora tem lotes a partir de R$279.000,00, com metro quadrado a partir de R$775,00. O valor final depende da unidade e das condições escolhidas.\n\nQuer que eu te explique também as formas de pagamento?',
    ],
    metragem_faixa: [
      'Os lotes do Évora vão de 360 m² a 725 m². As opções específicas variam conforme a unidade disponível.\n\nQuer que eu te explique os tipos de lote que existem no empreendimento?',
    ],
    metragem_especifica: [
      'Os lotes do Évora ficam na faixa de 360 m² a 725 m². Eu não consigo confirmar disponibilidade de uma metragem específica por aqui, porque isso muda conforme as unidades disponíveis.\n\nPosso te encaminhar para o corretor responsável ou, se preferir, te ajudar a agendar uma visita?',
    ],
    parcela_simulacao: [
      'Para parcela exata ou simulação personalizada, o corretor consegue montar certinho conforme a unidade disponível.\n\nQuer que eu te encaminhe para um corretor fazer uma simulação?',
    ],
    entrada: [
      'Para entrada, parcela exata ou simulação personalizada, o corretor consegue montar certinho conforme a unidade disponível.\n\nQuer que eu te encaminhe para um corretor fazer uma simulação?',
    ],
    formas_pagamento: [
      'Claro.\n\nDe forma geral, o Évora trabalha com planos estendidos em até 120x para parcelas mais baixas, parcelamento sem juros em até 48x e financiamento direto com a construtora, com menos burocracia e mais facilidade.\n\nPara entrada, parcela exata ou simulação personalizada, o corretor consegue montar certinho conforme a unidade disponível.\n\nVocê quer que eu te encaminhe para uma simulação ou prefere entender melhor os tamanhos dos lotes primeiro?',
    ],
    financiamento: [
      'Claro.\n\nDe forma geral, o Évora trabalha com planos estendidos em até 120x para parcelas mais baixas, parcelamento sem juros em até 48x e financiamento direto com a construtora, com menos burocracia e mais facilidade.\n\nPara entrada, parcela exata ou simulação personalizada, o corretor consegue montar certinho conforme a unidade disponível.\n\nVocê quer que eu te encaminhe para uma simulação ou prefere entender melhor os tamanhos dos lotes primeiro?',
    ],
    localizacao_endereco: [
      'O Évora fica na região da Pedreira, no bairro Rio Abaixo, em Atibaia, com acesso pela Rodovia Dom Pedro I.\n\nPara quem vem de São Paulo, a ideia é ter mais tranquilidade e contato com natureza a aproximadamente 50 minutos de São Paulo.\n\nVocê pretende usar mais como moradia principal ou como uma casa para finais de semana?',
    ],
    endereco: [
      'Fica na Estrada dos Pires, s/n, na região da Pedreira, bairro Rio Abaixo, em Atibaia.\n\nQuer que eu te envie também o link do mapa?',
    ],
    visita_agendamento: [
      'Perfeito! Pra agendarmos sua visita, só preciso saber seu nome, dia e horário que prefere.',
    ],
    entrega_empreendimento: [
      'Vou confirmar para você a previsão de entrega com base nos dados atualizados do empreendimento.',
      'Quer saber também como está a infraestrutura prevista?',
    ],
    valor_condominio: [
      'O valor de condomínio vai depender das definições feitas pelos próprios moradores e associação do condomínio, mas temos uma estimativa entre R$400,00 e R$700,00.\n\nQuer que eu te explique também os custos gerais de compra?',
    ],
    areas_lazer: [
      'O lazer do Évora é bem completo para o dia a dia da família.\n\nTem piscina adulto, piscina infantil, academia, salão de festas, playground, coworking, espaço zen, fireplace, quadra de beach tennis, campo society, praça interna e áreas verdes.\n\nTambém há estação para carros elétricos e portaria 24h com controle de acesso.\n\nVocê imagina usar mais essa estrutura para rotina da família ou está pensando mais em valorização do imóvel?',
    ],
    seguranca_portaria: [
      'O Évora conta com portaria 24 horas e controle de acesso, o que ajuda a trazer mais tranquilidade para moradores e visitantes.\n\nNa prática, a proposta é unir loteamento fechado, controle de entrada e uma região mais tranquila de Atibaia.\n\nEsse ponto pesa bastante na sua decisão?',
    ],
    quantidade_lotes_info_gap: [
      'O Évora tem 145 lotes no total, com opções a partir de 360 m².\n\nQuer que eu te explique as opções de tamanho?',
    ],
    disponibilidade_simulacao_desconto: [
      'Para disponibilidade atualizada, tabela comercial, desconto ou condição individual, essa parte depende de confirmação no atendimento.\n\nEu posso te explicar os tamanhos gerais dos lotes, a faixa de metragem e a proposta do loteamento.\n\nVocê prefere ver os tamanhos gerais primeiro ou falar com o corretor?',
    ],
    materiais: [
      'Não tenho esse material liberado para envio por aqui. Posso te encaminhar para o corretor responsável ou, se preferir, te ajudar a agendar uma visita.',
    ],
  } satisfies Record<Exclude<AnaCommercialIntent, 'first_contact'>, string[]>,
  followupWhileNoResponseMessages: [
    '',
    'Se quiser, eu te explico opções de tamanho de lote, localização e condições de pagamento.',
    'Também posso te mostrar os diferenciais de lazer e infraestrutura para você comparar com calma.',
    'Se preferir, já te explico as condições gerais de pagamento para facilitar sua análise.',
    'Você deu uma sumida. Se quiser posso te enviar o Book pra você analisar, o que acha?',
  ],
} as const;

