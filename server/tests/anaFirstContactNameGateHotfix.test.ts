import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

function getNameGateBlock(): string {
  const logIndex = source.indexOf('[ANA_FIRST_CONTACT_NAME_GATE_BEFORE_LLM]');
  const gateEnd = source.indexOf('const proactiveVideoIntent = isProactiveVideoOfferIntent', logIndex);

  assert.ok(logIndex > -1, 'log do gate de nome não encontrado');
  assert.ok(gateEnd > logIndex, 'fim do gate de nome não encontrado');

  return source.slice(Math.max(0, logIndex - 3000), gateEnd);
}

test('first contact name gate roda antes de midia, regras comerciais e LLM', () => {
  const gateIndex = source.indexOf('[ANA_FIRST_CONTACT_NAME_GATE_BEFORE_LLM]');
  const mediaIndex = source.indexOf('const proactiveVideoIntent = isProactiveVideoOfferIntent');
  const llmDecisionIndex = source.indexOf('[ANA_LLM_DECISION]');

  assert.ok(gateIndex > -1, 'gate de nome do primeiro contato não encontrado');
  assert.ok(mediaIndex > -1, 'marcador de mídia não encontrado');
  assert.ok(llmDecisionIndex > -1, 'marcador de LLM não encontrado');

  assert.ok(gateIndex < mediaIndex, 'gate de nome precisa vir antes de mídia/material');
  assert.ok(gateIndex < llmDecisionIndex, 'gate de nome precisa vir antes do LLM');
});

test('first contact name gate nao usa LLM nem fallback', () => {
  const gate = getNameGateBlock();

  assert.match(gate, /buildLeadQualificationNameQuestion\(\)/);
  assert.match(gate, /handler: 'lead_qualification_name_gate'/);
  assert.match(gate, /shouldCallQwen: false/);
  assert.match(gate, /markAnaAskedForCustomerName\(conversationId\)/);

  assert.doesNotMatch(gate, /generateChatCompletion/);
  assert.doesNotMatch(gate, /buildCanonicalSafeReplyForMissingRag/);
  assert.doesNotMatch(gate, /token_budget_fallback/);
});

test('nome de linkedContact nao conta como nome confirmado do lead', () => {
  const knownQualificationIndex = source.indexOf('const knownQualificationName =');
  const knownQualificationSlice = source.slice(knownQualificationIndex, knownQualificationIndex + 220);

  assert.ok(knownQualificationIndex > -1, 'knownQualificationName não encontrado');
  assert.doesNotMatch(knownQualificationSlice, /linkedContact/);

  const hasKnownIndex = source.indexOf('const hasKnownCustomerName = Boolean(');
  const hasKnownSlice = source.slice(hasKnownIndex, hasKnownIndex + 220);

  assert.ok(hasKnownIndex > -1, 'hasKnownCustomerName não encontrado');
  assert.doesNotMatch(hasKnownSlice, /knownNameFromContact/);
  assert.doesNotMatch(hasKnownSlice, /linkedContact/);
});