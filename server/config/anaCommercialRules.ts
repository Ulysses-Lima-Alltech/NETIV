export type AnaCommercialIntent =
  | 'first_contact'
  | 'preco_valor_lote'
  | 'tamanho_lotes'
  | 'investimento_valorizacao'
  | 'entrada'
  | 'formas_pagamento'
  | 'financiamento'
  | 'seguranca'
  | 'lazer'
  | 'portaria'
  | 'localizacao_regiao'
  | 'localizacao_endereco'
  | 'visita_agendamento'
  | 'obra_andamento'
  | 'entrega_empreendimento'
  | 'valor_condominio'
  | 'disponibilidade_simulacao_desconto'
  | 'materiais';

export const ANA_COMMERCIAL_RULES = {
  enterpriseKey: 'evora',
  askNameMessage: 'Ah, e qual é o seu nome? Assim já te atendo melhor por aqui.',
  firstContactMessages: [
    'Olá! Claro.',
    'O Évora é um loteamento fechado em Atibaia, com lotes a partir de 360 m², infraestrutura planejada, lazer completo e segurança 24 horas.',
    'Fica em Atibaia, com fácil acesso pela Rodovia Dom Pedro I, perto da área da Pedreira, a aproximadamente 50 minutos de São Paulo.',
    'Me conta, quais são suas dúvidas? Vou responder todas.',
  ],
  byIntent: {
    preco_valor_lote: [
      'O valor inicial do Évora é a partir de R$279.000,00, e o metro quadrado começa em R$775,00.',
      'Para uma condição certinha conforme o lote escolhido, o corretor consegue simular direitinho.',
    ],
    tamanho_lotes: [
      'O Évora tem lotes a partir de 360 m², com opções maiores conforme disponibilidade.',
      'Também existem lotes com características especiais, como vista, área verde, esquina, aclive ou declive.',
    ],
    investimento_valorizacao: [
      'Show! O Évora tem um ótimo potencial de valorização, viu? Agora me diz: você prefere terrenos menores e práticos ou maiores com mais privacidade?',
      'Temos opções de 360m² até 725m², além de lotes com características especiais, como vista, área verde, esquina, aclive ou declive.',
    ],
    entrada: [
      'A entrada mínima é de 20% do valor do lote. O valor exato depende da unidade escolhida.',
      'O corretor consegue simular certinho com as opções disponíveis. Quer que eu te ajude a agendar uma visita?',
    ],
    formas_pagamento: [
      'Temos diversas formas de pagamento que podem se encaixar na sua realidade. Para parcelas mais baixas temos planos estendidos em até 120x e para parcelamento sem juros temos planos em até 48x.',
      'O financiamento é facilitado por ser direto com a construtora, menos burocracia e mais facilidade pra você.',
      'Para uma simulação certinha, o corretor consegue montar a melhor opção conforme o lote que você gostar.',
    ],
    financiamento: [
      'O financiamento é facilitado por ser direto com a construtora, com menos burocracia e mais facilidade pra você.',
      'A simulação certinha depende do lote e do plano escolhido. O corretor te passa tudo direitinho no atendimento. Que tal marcarmos uma visita?',
    ],
    seguranca: [
      'Sim. O Évora conta com segurança 24 horas e portaria com controle de acesso.',
    ],
    lazer: [
      'Não posso deixar de comentar que o Évora é um verdadeiro paraíso onde você contempla vistas deslumbrantes, com muita natureza e área verde nos 4 cantos do empreendimento.',
      'Nossas áreas de lazer são bem completas: piscina adulto, academia, salão de festas, playground, coworking, espaço zen, fireplace, quadra de beach tennis e campo society.',
      'Além da área de lazer, temos estação de carregamento para carros elétricos e portaria 24 horas com controle de acesso.',
    ],
    portaria: [
      'Sim. O Évora tem portaria 24 horas com controle de acesso para garantir a segurança dos moradores.',
    ],
    localizacao_regiao: [
      'Atibaia faz parte da região bragantina, que é uma das regiões mais valorizadas e desenvolvidas do estado. Fica a 50 minutos de São Paulo, tornando o Évora uma ótima opção para casa de veraneio ou moradia.',
      'A cidade de Atibaia é rica em gastronomia, com restaurantes renomados e a avenida Lucas Nogueira Garcez como um polo charmoso de comércio e lazer.',
      'Também vale destacar que Atibaia foi considerada pela ONU como a cidade com o segundo melhor clima do mundo.',
    ],
    localizacao_endereco: [
      'Fica na região da Pedreira, no bairro Rio Abaixo. Um bairro já conceituado com diversos condomínios de médio e alto padrão.',
    ],
    visita_agendamento: [
      'Que tal você marcar uma visita?',
      'Aproveita pra conhecer nosso stand que fica localizado no próprio empreendimento, assim você conhece o loteamento e já pode até visitar o seu lote.',
      'Estamos com 55% de obras executadas, vale a pena a visita, vamos marcar?',
    ],
    obra_andamento: [
      'As obras do Évora estão avançadas, com 55% executado.',
      'Vale a pena conhecer de perto. Que tal marcarmos uma visita?',
    ],
    entrega_empreendimento: [
      'A previsão de entrega do Évora é dezembro de 2027.',
      'As obras estão avançadas, com 55% executado e boa margem para a entrega.',
    ],
    valor_condominio: [
      'O valor de condomínio vai depender das definições feitas pelos próprios moradores e associação do condomínio, mas temos uma estimativa entre R$400,00 e R$700,00.',
    ],
    disponibilidade_simulacao_desconto: [
      'A simulação certinha depende do lote e do plano escolhido. O corretor te passa tudo direitinho no atendimento. Que tal marcarmos uma visita?',
    ],
    materiais: [
      'A tabela comercial é enviada pelo corretor, porque depende da disponibilidade e das condições do momento.',
      'Posso te passar os principais detalhes por aqui e, se quiser, o corretor te ajuda com a opção ideal.',
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
