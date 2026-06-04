import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../config/anaCommercialRules.ts', import.meta.url), 'utf8');

test('seguranca canonica usa texto consultivo sem fallback seco', () => {
  assert.match(rules, /Esse é um ponto importante/);
  assert.match(rules, /portaria 24 horas e controle de acesso/);
  assert.match(rules, /rotina mais reservada e segura/);
  assert.match(rules, /Quer que eu te explique também sobre localização\/acesso, lazer ou os tamanhos dos lotes\?/);
});

test('seguranca canonica nao usa alegacoes ruins de fallback', () => {
  assert.doesNotMatch(rules, /Nada de pessoas externas circulando/);
  assert.doesNotMatch(rules, /monitoramento e infraestrutura exclusiva/);
});

test('seguranca_portaria fica deterministica no Evora igual lazer e lotes', () => {
  assert.match(engine, /commercialRuleAllowedAsOperationalDeterministic/);
  assert.match(engine, /effectiveCommercialRule\?\.ruleId === 'areas_lazer'/);
  assert.match(engine, /effectiveCommercialRule\?\.ruleId === 'seguranca_portaria'/);
  assert.match(engine, /effectiveCommercialRule\?\.ruleId === 'quantidade_lotes_info_gap'/);
});