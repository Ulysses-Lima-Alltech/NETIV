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
  askNameMessage: 'Ah, e qual é o seu nome? Assim já te atendo melhor por aqui.',
  firstContactMessages: [
    'O Évora é um loteamento fechado em Atibaia, com lotes a partir de 360 m², infraestrutura planejada, lazer completo e segurança 24 horas.',
    'Fácil acesso pela Rodovia Dom Pedro I, perto da área da Pedreira, a aproximadamente 50 minutos de São Paulo.',
    'Você quer começar por valores, localização ou lazer?',
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
      'A parcela depende da forma de pagamento e da opção escolhida.\n\nTemos planos estendidos em até 120x para parcelas mais baixas, parcelamento sem juros em até 48x e financiamento direto com a construtora.\n\nQuer que eu encaminhe para um corretor fazer uma simulação certinha pra você?',
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
      'O Évora fica em Atibaia, na região da Pedreira/Rio Abaixo, com fácil acesso pela Rodovia Dom Pedro I e a aproximadamente 50 minutos de São Paulo. É uma região com perfil mais tranquilo, contato com natureza e boa qualidade de vida. Quer que eu te envie também o endereço certinho?',
    ],
    endereco: [
      'Fica na Estrada dos Pires, s/n, na região da Pedreira, bairro Rio Abaixo, em Atibaia.',
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
      'O lazer do Évora é bem completo para o dia a dia da família.\n\nTem piscina adulto, piscina infantil, academia, salão de festas, playground, coworking, espaço zen, fireplace, quadra de beach tennis, campo society, praça interna e áreas verdes.\n\nTambém conta com estação para carros elétricos e portaria 24h com controle de acesso.\n\nQuer que eu te fale mais sobre a segurança ou sobre a localização?',
    ],
    seguranca_portaria: [
      'O Évora conta com portaria 24 horas e controle de acesso, trazendo mais segurança para moradores e visitantes.\n\nQuer que eu te fale também sobre o lazer ou sobre a localização?',
    ],
    quantidade_lotes_info_gap: [
      'O Évora tem 145 lotes no total, com opções a partir de 360 m².\n\nQuer que eu te explique as opções de tamanho?',
    ],
    disponibilidade_simulacao_desconto: [
      'Esses detalhes variam conforme as opções disponíveis. Posso te encaminhar para o corretor responsável ou, se preferir, te ajudar a agendar uma visita.',
    ],
    materiais: [
      'Não tenho esse material liberado para envio por aqui. Posso te encaminhar para o corretor responsável ou, se preferir, te ajudar a agendar uma visita.',
    ],
  } satisfies Record<Exclude<AnaCommercialIntent, 'first_contact'>, string[]>,
  followupWhileNoResponseMessages: [
    '',
    'Se quiser, eu te explico opções de tamanho de lote, localização e condições de pagamento.',
    'Também posso te mostrar os diferenciais de lazer e infraestrutura para você comparar com calma.',
    'Se preferir, já adianto as melhores condições disponíveis hoje para facilitar sua análise.',
    'Você deu uma sumida. Se quiser posso te enviar o Book pra você analisar, o que acha?',
  ],
} as const;

