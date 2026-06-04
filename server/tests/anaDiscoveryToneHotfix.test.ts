import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

const helperStart = source.indexOf('function buildInitialDiscoveryGuidanceContext');
const helperEnd = source.indexOf('function isInitialQualificationClarificationMessage', helperStart);

assert.ok(helperStart > -1, 'buildInitialDiscoveryGuidanceContext não encontrado');
assert.ok(helperEnd > helperStart, 'fim do helper não encontrado');

const helper = source.slice(helperStart, helperEnd);

test('post-name discovery orienta saudacao completa e pergunta morar investir conhecer', () => {
  assert.match(helper, /saudação completa e natural/);
  assert.match(helper, /Não responda apenas o nome isolado/);
  assert.match(helper, /vai fazer algumas perguntas rápidas/);
  assert.match(helper, /morar, investir ou ainda conhecer as possibilidades/);
  assert.match(helper, /Não substitua essa primeira pergunta por "você já visitou algum loteamento\?"/);
});

test('lifestyle guidance evita resposta seca para calmaria e lazer', () => {
  assert.match(helper, /calmaria/);
  assert.match(helper, /lazer/);
  assert.match(helper, /sinal de estilo de vida/);
  assert.match(helper, /Antes de listar itens, acolha com uma frase consultiva e humana/);
  assert.match(helper, /Evite resposta seca/);
});

test('refino continua sendo somente contexto de prompt, nao fallback', () => {
  assert.doesNotMatch(helper, /sendAnaOutboundMessages/);
  assert.doesNotMatch(helper, /sendTextMessage/);
  assert.doesNotMatch(helper, /insertMessage/);
  assert.doesNotMatch(helper, /commitTurnResponse/);
  assert.doesNotMatch(helper, /markLeadQualificationQuestionAsked/);
});