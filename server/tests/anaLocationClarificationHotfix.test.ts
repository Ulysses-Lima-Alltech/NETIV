import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

test('nao sei onde fica tem handler deterministico de localizacao', () => {
  assert.match(engine, /\[ANA_EVORA_LOCATION_CLARIFICATION_USED\]/);
  assert.match(engine, /nao sei onde fica/);
  assert.match(engine, /customer_does_not_know_location/);
  assert.match(engine, /handler: 'evora_location_clarification'/);
  assert.match(engine, /shouldCallQwen: false/);
});

test('handler de localizacao explica e usa pergunta segura dinamica', () => {
  assert.match(engine, /O Évora fica em Atibaia, na região da Pedreira, bairro Rio Abaixo/);
  assert.match(engine, /acesso pela Rodovia Dom Pedro I/);
  assert.match(engine, /a cerca de 50 minutos de São Paulo/);
  assert.match(engine, /buildEvoraSafeNextTopicQuestion\('localizacao'\)/);
});

test('handler de localizacao nao chama LLM nem fallback', () => {
  const idx = engine.indexOf('[ANA_EVORA_LOCATION_CLARIFICATION_USED]');
  const around = engine.slice(Math.max(0, idx - 2400), idx + 4200);

  assert.doesNotMatch(around, /generateChatCompletion/);
  assert.doesNotMatch(around, /token_budget_fallback/);
  assert.doesNotMatch(around, /buildCanonicalSafeReplyForMissingRag/);
});