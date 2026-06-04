import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
const paymentTest = fs.readFileSync(new URL('./anaEvoraPaymentGeneralHotfix.test.ts', import.meta.url), 'utf8');

test('pagamento deterministico nao menciona IGPM', () => {
  assert.doesNotMatch(engine, /48x \+ IGPM/);
  assert.doesNotMatch(engine, /120x com juros \+ IGPM/);
  assert.doesNotMatch(paymentTest, /48x \+ IGPM/);
  assert.doesNotMatch(paymentTest, /120x com juros \+ IGPM/);
});

test('Ana usa helper para nao repetir tema ja respondido', () => {
  assert.match(engine, /\[ANA_EVORA_SAFE_NEXT_TOPIC_QUESTION_HELPER\]/);
  assert.match(engine, /buildEvoraSafeNextTopicQuestion/);
  assert.match(engine, /topicSeen/);
  assert.match(engine, /assistantTopicText/);
});

test('quando temas se esgotam Ana oferece visita', () => {
  assert.match(engine, /Já te passei os principais pontos do Évora/);
  assert.match(engine, /Que tal agendarmos uma visita/);
});

test('respostas canonicas substituem pergunta final por oferta segura', () => {
  assert.match(engine, /\[ANA_EVORA_NON_REPEATED_TOPIC_OFFER_APPLIED\]/);
  assert.match(engine, /stripEvoraTrailingQuestion/);
  assert.match(engine, /commercialMessagesToSend\.push\(safeNextTopicQuestion\)/);
});

test('endereco localizacao pagamento e lotes usam pergunta segura', () => {
  assert.match(engine, /const contextualLocationQuestion = buildEvoraSafeNextTopicQuestion\('localizacao'\)/);
  assert.match(engine, /buildEvoraSafeNextTopicQuestion\('valores'\)/);
  assert.match(engine, /buildEvoraSafeNextTopicQuestion\('lotes'\)/);
});