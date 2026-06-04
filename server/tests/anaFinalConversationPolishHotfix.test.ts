import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../config/anaCommercialRules.ts', import.meta.url), 'utf8');

test('lazer canonico começa com Lá tem e mantém pergunta de aprofundamento', () => {
  assert.match(rules, /Lá tem uma estrutura de lazer bem completa/);
  assert.match(rules, /Quer que eu te conte mais sobre os espaços para família, esportes ou convivência\?/);
});

test('quantidade de lotes não deixa assunto morrer', () => {
  assert.match(rules, /O Évora tem 145 lotes no total/);
  assert.match(rules, /Quer que eu te explique os tamanhos dos lotes, a localização\/acesso ou as formas de pagamento\?/);
});

test('lazer e quantidade de lotes podem usar resposta deterministica no Evora', () => {
  assert.match(engine, /commercialRuleAllowedAsOperationalDeterministic/);
  assert.match(engine, /effectiveCommercialRule\?\.ruleId === 'areas_lazer'/);
  assert.match(engine, /effectiveCommercialRule\?\.ruleId === 'quantidade_lotes_info_gap'/);
});

test('pedido explicito de corretor tem resposta convidativa e pede para aguardar contato', () => {
  assert.match(engine, /\[ANA_EVORA_BROKER_REQUEST_REPLY_USED\]/);
  assert.match(engine, /vou encaminhar você para o corretor responsável/);
  assert.match(engine, /Pode aguardar o contato dele por aqui/);
  assert.match(engine, /handler: 'evora_broker_request'/);
  assert.match(engine, /shouldCallQwen: false/);

  const idx = engine.indexOf('[ANA_EVORA_BROKER_REQUEST_REPLY_USED]');
  const around = engine.slice(Math.max(0, idx - 1800), idx + 3200);

  assert.doesNotMatch(around, /generateChatCompletion/);
  assert.doesNotMatch(around, /token_budget_fallback/);
});