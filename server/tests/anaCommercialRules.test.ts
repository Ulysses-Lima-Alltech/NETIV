import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('primeiro contato Evora gera exatamente 3 mensagens exatas e separadas', () => {
  const source = readFileSync(new URL('../config/anaCommercialRules.ts', import.meta.url), 'utf8');
  assert.match(source, /firstContactMessages:\s*\[/);
  assert.match(source, /O Évora é um loteamento fechado em Atibaia, com lotes a partir de 360 m², infraestrutura planejada, lazer completo e segurança 24 horas\./);
  assert.match(source, /Fácil acesso pela Rodovia Dom Pedro I, perto da área da Pedreira, a aproximadamente 50 minutos de Sao Paulo\./);
  assert.match(source, /Me conta, quais são suas dúvidas\? Vou responder todas\./);
});

test('valor do metro quadrado retorna regra correta', () => {
  const source = readFileSync(new URL('../config/anaCommercialRules.ts', import.meta.url), 'utf8');
  assert.match(source, /valor_metro_quadrado/);
  assert.match(source, /R\$775,00/);
});

test('condominio retorna regra correta', () => {
  const source = readFileSync(new URL('../config/anaCommercialRules.ts', import.meta.url), 'utf8');
  assert.match(source, /valor_condominio/);
  assert.match(source, /R\$400,00/);
  assert.match(source, /R\$700,00/);
});

test('lazer retorna lista correta', () => {
  const source = readFileSync(new URL('../config/anaCommercialRules.ts', import.meta.url), 'utf8');
  for (const token of ['Piscina adulto', 'Academia', 'Salão de festas', 'Playground', 'Coworking', 'Espaço zen', 'Fireplace', 'Quadra de beach tennis', 'Campo society']) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\\]\\]/g, '\\\\$&')));
  }
  assert.match(source, /Não posso deixar de comentar que o Évora é um verdadeiro paraíso/);
});

test('localizacao retorna regra correta', () => {
  const source = readFileSync(new URL('../config/anaCommercialRules.ts', import.meta.url), 'utf8');
  assert.match(source, /localizacao_regiao/);
  assert.match(source, /região bragantina|regiao bragantina/);
  assert.doesNotMatch(source, /acesso é facilitado.*Lucas Nogueira Garces/i);
});

test('conversationEngine remove deterministic_direct_interest e mantém commercial_rules', () => {
  const source = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /detectAnaDirectBatchInterestMessage/);
  assert.doesNotMatch(source, /buildAnaDirectBatchInterestReply/);
  assert.doesNotMatch(source, /buildAnaDirectBatchInterestReplies/);
  assert.doesNotMatch(source, /deterministic_direct_interest/);
  assert.match(source, /ANA_COMMERCIAL_RULE_FIRST_CONTACT_START/);
  assert.match(source, /resolveAnaCommercialRule\(\{/);
  const idxRule = source.indexOf('resolveAnaCommercialRule({');
  const idxOpenAi = source.indexOf('generateChatCompletion(');
  assert.ok(idxRule >= 0 && idxOpenAi > idxRule, 'commercial rule should be checked before OpenAI');
});
