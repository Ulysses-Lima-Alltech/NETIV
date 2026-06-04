import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

test('Ana nao deve oferecer visita cedo demais apos ainda nao', () => {
  assert.match(source, /nao ofereca agendamento de visita cedo demais/);
  assert.match(source, /especialmente quando o cliente apenas respondeu "ainda nao" sobre ja ter visitado/);
  assert.match(source, /Antes de pedir dia\/horario de visita, responda as duvidas do cliente/);
});

test('Ana deve resgatar temas apos aprofundar um assunto', () => {
  assert.match(source, /resgate outros temas úteis/);
  assert.match(source, /segurança, região\/acesso ou os lotes/);
  assert.match(source, /Ao aprofundar um assunto especifico, como beach tennis, piscina ou seguranca/);
});

test('resgate de temas em resposta canonica nao chama LLM nem fallback', () => {
  assert.match(source, /\[ANA_TOPIC_RESCUE_QUESTION_APPENDED\]/);
  assert.match(source, /effectiveCommercialRule\.ruleId === 'areas_lazer'/);
  assert.match(source, /effectiveCommercialRule\.ruleId === 'seguranca_portaria'/);

  const idx = source.indexOf('[ANA_TOPIC_RESCUE_QUESTION_APPENDED]');
  const around = source.slice(Math.max(0, idx - 1200), idx + 1200);

  assert.doesNotMatch(around, /generateChatCompletion/);
  assert.doesNotMatch(around, /token_budget_fallback/);
  assert.match(around, /Além desse ponto, quer que eu te explique também sobre segurança, região\/acesso ou os lotes\?/);
});