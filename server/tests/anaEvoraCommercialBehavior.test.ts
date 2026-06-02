import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { resolveAnaCommercialRule } from '../services/anaCommercialRulesService.js';
import { finalizeAnaReplyText } from '../utils/anaReplyFinalize.js';
import { detectAnaKnowledgeGap, isExplicitResolutionChoice } from '../utils/anaKnowledgeGapGuard.js';

test('primeira resposta do fluxo comercial exige pergunta contextual no engine', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /\[ANA_FINAL_QUESTION_REQUIRED\]/);
  assert.match(source, /\[ANA_FINAL_QUESTION_MISSING\]/);
  assert.match(source, /deterministic_commercial_rule_first_contact/);
  assert.match(source, /pickContextualCommercialFollowupQuestion/);
});

test('regiao/localizacao usa base canonica do Evora sem referencia inventada', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'me fala da regiao',
    isFirstAnaReply: false,
  });
  assert.equal(rule?.ruleId, 'localizacao_endereco');
  const text = (rule?.messages || []).join(' ');
  assert.match(text, /Atibaia/i);
  assert.match(text, /Pedreira\/Rio Abaixo/i);
  assert.match(text, /Rodovia Dom Pedro I/i);
  assert.match(text, /50 minutos de Sao Paulo|50 minutos de São Paulo/i);
  assert.equal(/Pinheirinho/i.test(text), false);
});

test('localizacao com link envia em partes separadas no engine', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /\[ANA_LOCATION_RESPONSE_SPLIT\]/);
  assert.match(source, /\[ANA_LOCATION_LINK_SENT\]/);
  assert.match(source, /locationLinkMessages\.push\(resolvedLocationLink\)/);
  assert.match(source, /https:\/\/maps\.app\.goo\.gl\/jBoxPM6XRut2iXHSA\?g_st=ic/);
});

test('pergunta de valor responde base canonica sem fallback de ausencia de dado', () => {
  const output = finalizeAnaReplyText('Ainda nao tenho esse valor por aqui.', {
    enterpriseName: 'Evora',
    userMessage: 'qual o valor do lote?',
  });
  assert.match(output, /R\$279\.000,00/);
  assert.match(output, /R\$775,00/);
  assert.match(output, /valor final depende da unidade/i);
  assert.equal(/nao tenho|não tenho/i.test(output), false);
});

test('quantidade de lotes responde 145', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'quantos lotes tem?',
    isFirstAnaReply: false,
  });
  assert.equal(rule?.ruleId, 'quantidade_lotes_info_gap');
  const text = (rule?.messages || []).join(' ');
  assert.match(text, /\b145\b/);
});

test('pedido de metragem especifica nao confirma disponibilidade pontual', () => {
  const output = finalizeAnaReplyText('Sim, ha lotes de 420 m2 disponiveis.', {
    enterpriseName: 'Evora',
    userMessage: 'tem lote de 420m?',
  });
  assert.match(output, /360 m² a 725 m²|360 m2 a 725 m2/i);
  assert.match(output, /nao consigo confirmar disponibilidade|não consigo confirmar disponibilidade/i);
  assert.equal(/sim,\s*h[aá]/i.test(output), false);
});

test('metragem geral responde faixa 360 a 725 sem prometer unidade', () => {
  const output = finalizeAnaReplyText('Posso confirmar depois.', {
    enterpriseName: 'Evora',
    userMessage: 'qual o tamanho dos lotes?',
  });
  assert.match(output, /360 m² a 725 m²|360 m2 a 725 m2/i);
  assert.match(output, /opcoes especificas variam|opções específicas variam/i);
});

test('lazer vem bonito e sem numeral quebrado', () => {
  const output = finalizeAnaReplyText('Tem algum ponto especifico que voce quer que eu detalhe melhor?', {
    enterpriseName: 'Evora',
    userMessage: 'e o lazer?',
  });
  assert.match(output, /piscina adulto/i);
  assert.match(output, /piscina infantil/i);
  assert.match(output, /academia/i);
  assert.match(output, /salao de festas|salão de festas/i);
  assert.match(output, /playground/i);
  assert.match(output, /coworking/i);
  assert.match(output, /espaco zen|espaço zen/i);
  assert.match(output, /fireplace/i);
  assert.match(output, /beach tennis/i);
  assert.match(output, /campo society/i);
  assert.match(output, /praca interna|praça interna/i);
  assert.match(output, /areas verdes|áreas verdes/i);
  assert.equal(/(^|\n)\s*1\s*$/m.test(output), false);
});

test('"me conta mais" depois de lazer nao inventa detalhe', () => {
  const output = finalizeAnaReplyText('1', {
    enterpriseName: 'Evora',
    userMessage: 'me conta mais',
  });
  assert.equal(/(^|\n)\s*1\s*$/m.test(output), false);
  assert.match(output, /quer seguir pela seguranca ou pela localizacao|quer seguir pela segurança ou pela localização/i);
});

test('"Obrigado" vira "Obrigada"', () => {
  const output = finalizeAnaReplyText('Muito obrigado pela mensagem. Obrigado!', {
    enterpriseName: 'Evora',
    userMessage: 'ok',
  });
  assert.equal(/obrigado/i.test(output), false);
  assert.match(output, /obrigada/i);
});

test('oferta corretor/visita nao bloqueia pergunta nova', () => {
  assert.equal(isExplicitResolutionChoice('tem seguranca?'), null);
  assert.equal(isExplicitResolutionChoice('qual o valor?'), null);
});

test('preco nao entra em knowledge gap apenas por eixo', () => {
  const result = detectAnaKnowledgeGap({
    userMessage: 'qual o valor do lote?',
    requestedAxis: 'preco',
  });
  assert.equal(result.hasKnowledgeGap, false);
});
