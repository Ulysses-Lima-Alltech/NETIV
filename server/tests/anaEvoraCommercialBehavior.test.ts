import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ANA_COMMERCIAL_RULES } from '../config/anaCommercialRules.js';
import { resolveAnaCommercialRule } from '../services/anaCommercialRulesService.js';
import { finalizeAnaReplyText } from '../utils/anaReplyFinalize.js';
import {
  buildLeadQualificationBridgeReply,
  detectAnaKnowledgeGap,
  isExplicitResolutionChoice,
} from '../utils/anaKnowledgeGapGuard.js';

test('first-contact Evora pergunta nome antes da apresentacao longa', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'Oi, queria saber mais sobre o Evora',
    isFirstAnaReply: true,
  });
  assert.equal(rule?.ruleId, 'first_contact');
  const msgs = rule?.messages ?? [];
  assert.equal(msgs.length, 2);
  const q = msgs.join('\n');
  assert.match(q, /nome/i);
  assert.doesNotMatch(q, /loteamento fechado em Atibaia/i);
  assert.equal((q.match(/\?/g) || []).length, 1);
  assert.match(q, /\?$/);
});

test('engine contem split deterministico de first-contact e short-circuit canonico', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /\[ANA_FIRST_CONTACT_RESPONSE_SPLIT\]/);
  assert.match(source, /\[ANA_CANONICAL_TURN_SHORT_CIRCUITED\]/);
  assert.match(source, /deterministic_commercial_rule_first_contact/);
});

test('regiao responde canonicamente em uma mensagem de conteudo sem link automatico', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'me fala da regiao la',
    isFirstAnaReply: false,
  });
  assert.equal(rule?.ruleId, 'localizacao_endereco');
  const msgs = rule?.messages ?? [];
  assert.equal(msgs.length, 3);
  const text = msgs.join('\n');
  assert.match(text, /Atibaia/i);
  assert.match(text, /Pedreira/i);
  assert.match(text, /Rio Abaixo/i);
  assert.match(text, /Rodovia Dom Pedro I/i);
  assert.match(text, /50 minutos de Sao Paulo|50 minutos de São Paulo/i);
  assert.equal(/maps\.app\.goo\.gl|google maps|https?:\/\//i.test(text), false);
  assert.equal(/Pinheirinho/i.test(text), false);
});

test('endereco/localizacao exata envia texto e link separados no engine', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /buildEvoraAddressCanonicalReply/);
  assert.match(source, /getEvoraCanonicalMapsLink/);
  assert.match(source, /locationLinkMessages: string\[\] = \[locationOverview\]/);
  assert.match(source, /locationLinkMessages\.push\(resolvedLocationLink\)/);
  assert.match(source, /https:\/\/maps\.app\.goo\.gl\/jBoxPM6XRut2iXHSA\?g_st=ic/);
});

test('guard de deduplicacao de regiao bloqueia segunda mensagem de mesmo nucleo', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /countEvoraRegionCoreSignals/);
  assert.match(source, /\[ANA_REGION_DUPLICATE_MESSAGE_BLOCKED\]/);
});

test('valor responde R$279.000,00 e R$775,00', () => {
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
  assert.match((rule?.messages || []).join(' '), /\b145\b/);
});

test('metragem geral responde 360 a 725', () => {
  const output = finalizeAnaReplyText('Posso confirmar depois.', {
    enterpriseName: 'Evora',
    userMessage: 'qual o tamanho dos lotes?',
  });
  assert.match(output, /360 m² a 725 m²|360 m2 a 725 m2/i);
  assert.match(output, /opcoes especificas variam|opções específicas variam/i);
});

test('metragem especifica 420/485/583 nao confirma disponibilidade', () => {
  const inputs = ['tem lote de 420m?', 'tem 485m?', 'tem lote 583m?'];
  for (const userMessage of inputs) {
    const output = finalizeAnaReplyText('Sim, ha lotes dessa metragem disponiveis.', {
      enterpriseName: 'Evora',
      userMessage,
    });
    assert.match(output, /360 m² a 725 m²|360 m2 a 725 m2/i);
    assert.match(output, /nao consigo confirmar disponibilidade|não consigo confirmar disponibilidade/i);
    assert.equal(/sim,\s*h[aá]/i.test(output), false);
  }
});

test('lazer nao gera numeral quebrado e usa estrutura autorizada', () => {
  const output = finalizeAnaReplyText('Tem algum ponto especifico que voce quer que eu detalhe melhor?', {
    enterpriseName: 'Evora',
    userMessage: 'e o lazer?',
  });
  assert.match(output, /piscina adulto/i);
  assert.match(output, /piscina infantil/i);
  assert.match(output, /coworking/i);
  assert.match(output, /beach tennis/i);
  assert.equal(/(^|\n)\s*1\s*$/m.test(output), false);
});

test('me conta mais apos lazer nao inventa e conduz contexto', () => {
  const output = finalizeAnaReplyText('1', {
    enterpriseName: 'Evora',
    userMessage: 'me conta mais',
  });
  assert.equal(/(^|\n)\s*1\s*$/m.test(output), false);
  assert.match(output, /quer seguir pela seguranca ou pela localizacao|quer seguir pela segurança ou pela localização/i);
});

test('oferta corretor/visita nao bloqueia pergunta nova', () => {
  assert.equal(isExplicitResolutionChoice('tem seguranca?'), null);
  assert.equal(isExplicitResolutionChoice('qual o valor?'), null);
  assert.equal(isExplicitResolutionChoice('me fala da regiao'), null);
  assert.equal(isExplicitResolutionChoice('e o lazer?'), null);
  assert.equal(isExplicitResolutionChoice('quantos lotes tem?'), null);
});

test('seguranca responde com portaria 24 horas e controle de acesso', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'seguranca',
    isFirstAnaReply: false,
  });
  assert.equal(rule?.ruleId, 'seguranca_portaria');
  const text = (rule?.messages ?? []).join('\n');
  assert.match(text, /portaria 24 horas/i);
  assert.match(text, /controle de acesso/i);
  assert.match(text, /moradores e visitantes/i);
  assert.match(text, /pesa bastante na sua decis/i);
});

test('tem seguranca responde dado concreto antes de perguntar prioridade', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'tem seguranca?',
    isFirstAnaReply: false,
  });
  const text = (rule?.messages ?? []).join('\n');
  assert.equal(rule?.ruleId, 'seguranca_portaria');
  assert.match(text, /portaria 24 horas/i);
  assert.match(text, /controle de acesso/i);
});

test('tem camera nao confirma camera e oferece corretor', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Evora',
    userMessage: 'tem camera?',
    isFirstAnaReply: false,
  });
  assert.equal(rule, null);
  const gap = detectAnaKnowledgeGap({
    userMessage: 'tem camera?',
  });
  assert.equal(gap.hasKnowledgeGap, true);
  assert.equal(gap.matchedIntent, 'surveillance_cameras');
  const reply = buildLeadQualificationBridgeReply({
    matchedIntent: gap.matchedIntent,
  });
  assert.match(reply, /cameras ou monitoramento interno/i);
  assert.match(reply, /nao tenho essa confirmacao liberada com seguranca/i);
  assert.match(reply, /corretor responsavel confirmar esse ponto/i);
  assert.equal(/\b(?:tem|conta com|possui)\s+cameras?\b/i.test(reply), false);
});

test('respostas canonicas nao prometem ponto de referencia ou referencia pela Dom Pedro I', () => {
  const commercialTexts = [
    ...ANA_COMMERCIAL_RULES.firstContactMessages,
    ...Object.values(ANA_COMMERCIAL_RULES.byIntent).flat(),
  ].join('\n');
  const engineSource = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  for (const text of [commercialTexts, engineSource]) {
    assert.doesNotMatch(text, /ponto de refer[eê]ncia no trajeto/i);
    assert.doesNotMatch(text, /refer[eê]ncia no trajeto/i);
    assert.doesNotMatch(text, /refer[eê]ncia pela Dom Pedro I/i);
  }
});

test('localizacao ainda envia endereco e link quando cliente pede endereco ou mapa', () => {
  const endereco = finalizeAnaReplyText('Nao tenho aqui.', {
    enterpriseName: 'Evora',
    userMessage: 'qual o endereco?',
  });
  assert.match(endereco, /Estrada dos Pires/i);
  assert.match(endereco, /Rio Abaixo/i);

  const mapa = finalizeAnaReplyText('Nao tenho aqui.', {
    enterpriseName: 'Evora',
    userMessage: 'me manda o mapa',
  });
  assert.match(mapa, /https:\/\/maps\.app\.goo\.gl\/jBoxPM6XRut2iXHSA\?g_st=ic/);

  const localizacao = finalizeAnaReplyText('Nao tenho aqui.', {
    enterpriseName: 'Evora',
    userMessage: 'onde fica?',
  });
  assert.match(localizacao, /Atibaia/i);
  assert.match(localizacao, /Rodovia Dom Pedro I/i);
});

test('Obrigado vira Obrigada', () => {
  const output = finalizeAnaReplyText('Muito obrigado pela mensagem. Obrigado!', {
    enterpriseName: 'Evora',
    userMessage: 'ok',
  });
  assert.equal(/obrigado/i.test(output), false);
  assert.match(output, /obrigada/i);
});

test('preco nao entra em knowledge gap apenas por eixo', () => {
  const result = detectAnaKnowledgeGap({
    userMessage: 'qual o valor do lote?',
    requestedAxis: 'preco',
  });
  assert.equal(result.hasKnowledgeGap, false);
});
