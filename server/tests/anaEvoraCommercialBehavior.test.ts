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

test('regiao/localizacao usa base canonica do Evora', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage: 'onde fica?',
    isFirstAnaReply: false,
  });
  assert.equal(rule?.ruleId, 'localizacao_endereco');
  const text = (rule?.messages || []).join(' ');
  assert.match(text, /Atibaia/i);
  assert.match(text, /Pedreira\/Rio Abaixo/i);
  assert.match(text, /Rodovia Dom Pedro I/i);
  assert.match(text, /50 minutos de São Paulo/i);
});

test('localizacao com link envia em partes separadas no engine', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /\[ANA_LOCATION_RESPONSE_SPLIT\]/);
  assert.match(source, /\[ANA_LOCATION_LINK_SENT\]/);
  assert.match(source, /locationLinkMessages\.push\(resolvedLocationLink\)/);
});

test('pergunta de valor responde base canonica sem fallback de ausencia de dado', () => {
  const output = finalizeAnaReplyText('Ainda nao tenho esse valor por aqui.', {
    enterpriseName: 'Évora',
    userMessage: 'qual o valor do lote?',
  });
  assert.match(output, /R\$279\.000,00/);
  assert.match(output, /R\$775,00/);
  assert.equal(/nao tenho|não tenho/i.test(output), false);
});

test('pedido de metragem especifica nao confirma disponibilidade pontual', () => {
  const output = finalizeAnaReplyText('Sim, há lotes de 420 m² disponíveis.', {
    enterpriseName: 'Évora',
    userMessage: 'tem lote de 420m?',
  });
  assert.match(output, /360 m² a 775 m²/i);
  assert.match(output, /corretor responsável|corretor responsavel/i);
  assert.equal(/sim,\s*h[aá]/i.test(output), false);
});

test('"qual o tamanho" responde faixa de metragem sem prometer unidade', () => {
  const output = finalizeAnaReplyText('Posso confirmar depois.', {
    enterpriseName: 'Évora',
    userMessage: 'qual o tamanho dos lotes?',
  });
  assert.match(output, /360 m² a 775 m²/i);
  assert.match(output, /corretor responsável|corretor responsavel/i);
});

test('lazer vem em formato WhatsApp com itens autorizados e sem numeral quebrado', () => {
  const output = finalizeAnaReplyText('Tem algum ponto específico que você quer que eu detalhe melhor?', {
    enterpriseName: 'Évora',
    userMessage: 'quais as áreas de lazer?',
  });
  assert.match(output, /Piscina adulto/);
  assert.match(output, /Academia/);
  assert.match(output, /Salão de festas|Salao de festas/);
  assert.match(output, /Playground/);
  assert.match(output, /Coworking/);
  assert.match(output, /Espaço zen|Espaco zen/);
  assert.match(output, /Fireplace/);
  assert.match(output, /Quadra de beach tennis/);
  assert.match(output, /Campo society/);
  assert.match(output, /Estação para carros elétricos|Estacao para carros eletricos/);
  assert.match(output, /Portaria 24h com controle de acesso/);
  assert.equal(/\n\d+\s*$/.test(output), false);
});

test('"me conta mais" depois de lazer nao inventa detalhe nem gera lista quebrada', () => {
  const output = finalizeAnaReplyText('1', {
    enterpriseName: 'Évora',
    userMessage: 'me conta mais',
  });
  assert.equal(/\b1\b/.test(output), false);
  assert.match(output, /segurança|seguranca|localização|localizacao|corretor/i);
});

test('"Obrigado" vira "Obrigada" no guard final', () => {
  const output = finalizeAnaReplyText('Muito obrigado pela mensagem. Obrigado!', {
    enterpriseName: 'Évora',
    userMessage: 'ok',
  });
  assert.equal(/obrigado/i.test(output), false);
  assert.match(output, /obrigada/i);
});

test('pergunta nova apos oferta continua bypassando pending_resolution_choice', () => {
  assert.equal(isExplicitResolutionChoice('tem lote de 420m?'), null);
});

test('preco nao entra em knowledge gap apenas por eixo', () => {
  const result = detectAnaKnowledgeGap({
    userMessage: 'qual o valor do lote?',
    requestedAxis: 'preco',
  });
  assert.equal(result.hasKnowledgeGap, false);
});
