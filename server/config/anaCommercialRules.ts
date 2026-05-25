export type AnaCommercialIntent =
  | 'first_contact'
  | 'preco_valor_lote'
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
  | 'disponibilidade_simulacao_desconto'
  | 'materiais';

export const ANA_COMMERCIAL_RULES = {
  enterpriseKey: 'evora',
  askNameMessage: 'Ah, e qual é o seu nome? Assim já te atendo melhor por aqui.',
  firstContactMessages: [
    'O Évora é um loteamento fechado em Atibaia, com lotes a partir de 360 m², infraestrutura planejada, lazer completo e segurança 24 horas.',
    'Fica com fácil acesso pela Rodovia Dom Pedro I, perto da região da Pedreira, a aproximadamente 50 minutos de São Paulo.',
    'Me conta, quais são suas dúvidas? Vou responder todas.',
  ],
  byIntent: {
    preco_valor_lote: [
      'O valor inicial do Évora é a partir de R$279.000,00, e o metro quadrado começa em R$775,00.',
    ],
    entrada: [
      'A entrada mínima é de 20% do valor do lote. O valor exato depende da unidade escolhida.',
    ],
    formas_pagamento: [
      'Temos algumas formas de pagamento que podem se encaixar na sua realidade.\n\nPara parcelas mais baixas, existem planos estendidos em até 120x.\n\nPara parcelamento sem juros, há opções em até 48x.\n\nO financiamento pode ser direto com a construtora, com menos burocracia e mais facilidade para você.',
    ],
    financiamento: [
      'O financiamento é facilitado por ser direto com a construtora, com menos burocracia e mais facilidade para você.',
    ],
    localizacao_endereco: [
      'O Évora fica em Atibaia, na região bragantina, a cerca de 50 minutos de São Paulo.\n\nEstá na região da Pedreira, no bairro Rio Abaixo, com acesso pela Rodovia Dom Pedro I.\n\nA Avenida Lucas Nogueira Garcez é um polo gastronômico e comercial importante da cidade.\n\nAtibaia também é reconhecida pelo segundo melhor clima do mundo, segundo a ONU.',
    ],
    endereco: [
      'O endereço do Évora é Estrada dos Pires, s/n, bairro Rio Abaixo, em Atibaia.\n\nFica na região da Pedreira, com fácil acesso pela Rodovia Dom Pedro I.',
    ],
    visita_agendamento: [
      'Perfeito! Pra agendarmos sua visita, só preciso saber seu nome, dia e horário que prefere.',
    ],
    entrega_empreendimento: [
      'Vou confirmar para você a previsão de entrega com base nos dados atualizados do empreendimento.',
      'Quer saber também como está a infraestrutura prevista?',
    ],
    valor_condominio: [
      'O valor de condomínio vai depender das definições feitas pelos próprios moradores e associação do condomínio, mas temos uma estimativa entre R$400,00 e R$700,00.',
    ],
    areas_lazer: [
      'As áreas de lazer do Évora incluem:\n\nPiscina adulto\nAcademia\nSalão de festas\nPlayground\nCoworking\nEspaço zen\nFireplace\nQuadra de beach tennis\nCampo society\n\nTambém conta com estação de carregamento para carros elétricos e portaria 24 horas com controle de acesso.',
    ],
    seguranca_portaria: [
      'O Évora conta com portaria 24 horas com controle de acesso.',
    ],
    disponibilidade_simulacao_desconto: [
      'Esses detalhes variam conforme as opções disponíveis. O corretor te passa tudo certinho no atendimento.',
    ],
    materiais: [
      'Não tenho esse material liberado para envio por aqui. Tem algum detalhe específico que você gostaria de tratar?',
    ],
  } satisfies Record<Exclude<AnaCommercialIntent, 'first_contact'>, string[]>,
  followupWhileNoResponseMessages: [
    'Só passando para te lembrar que posso te ajudar com todos os detalhes do Évora.',
    'Se quiser, eu te explico opções de tamanho de lote, localização e condições de pagamento.',
    'Também posso te mostrar os diferenciais de lazer e infraestrutura para você comparar com calma.',
    'Se preferir, já adianto as melhores condições disponíveis hoje para facilitar sua análise.',
    'Você deu uma sumida. Se quiser posso te enviar o Book pra você analisar, o que acha?',
  ],
} as const;
