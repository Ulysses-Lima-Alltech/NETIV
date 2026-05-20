export type AnaCommercialIntent =
  | 'first_contact'
  | 'valor_metro_quadrado'
  | 'detalhes_lotes'
  | 'oferta_visita'
  | 'formas_pagamento'
  | 'localizacao_regiao'
  | 'endereco'
  | 'seguranca'
  | 'investimento'
  | 'valor_condominio'
  | 'areas_lazer';

export const ANA_COMMERCIAL_RULES = {
  enterpriseKey: 'evora',
  firstContactMessages: [
    'O Évora é um loteamento fechado em Atibaia, com lotes a partir de 360 m², infraestrutura planejada, lazer completo e segurança 24 horas.',
    'Fácil acesso pela Rodovia Dom Pedro I, perto da área da Pedreira, a aproximadamente 50 minutos de Sao Paulo.',
    'Me conta, quais são suas dúvidas? Vou responder todas.',
  ],
  byIntent: {
    valor_metro_quadrado: [
      'O nosso metro quadrado é o mais atrativo da região, a partir de R$775,00',
      'O que mais eu posso te ajudar neste momento?',
    ],
    detalhes_lotes: [
      'O Évora tem lotes a partir de 360 m², com opções para diferentes perfis de projeto. Temos lotes próximos à área de lazer, opções com fundos para área verde e metragens maiores para quem busca mais privacidade.',
      'Você prefere um lote mais prático, a partir de 360 m², ou uma opção maior, com mais privacidade?',
    ],
    oferta_visita: [
      'Que tal você marcar uma visita ?',
      'Aproveita pra conhecer nosso stand que fica localizado no próprio empreendimento, assim você conhece o loteamento e já pode até visitar o seu lote.',
      'Estamos com 55% de obras executadas, vale a pena a visita, vamos marcar?',
    ],
    formas_pagamento: [
      'Temos diversas formas de pagamento que podem se encaixar na sua realidade. Para parcelas mais baixas temos planos estendidos em ate 120x e para parcelamento sem juros temos planos em ate 48x. Essas condições são únicas no mercado, isso voce so encontra aqui no Evora',
      'O financiamento é facilitado por ser direto com a construtora, menos burocracia e mais facilidade pra você.',
    ],
    localizacao_regiao: [
      'Atibaia faz parte da região bragantina, que é uma das regiões mais valorizadas e desenvolvidas do estado. Fica a 50 minutos de São Paulo, tornando o Évora um condomínio para casas de veraneio ou até mesmo moradia.',
      'A cidade de Atibaia é rica em gastronomia, contendo os melhores restaurantes da região, sem contar com a avenida Lucas Nogueira Garces, que além de ser um verdadeiro centro gastronômico contém também as principais grifes, bares renomados se tornando um charmoso shopping a céu aberto.',
      'Não podemos deixar de destacar que Atibaia foi considerada a cidade com o segundo melhor clima do mundo pela ONU.',
    ],
    endereco: [
      'Fica na Região da pedreira, no bairro do Rio Abaixo. Um bairro já conceituado com diversos condomínios de médio e alto padrão.',
    ],
    seguranca: [
      'O Évora conta com portaria 24 horas com controle de acesso, pensado para trazer mais tranquilidade aos moradores.',
    ],
    investimento: [
      'Show! O Évora tem um ótimo potencial de valorização, viu? Agora me diz: você prefere terrenos menores e práticos ou maiores com mais privacidade? Temos opções de 360m² até 1.000m².',
      'Perfeito! Os terrenos abaixo de [X] são práticos pra quem quer investir e manter custos mais controlados. Você faz questão de uma vista específica, tipo pra área verde ou pra região das piscinas?',
    ],
    valor_condominio: [
      'O valor de condomínio vai depender das definições feitas pelos próprios moradores e associação do condomínio, mas temos uma estimativa entre R$400,00 e R$700,00',
    ],
    areas_lazer: [
      'Não posso deixar de comentar que o Évora é um verdadeiro paraíso onde voce contempla vistas deslumbrantes, com muita natureza e área verde nos 4 cantos do empreendimento, e nossas areas de lazer são bem completas, veja:',
      '- Piscina adulto\n- Academia\n- Salão de festas\n- Playground\n- Coworking\n- Espaço zen\n- Fireplace\n- Quadra de beach tennis\n- Campo society',
      'Além da área de lazer, temos estação de carregamento para carros elétricos, portaria 24 horas com controle de acesso.',
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
