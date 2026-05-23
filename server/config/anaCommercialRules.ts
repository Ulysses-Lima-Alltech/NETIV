export type AnaCommercialIntent =
  | 'first_contact'
  | 'preco_valor_lote'
  | 'tamanho_lotes'
  | 'entrada'
  | 'formas_pagamento'
  | 'financiamento'
  | 'seguranca'
  | 'lazer'
  | 'portaria'
  | 'localizacao_endereco'
  | 'visita_agendamento'
  | 'entrega_empreendimento'
  | 'valor_condominio'
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
    tamanho_lotes: [
      'Os lotes do Évora são a partir de 360 m².',
    ],
    entrada: [
      'A entrada mínima é de 20% do valor do lote. O valor exato depende da unidade escolhida.',
      'O corretor consegue simular certinho com as opções disponíveis. Quer que eu te ajude a agendar uma visita?',
    ],
    formas_pagamento: [
      'Temos formas de pagamento que podem se encaixar na sua realidade: planos estendidos em até 120x para parcelas mais baixas e parcelamento sem juros em até 48x.',
      'O financiamento é direto com a construtora, com menos burocracia e mais facilidade pra você.',
    ],
    financiamento: [
      'O financiamento é facilitado por ser direto com a construtora, com menos burocracia e mais facilidade pra você.',
      'A simulação certinha depende do lote e do plano escolhido. O corretor te passa tudo direitinho no atendimento. Que tal marcarmos uma visita?',
    ],
    seguranca: [
      'Sim. O Évora conta com segurança 24 horas e portaria com controle de acesso.',
    ],
    lazer: [
      'O Évora conta com lazer completo: piscina adulto, academia, salão de festas, playground, coworking, espaço zen, fireplace, quadra de beach tennis e campo society.',
    ],
    portaria: [
      'Sim. O Évora tem portaria 24 horas com controle de acesso para garantir a segurança dos moradores.',
    ],
    localizacao_endereco: [
      'O Évora fica na Estrada dos Pires, s/n, bairro Rio Abaixo, em Atibaia. Fica próximo à região da Pedreira, com acesso pela Rodovia Dom Pedro I.',
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
    disponibilidade_simulacao_desconto: [
      'A simulação certinha depende do lote e do plano escolhido. O corretor te passa tudo direitinho no atendimento. Que tal marcarmos uma visita?',
    ],
    materiais: [
      'A tabela comercial é enviada pelo corretor, mas posso te enviar o Book do Évora com as principais informações. Quer que eu envie?',
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
