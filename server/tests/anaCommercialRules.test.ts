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
  assert.match((rule?.messages[0] ?? ''), /20%/);
});

test('formas de pagamento mantém 120x e 48x', () => {
  const rule = resolve('Formas de pagamento');
  assert.equal(rule?.ruleId, 'formas_pagamento');
  assert.equal(rule?.commercialAxis, 'payment_terms');
  const all = (rule?.messages ?? []).join(' ');
  assert.match(all, /120x/);
  assert.match(all, /48x/);
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
});
