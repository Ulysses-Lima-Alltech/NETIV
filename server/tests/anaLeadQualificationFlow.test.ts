import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveAnaCommercialRule } from '../services/anaCommercialRulesService.js';
import { finalizeAnaReplyText } from '../utils/anaReplyFinalize.js';
import { isExplicitResolutionChoice } from '../utils/anaKnowledgeGapGuard.js';
import {
  buildEvoraLeadQualificationProgressReply,
  buildEvoraShortPresentationAfterName,
  buildLeadQualificationNameQuestion,
  extractLeadQualificationSignals,
  getLeadQualificationState,
  isObjectiveCustomerQuestion,
  markLeadQualificationQuestionAsked,
  mergeLeadQualificationState,
  selectNextLeadQualificationQuestion,
  stripTrailingQuestion,
} from '../utils/anaLeadQualificationPolicy.js';
import type { CommercialFlowState } from '../utils/commercialFlowState.js';

function countQuestions(text: string): number {
  return (text.match(/\?/g) || []).length;
}

function appendQualification(reply: string, state: CommercialFlowState, userMessage: string, answeredTopic: string): string {
  const selection = selectNextLeadQualificationQuestion({
    state: getLeadQualificationState(state),
    userMessage,
    answeredTopic,
    recentQuestions: state.dialoguePolicy?.recentQuestions ?? [],
  });
  assert.notEqual(selection, null);
  return `${stripTrailingQuestion(reply)}\n\n${selection?.question}`.trim();
}

test('primeiro contato pergunta nome antes da apresentacao longa', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'Oi, queria saber mais sobre o Evora',
    isFirstAnaReply: true,
  });
  const text = (rule?.messages ?? []).join('\n');
  assert.equal(rule?.ruleId, 'first_contact');
  assert.match(text, /poderia me informar seu nome|nome/i);
  assert.doesNotMatch(text, /loteamento fechado em Atibaia/i);
  assert.equal(countQuestions(text), 1);
  assert.match(text, /\?$/);
});

test('cliente informa nome salva e recebe apresentacao curta com qualificacao', () => {
  let state: CommercialFlowState = {
    dialoguePolicy: {
      leadQualification: { ...getLeadQualificationState({}), nameAsked: true, askedQualificationKeys: ['name'] },
    },
  };
  state = mergeLeadQualificationState(state, extractLeadQualificationSignals('Joao', getLeadQualificationState(state)));
  const qualification = selectNextLeadQualificationQuestion({
    state: getLeadQualificationState(state),
    userMessage: 'Joao',
    customerName: 'Joao',
  });
  assert.equal(getLeadQualificationState(state).name, 'Joao');
  assert.equal(getLeadQualificationState(state).nameCollected, true);
  assert.equal(qualification?.key, 'purpose');
  const reply = `${buildEvoraShortPresentationAfterName('Joao')}\n\n${qualification?.question}`;
  assert.match(reply, /perguntas rápidas/i);
  assert.match(reply, /melhor oportunidade no Évora/i);
  assert.match(reply, /morar, investir/i);
  assert.equal(countQuestions(reply), 1);
});

test('nomes curtos apos pergunta de nome normalizam e nao caem em fallback de dado ausente', () => {
  const cases = [
    ['ulysses', 'Ulysses'],
    ['Ulysses', 'Ulysses'],
    ['ana clara', 'Ana Clara'],
    ['joao', 'Joao'],
  ] as const;

  for (const [rawName, expectedName] of cases) {
    let state: CommercialFlowState = {
      dialoguePolicy: {
        leadQualification: { ...getLeadQualificationState({}), nameAsked: true, askedQualificationKeys: ['name'] },
      },
    };
    const previousState = getLeadQualificationState(state);
    state = mergeLeadQualificationState(state, extractLeadQualificationSignals(rawName, previousState));
    const selection = selectNextLeadQualificationQuestion({
      state: getLeadQualificationState(state),
      userMessage: rawName,
      customerName: expectedName,
    });
    const reply = `${buildEvoraLeadQualificationProgressReply({
      previousState,
      currentState: getLeadQualificationState(state),
      userMessage: rawName,
      nextQuestionKey: selection?.key,
    })}\n\n${selection?.question}`;

    assert.equal(getLeadQualificationState(state).name, expectedName, rawName);
    assert.equal(getLeadQualificationState(state).nameCollected, true, rawName);
    assert.equal(selection?.key, 'purpose', rawName);
    assert.match(reply, new RegExp(`Prazer, ${expectedName.split(' ')[0]}`, 'i'), rawName);
    assert.match(reply, /morar, investir/i, rawName);
    assert.doesNotMatch(reply, /N[aã]o tenho esse detalhe confirmado/i, rawName);
    assert.doesNotMatch(reply, /corretor consegue te passar certinho/i, rawName);
  }
});

test('nao entendi apos pergunta de nome nao vira nome nem fallback de dado ausente', () => {
  const state: CommercialFlowState = {
    dialoguePolicy: {
      leadQualification: { ...getLeadQualificationState({}), nameAsked: true, askedQualificationKeys: ['name'] },
    },
  };
  const signals = extractLeadQualificationSignals('nao entendi', getLeadQualificationState(state));

  assert.equal(signals.name, undefined);
  assert.equal(signals.customerName, undefined);
  assert.equal(signals.nameCollected, undefined);
  assert.equal(isObjectiveCustomerQuestion('nao entendi'), false);
});

test('respostas de qualificacao nao caem em fallback de dado ausente', () => {
  for (const userMessage of ['morar', 'investir', 'estou pesquisando']) {
    let state: CommercialFlowState = {
      dialoguePolicy: {
        leadQualification: {
          ...getLeadQualificationState({}),
          name: 'Ulysses',
          customerName: 'Ulysses',
          nameAsked: true,
          nameCollected: true,
          askedQualificationKeys: ['name', 'purpose'],
        },
      },
    };
    const previousState = getLeadQualificationState(state);
    state = mergeLeadQualificationState(state, extractLeadQualificationSignals(userMessage, previousState));
    const selection = selectNextLeadQualificationQuestion({
      state: getLeadQualificationState(state),
      userMessage,
    });
    const reply = `${buildEvoraLeadQualificationProgressReply({
      previousState,
      currentState: getLeadQualificationState(state),
      userMessage,
      nextQuestionKey: selection?.key,
    })}\n\n${selection?.question ?? ''}`;

    assert.doesNotMatch(reply, /N[aã]o tenho esse detalhe confirmado/i, userMessage);
    assert.doesNotMatch(reply, /corretor consegue te passar certinho/i, userMessage);
    assert.equal(getLeadQualificationState(state).name, 'Ulysses', userMessage);
    assert.match(reply, /Perfeito|Certo|orientar|pesquisa|investimento|moradia/i, userMessage);
  }
});

test('valor e lazer apos pergunta de nome seguem como pergunta comercial, nao como nome', () => {
  const state: CommercialFlowState = {
    dialoguePolicy: {
      leadQualification: { ...getLeadQualificationState({}), nameAsked: true, askedQualificationKeys: ['name'] },
    },
  };

  for (const userMessage of ['valor', 'lazer']) {
    const signals = extractLeadQualificationSignals(userMessage, getLeadQualificationState(state));
    assert.equal(signals.name, undefined, userMessage);
    assert.equal(signals.customerName, undefined, userMessage);
    assert.equal(signals.nameCollected, undefined, userMessage);
    assert.equal(isObjectiveCustomerQuestion(userMessage), true, userMessage);
  }
});

test('cliente ignora nome e pergunta valor recebe canonico e qualificacao', () => {
  const state: CommercialFlowState = {
    dialoguePolicy: {
      leadQualification: { ...getLeadQualificationState({}), nameAsked: true, askedQualificationKeys: ['name'] },
    },
  };
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'qual o valor?',
    isFirstAnaReply: false,
  });
  const reply = appendQualification((rule?.messages ?? []).join('\n'), state, 'qual o valor?', 'valores');
  assert.match(reply, /R\$279\.000,00/);
  assert.match(reply, /R\$775,00/);
  assert.doesNotMatch(reply, /poderia me informar seu nome/i);
  assert.match(reply, /faixa de investimento/i);
  assert.equal(countQuestions(reply), 1);
});

test('cliente responde objetivo salva purpose e pergunta proximo dado', () => {
  let state: CommercialFlowState = {
    dialoguePolicy: {
      leadQualification: {
        ...getLeadQualificationState({}),
        name: 'Joao',
        customerName: 'Joao',
        nameAsked: true,
        nameCollected: true,
        askedQualificationKeys: ['name', 'purpose'],
      },
    },
  };
  const previousState = getLeadQualificationState(state);
  state = mergeLeadQualificationState(state, extractLeadQualificationSignals('quero morar', previousState));
  const qualification = selectNextLeadQualificationQuestion({
    state: getLeadQualificationState(state),
    userMessage: 'quero morar',
  });
  assert.equal(getLeadQualificationState(state).purpose, 'moradia');
  assert.equal(qualification?.key, 'productFit');
  assert.match(qualification?.question ?? '', /loteamento fechado/i);
  const reply = `${buildEvoraLeadQualificationProgressReply({
    previousState,
    currentState: getLeadQualificationState(state),
    userMessage: 'quero morar',
    nextQuestionKey: qualification?.key,
  })}\n\n${qualification?.question}`;
  assert.match(reply, /Para moradia/i);
  assert.match(reply, /área verde|lazer/i);
});

test('cliente quer comprar este ano avanca para investimento sem repetir regiao', () => {
  let state: CommercialFlowState = {
    dialoguePolicy: {
      leadQualification: {
        ...getLeadQualificationState({}),
        name: 'Joao',
        customerName: 'Joao',
        nameAsked: true,
        nameCollected: true,
        purpose: 'moradia',
        productFit: 'loteamento',
        askedQualificationKeys: ['name', 'purpose', 'productFit', 'buyingTimeline'],
      },
    },
  };
  const previousState = getLeadQualificationState(state);
  state = mergeLeadQualificationState(state, extractLeadQualificationSignals('quero comprar esse ano', previousState));
  const selection = selectNextLeadQualificationQuestion({
    state: getLeadQualificationState(state),
    userMessage: 'quero comprar esse ano',
  });
  const reply = `${buildEvoraLeadQualificationProgressReply({
    previousState,
    currentState: getLeadQualificationState(state),
    userMessage: 'quero comprar esse ano',
    nextQuestionKey: selection?.key,
  })}\n\n${selection?.question}`;

  assert.equal(getLeadQualificationState(state).buyingTimeline, 'este_ano');
  assert.equal(selection?.key, 'budgetRange');
  assert.match(reply, /faixa de investimento|condições/i);
  assert.doesNotMatch(reply, /Rodovia Dom Pedro I|Pedreira|Rio Abaixo|correria de São Paulo/i);
});

test('sequencia consultiva passa por loteamento e apresenta regiao antes de escolher topico', () => {
  let state: CommercialFlowState = {
    dialoguePolicy: {
      leadQualification: {
        ...getLeadQualificationState({}),
        name: 'Joao',
        customerName: 'Joao',
        nameAsked: true,
        nameCollected: true,
        purpose: 'moradia',
        askedQualificationKeys: ['name', 'purpose', 'productFit'],
      },
    },
  };
  let previousState = getLeadQualificationState(state);
  state = mergeLeadQualificationState(state, extractLeadQualificationSignals('quero loteamento mesmo', previousState));
  let selection = selectNextLeadQualificationQuestion({
    state: getLeadQualificationState(state),
    userMessage: 'quero loteamento mesmo',
  });
  let reply = `${buildEvoraLeadQualificationProgressReply({
    previousState,
    currentState: getLeadQualificationState(state),
    userMessage: 'quero loteamento mesmo',
    nextQuestionKey: selection?.key,
  })}\n\n${selection?.question}`;
  assert.equal(selection?.key, 'knowsAtibaia');
  assert.match(reply, /perfil do Évora está bem alinhado/i);
  assert.match(reply, /conhece Atibaia/i);

  state = markLeadQualificationQuestionAsked(state, selection!);
  previousState = getLeadQualificationState(state);
  state = mergeLeadQualificationState(state, extractLeadQualificationSignals('estou vendo agora, moro em São Paulo', previousState));
  selection = selectNextLeadQualificationQuestion({
    state: getLeadQualificationState(state),
    userMessage: 'estou vendo agora, moro em São Paulo',
  });
  reply = `${buildEvoraLeadQualificationProgressReply({
    previousState,
    currentState: getLeadQualificationState(state),
    userMessage: 'estou vendo agora, moro em São Paulo',
    nextQuestionKey: selection?.key,
  })}\n\n${selection?.question}`;
  assert.equal(selection?.key, 'topicChoice');
  assert.match(reply, /Atibaia é uma região muito procurada/i);
  assert.match(reply, /Pedreira/i);
  assert.match(reply, /localização, o lazer ou as opções de lote/i);
});

test('seguranca responde dado canonico e pergunta qualificacao', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'seguranca',
    isFirstAnaReply: false,
  });
  const reply = appendQualification((rule?.messages ?? []).join('\n'), {}, 'seguranca', 'seguranca');
  assert.match(reply, /portaria 24 horas/i);
  assert.match(reply, /controle de acesso/i);
  assert.match(reply, /morar, investir|conhecendo as possibilidades|segurança é uma prioridade/i);
  assert.doesNotMatch(reply, /lazer ou sobre a localiza/i);
  assert.equal(countQuestions(reply), 1);
});

test('localizacao responde canonico e pergunta sobre Atibaia', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'localizacao',
    isFirstAnaReply: false,
  });
  const reply = appendQualification((rule?.messages ?? []).join('\n'), {}, 'localizacao', 'localizacao');
  assert.match(reply, /Atibaia/i);
  assert.match(reply, /Rodovia Dom Pedro I/i);
  assert.match(reply, /conhece Atibaia|olhar a região|moradia principal|finais de semana/i);
  assert.equal(countQuestions(reply), 1);
});

test('lote especifico nao confirma disponibilidade e conduz', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'tem lote de 430m?',
    isFirstAnaReply: false,
  });
  const reply = appendQualification((rule?.messages ?? []).join('\n'), {}, 'tem lote de 430m?', 'lotes');
  assert.match(reply, /360 m² a 725 m²|360 m2 a 725 m2/i);
  assert.match(reply, /não consigo confirmar disponibilidade|nao consigo confirmar disponibilidade/i);
  assert.doesNotMatch(reply, /sim,\s*(tem|ha|há)/i);
  assert.match(reply, /loteamento fechado/i);
});

test('pedido de corretor continua prioridade e nao qualifica', () => {
  assert.equal(isExplicitResolutionChoice('manda pro corretor'), 'broker');
  assert.equal(isObjectiveCustomerQuestion('manda pro corretor'), true);
});

test('nao repete pergunta ja feita', () => {
  let state: CommercialFlowState = {};
  state = markLeadQualificationQuestionAsked(state, {
    key: 'knowsAtibaia',
    question: 'Voce ja conhece Atibaia ou esta comecando a olhar a regiao agora?',
  });
  const selection = selectNextLeadQualificationQuestion({
    state: getLeadQualificationState(state),
    userMessage: 'localizacao',
    answeredTopic: 'localizacao',
    recentQuestions: ['Voce ja conhece Atibaia ou esta comecando a olhar a regiao agora?'],
  });
  assert.notEqual(selection?.key, 'knowsAtibaia');
});

test('respostas comerciais terminam com pergunta unica', () => {
  const reply = appendQualification(
    'O Evora tem lotes a partir de R$279.000,00, com metro quadrado a partir de R$775,00. Quer que eu te explique tambem as formas de pagamento?',
    {},
    'valor',
    'valores'
  );
  assert.match(reply, /\?$/);
  assert.equal(countQuestions(reply), 1);
});

test('nao envia formulario com varias perguntas', () => {
  const question = buildLeadQualificationNameQuestion();
  assert.equal(countQuestions(question), 1);
  assert.doesNotMatch(question, /nome.*morar.*onde.*quando/i);
});

test('canonicos principais nao regrediram', () => {
  const valor = finalizeAnaReplyText('Ainda nao tenho esse valor por aqui.', {
    enterpriseName: 'Evora',
    userMessage: 'qual o valor do lote?',
  });
  assert.match(valor, /R\$279\.000,00/);
  assert.match(valor, /R\$775,00/);

  const metragem = finalizeAnaReplyText('Posso confirmar depois.', {
    enterpriseName: 'Evora',
    userMessage: 'qual o tamanho dos lotes?',
  });
  assert.match(metragem, /360 m² a 725 m²|360 m2 a 725 m2/i);

  const localizacao = finalizeAnaReplyText('Nao tenho aqui.', {
    enterpriseName: 'Evora',
    userMessage: 'onde fica?',
  });
  assert.match(localizacao, /Atibaia/i);
  assert.match(localizacao, /Rodovia Dom Pedro I/i);
});
