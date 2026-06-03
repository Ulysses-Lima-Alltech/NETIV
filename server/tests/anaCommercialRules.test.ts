import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnaCommercialRule } from '../services/anaCommercialRulesService.js';
import { ANA_COMMERCIAL_RULES } from '../config/anaCommercialRules.js';

function resolve(userMessage: string) {
  return resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage,
    isFirstAnaReply: false,
    previousAssistantMessage: null,
  });
}

test('primeiro contato só dispara para interesse inicial no empreendimento', () => {
  const first = resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage: 'Gostaria de saber sobre o Évora',
    isFirstAnaReply: true,
    previousAssistantMessage: null,
  });
  assert.equal(first?.ruleId, 'first_contact');
  assert.deepEqual(first?.messages, [
    'Claro, posso te ajudar com o Évora.',
    'Antes de te passar as melhores informações, me conta seu nome?',
  ]);

  const firstWithPrice = resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage: 'Queria saber preço',
    isFirstAnaReply: true,
    previousAssistantMessage: null,
  });
  assert.equal(firstWithPrice?.ruleId, 'preco_valor_lote');
});

test('desambiguação: "quando será entregue o condomínio" cai em entrega_empreendimento', () => {
  const rule = resolve('Quando será entregue o condomínio?');
  assert.equal(rule?.ruleId, 'entrega_empreendimento');
});

test('desambiguação: pergunta de taxa cai em valor_condominio', () => {
  const rule = resolve('Quanto vai ser o condomínio?');
  assert.equal(rule?.ruleId, 'valor_condominio');
});

test('entrada não cai em formas de pagamento', () => {
  const rule = resolve('Quero saber quanto tenho que pagar de entrada');
  assert.equal(rule?.ruleId, 'entrada');
  assert.equal(rule?.financialIntentType, 'personalized_financial_simulation');
  assert.match((rule?.messages ?? []).join(' '), /corretor consegue montar certinho/i);
});

test('formas de pagamento mantém 120x e 48x', () => {
  const rule = resolve('quais as formas de pagamento?');
  assert.equal(rule?.ruleId, 'formas_pagamento');
  assert.equal(rule?.commercialAxis, 'payment_terms');
  assert.equal(rule?.financialIntentType, 'payment_terms_general');
  const all = (rule?.messages ?? []).join(' ');
  assert.match(all, /120x/);
  assert.match(all, /48x/);
  assert.match(all, /financiamento direto com a construtora/i);
  assert.match(all, /menos burocracia e mais facilidade/i);
  assert.match(all, /entrada, parcela exata ou simulação personalizada/i);
  assert.match(all, /encaminhe para uma simulação|tamanhos dos lotes/i);
});

test('pagamento geral cobre parcelamento e financiamento direto', () => {
  for (const message of [
    'como funciona o pagamento?',
    'tem parcelamento?',
    'dá para parcelar?',
    'financia direto com a construtora?',
  ]) {
    const rule = resolve(message);
    assert.equal(rule?.financialIntentType, 'payment_terms_general', message);
    assert.match((rule?.messages ?? []).join(' '), /120x/i, message);
    assert.match((rule?.messages ?? []).join(' '), /48x/i, message);
  }
});

test('"quero" após oferta de formas de pagamento herda pagamento geral autorizado', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage: 'quero',
    isFirstAnaReply: false,
    previousAssistantMessage: 'Quer que eu te explique também as formas de pagamento?',
  });
  assert.equal(rule?.ruleId, 'formas_pagamento');
  assert.equal(rule?.inheritedIntent, 'payment_terms');
  assert.equal(rule?.financialIntentType, 'payment_terms_general');
  const all = (rule?.messages ?? []).join(' ');
  assert.match(all, /120x/);
  assert.match(all, /48x/);
  assert.match(all, /financiamento direto com a construtora/i);
  assert.doesNotMatch(all, /precisa ser confirmada com segurança/i);
});

test('pedidos personalizados financeiros conduzem para corretor ou simulação', () => {
  const cases = [
    ['tem entrada?', 'entrada'],
    ['quanto fica por mês?', 'parcela_simulacao'],
    ['faz uma simulação', 'parcela_simulacao'],
    ['tem desconto?', 'disponibilidade_simulacao_desconto'],
    ['me passa a tabela comercial', 'disponibilidade_simulacao_desconto'],
  ] as const;

  for (const [message, expectedRuleId] of cases) {
    const rule = resolve(message);
    assert.equal(rule?.ruleId, expectedRuleId, message);
    assert.equal(rule?.financialIntentType, 'personalized_financial_simulation', message);
    assert.match((rule?.messages ?? []).join(' '), /corretor|simulação/i, message);
    assert.doesNotMatch((rule?.messages ?? []).join(' '), /R\$\s*\d/i, message);
  }
});

test('pedido de lotes disponíveis encaminha disponibilidade atualizada ao corretor', () => {
  const rule = resolve('quero saber sobre os lotes disponíveis');
  assert.equal(rule?.ruleId, 'disponibilidade_simulacao_desconto');
  const all = (rule?.messages ?? []).join(' ');
  assert.match(all, /disponibilidade atualizada/i);
  assert.match(all, /corretor/i);
  assert.match(all, /tamanhos gerais dos lotes|faixa de metragem|proposta do loteamento/i);
});

test('preço responde valor inicial e metro quadrado', () => {
  const rule = resolve('Queria saber preço');
  assert.equal(rule?.ruleId, 'preco_valor_lote');
  assert.equal(rule?.commercialAxis, 'price');
  const text = (rule?.messages ?? []).join(' ');
  assert.match(text, /R\$279\.000,00/);
  assert.match(text, /R\$775,00/);
  assert.match(text, /formas de pagamento/i);
});

test('"o valor parcela" cai em eixo de parcela/simulação', () => {
  const rule = resolve('o valor parcela?');
  assert.equal(rule?.ruleId, 'parcela_simulacao');
  assert.equal(rule?.commercialAxis, 'installment');
  const text = (rule?.messages ?? []).join(' ');
  assert.equal(/R\$279\.000,00/.test(text), false);
  assert.match(text, /simula[cç][aã]o/i);
});

test('"quanto fica por mês" cai em installment', () => {
  const rule = resolve('quanto fica por mês?');
  assert.equal(rule?.ruleId, 'parcela_simulacao');
  assert.equal(rule?.commercialAxis, 'installment');
  assert.equal(rule?.financialIntentType, 'personalized_financial_simulation');
});
