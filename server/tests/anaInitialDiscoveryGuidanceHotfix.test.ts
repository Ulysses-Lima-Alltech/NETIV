import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

test('initial discovery guidance existe apenas como contexto de prompt do LLM', () => {
  assert.match(source, /function buildInitialDiscoveryGuidanceContext/);
  assert.match(source, /Isto não é fallback, não é resposta pronta e não deve interceptar o LLM/);
  assert.match(source, /Use apenas como ponto de partida conversacional depois da captura do nome/);
  assert.match(source, /compactConversationalKnowledge,\s*initialDiscoveryGuidanceContext,/);
  assert.match(source, /messages\.push\(\{ role: 'system', content: initialDiscoveryGuidanceContext \}\)/);
  assert.match(source, /\[ANA_INITIAL_DISCOVERY_GUIDANCE_INJECTED\]/);
});

test('initial discovery guidance nao envia resposta, nao comita turno e nao marca pergunta deterministica', () => {
  const helperStart = source.indexOf('function buildInitialDiscoveryGuidanceContext');
  const helperEnd = source.indexOf('function isInitialQualificationClarificationMessage', helperStart);

  assert.ok(helperStart > -1, 'helper buildInitialDiscoveryGuidanceContext nao encontrado');
  assert.ok(helperEnd > helperStart, 'fim do helper nao encontrado');

  const helper = source.slice(helperStart, helperEnd);

  assert.doesNotMatch(helper, /commitTurnResponse/);
  assert.doesNotMatch(helper, /sendAnaOutboundMessages/);
  assert.doesNotMatch(helper, /sendTextMessage/);
  assert.doesNotMatch(helper, /insertMessage/);
  assert.doesNotMatch(helper, /markLeadQualificationQuestionAsked/);
  assert.doesNotMatch(helper, /buildEvoraLeadQualificationProgressReply/);
  assert.doesNotMatch(helper, /buildEvoraShortPresentationAfterName/);
});

test('initial discovery guidance preserva LLM-first e orienta a responder pergunta objetiva antes de qualificar', () => {
  const helperStart = source.indexOf('function buildInitialDiscoveryGuidanceContext');
  const helperEnd = source.indexOf('function isInitialQualificationClarificationMessage', helperStart);
  const helper = source.slice(helperStart, helperEnd);

  assert.match(helper, /isObjectiveCustomerQuestion\(params\.userMessage\)/);
  assert.match(helper, /Responda primeiro a pergunta dele/);
  assert.match(helper, /apenas UMA pergunta de descoberta/);
  assert.match(helper, /Não pergunte todos os tópicos de uma vez/);
});