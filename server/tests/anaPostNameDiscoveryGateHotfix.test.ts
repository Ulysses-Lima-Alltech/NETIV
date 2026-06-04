import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

function getPostNameGateBlock(): string {
  const logIndex = source.indexOf('[ANA_POST_NAME_DISCOVERY_GATE_BEFORE_LLM]');
  const gateEnd = source.indexOf('const proactiveVideoIntent = isProactiveVideoOfferIntent', logIndex);

  assert.ok(logIndex > -1, 'log do gate pós-nome não encontrado');
  assert.ok(gateEnd > logIndex, 'fim do gate pós-nome não encontrado');

  return source.slice(Math.max(0, logIndex - 3500), gateEnd);
}

test('post-name discovery gate existe antes de midia e antes do LLM', () => {
  const gateIndex = source.indexOf('[ANA_POST_NAME_DISCOVERY_GATE_BEFORE_LLM]');
  const mediaIndex = source.indexOf('const proactiveVideoIntent = isProactiveVideoOfferIntent');
  const llmDecisionIndex = source.indexOf('[ANA_LLM_DECISION]');

  assert.ok(gateIndex > -1, 'gate pós-nome não encontrado');
  assert.ok(mediaIndex > -1, 'marcador de mídia não encontrado');
  assert.ok(llmDecisionIndex > -1, 'marcador de LLM não encontrado');

  assert.ok(gateIndex < mediaIndex, 'gate pós-nome precisa vir antes de mídia/material');
  assert.ok(gateIndex < llmDecisionIndex, 'gate pós-nome precisa vir antes do LLM');
});

test('post-name discovery gate faz saudacao completa e pergunta morar investir conhecer', () => {
  const gate = getPostNameGateBlock();

  assert.match(gate, /leadQualificationNameCollectedThisTurn/);
  assert.match(gate, /Prazer,/);
  assert.match(gate, /perguntas rápidas/);
  assert.match(gate, /Você está pensando mais em morar, investir ou ainda está conhecendo as possibilidades\?/);
  assert.match(gate, /handler: 'lead_qualification_post_name_discovery_gate'/);
  assert.match(gate, /shouldCallQwen: false/);

  assert.doesNotMatch(gate, /generateChatCompletion/);
  assert.doesNotMatch(gate, /token_budget_fallback/);
});

test('lazer tem lead-in humano quando há contexto de estilo de vida', () => {
  assert.match(source, /\[ANA_LEISURE_LIFESTYLE_LEAD_IN_APPLIED\]/);
  assert.match(source, /effectiveCommercialRule\.ruleId === 'areas_lazer'/);
  assert.match(source, /Faz sentido/);
  assert.match(source, /lazer com tranquilidade/);
  assert.match(source, /commercialMessagesToSend\[0\]/);
});