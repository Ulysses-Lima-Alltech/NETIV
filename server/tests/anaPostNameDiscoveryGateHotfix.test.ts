import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

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
  const gateStart = source.indexOf('[ANA_POST_NAME_DISCOVERY_GATE_BEFORE_LLM]');
  const gateRealStart = source.lastIndexOf('if (\n      evoraLeadQualificationEnabled', gateStart);
  const gateEnd = source.indexOf('const proactiveVideoIntent = isProactiveVideoOfferIntent', gateStart);

  assert.ok(gateStart > -1, 'gate pós-nome não encontrado');
  assert.ok(gateRealStart > -1, 'início real do gate pós-nome não encontrado');
  assert.ok(gateEnd > gateRealStart, 'fim do gate pós-nome não encontrado');

  const gate = source.slice(gateRealStart, gateEnd);

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