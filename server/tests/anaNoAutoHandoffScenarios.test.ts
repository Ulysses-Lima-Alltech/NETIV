import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAnaCommercialRule } from '../services/anaCommercialRulesService.js';
import { readServerSourceFile } from './helpers/serverSourceResolver.js';

test('Teste 1: localização segue resposta comercial sem handoff automático no engine', () => {
  const rule = resolveAnaCommercialRule({ enterpriseName: 'Évora', userMessage: 'qual a localização?', isFirstAnaReply: false, previousAssistantMessage: null });
  assert.equal(rule?.ruleId, 'localizacao_endereco');
  const source = readServerSourceFile('services/conversationEngine.ts');
  assert.doesNotMatch(source, /classification:\s*'Handoff'/);
  assert.doesNotMatch(source, /handoff:\s*true/);
});

test('Teste 2: entrada segue regra comercial sem handoff automático', () => {
  const rule = resolveAnaCommercialRule({ enterpriseName: 'Évora', userMessage: 'qual a entrada?', isFirstAnaReply: false, previousAssistantMessage: null });
  assert.equal(rule?.ruleId, 'entrada');
  assert.equal(rule?.financialIntentType, 'personalized_financial_simulation');
  assert.match((rule?.messages ?? []).join(' '), /corretor.*simulação|simulação.*corretor/i);
});

test('Teste 3: entrega do condomínio cai em entrega_empreendimento', () => {
  const rule = resolveAnaCommercialRule({ enterpriseName: 'Évora', userMessage: 'quando será entregue o condomínio?', isFirstAnaReply: false, previousAssistantMessage: null });
  assert.equal(rule?.ruleId, 'entrega_empreendimento');
});

test('Teste 4: desconto cai em disponibilidade/simulação sem handoff', () => {
  const rule = resolveAnaCommercialRule({ enterpriseName: 'Évora', userMessage: 'tem desconto?', isFirstAnaReply: false, previousAssistantMessage: null });
  assert.equal(rule?.ruleId, 'disponibilidade_simulacao_desconto');
});

test('Teste 5: fallback/erro interno não promove handoff automático no código', () => {
  const source = readServerSourceFile('services/conversationEngine.ts');
  assert.doesNotMatch(source, /applyAnaConversationUpdate\([\s\S]*handoff:\s*true/);
});

test('Teste 6: lead quente pode existir sem pausar IA/handoff automático', () => {
  const source = readServerSourceFile('repositories/conversationRepository.ts');
  assert.match(source, /lead_temperature/);
  assert.match(source, /const handoff = handoffAlreadyActive/);
  assert.match(source, /updates automáticos da Ana nunca podem ativar handoff/i);
});

test('Teste 7: handoff manual via updateClassification permanece', () => {
  const source = readServerSourceFile('repositories/conversationRepository.ts');
  assert.match(source, /export async function updateClassification/);
  assert.match(source, /requestedHandoff/);
});
