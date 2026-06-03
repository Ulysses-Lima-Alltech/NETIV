import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { hasRecentExplicitVisitCta } from '../utils/anaEvoraCommercialGuards.js';
import { resolveAnaCommercialRule } from '../services/anaCommercialRulesService.js';

test('Teste 1: sem nome conhecido em entrada usa ordem resposta -> nome -> CTA no engine', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /shouldAskNameAfterCommercialReply/);
  assert.match(source, /effectiveCommercialRule\.ruleId !== 'entrada'/);
  assert.match(source, /commercialMessagesToSend\.push\(ANA_COMMERCIAL_RULES\.askNameMessage\)/);
  const entrada = resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage: 'qual a entrada?',
    isFirstAnaReply: false,
    previousAssistantMessage: null,
  });
  assert.match((entrada?.messages ?? []).join(' '), /simular.*corretor consegue|corretor consegue.*simular|simulação/i);
});

test('Teste 2: nome conhecido evita pergunta de nome', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /hasKnownCustomerName/);
  assert.match(source, /!hasKnownCustomerName/);
  assert.match(source, /shouldAskNameAfterCommercialReply/);
});

test('Teste 3: formas de pagamento mantém CTA padrão', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage: 'formas de pagamento',
    isFirstAnaReply: false,
    previousAssistantMessage: null,
  });
  assert.equal(rule?.ruleId, 'formas_pagamento');
  assert.match((rule?.messages ?? []).join(' '), /120x/);
  assert.match((rule?.messages ?? []).join(' '), /48x/);
});

test('Teste 4: com CTA de visita recente, política detecta excesso', () => {
  const over = hasRecentExplicitVisitCta([
    'Quer que eu te ajude a agendar uma visita?',
    'Outro texto',
  ]);
  assert.equal(over, true);
});

test('Teste 5: entrega do condomínio cai em entrega de empreendimento', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage: 'quando será entregue o condomínio?',
    isFirstAnaReply: false,
    previousAssistantMessage: null,
  });
  assert.equal(rule?.ruleId, 'entrega_empreendimento');
});

test('Teste 6: quanto vai ser o condomínio cai em valor condominial', () => {
  const rule = resolveAnaCommercialRule({
    enterpriseName: 'Évora',
    userMessage: 'quanto vai ser o condomínio?',
    isFirstAnaReply: false,
    previousAssistantMessage: null,
  });
  assert.equal(rule?.ruleId, 'valor_condominio');
});
