import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

test('sim apos oferta de formas de pagamento herda contexto e dispara pagamento geral', () => {
  assert.match(engine, /previousAssistantOfferedPaymentTerms/);
  assert.match(engine, /shortPaymentTermsConfirmation/);
  assert.match(engine, /evoraPaymentExplicitGeneralIntent/);
  assert.match(engine, /\(evoraPaymentExplicitGeneralIntent \|\| shortPaymentTermsConfirmation\)/);
});

test('confirmacao curta de pagamento depende da mensagem anterior da Ana', () => {
  assert.match(engine, /normText\(lastAssistantPlain \?\? ''\)/);
  assert.match(engine, /formas de pagamento\|forma de pagamento/);
  assert.match(engine, /entrada\|parcelamento\|financiamento/);
});

test('confirmacao curta suporta sim pode quero e explica', () => {
  assert.match(engine, /sim\|sim pode\|pode\|pode sim\|quero\|quero sim/);
  assert.match(engine, /me explica\|me explique\|explica\|explique/);
});

test('pagamento continua deterministico sem LLM e sem IGPM', () => {
  const idx = engine.indexOf('[ANA_EVORA_PAYMENT_GENERAL_AUTHORIZED_USED]');
  const around = engine.slice(Math.max(0, idx - 2400), idx + 4200);

  assert.ok(idx > -1, 'handler de pagamento geral não encontrado');
  assert.doesNotMatch(around, /generateChatCompletion/);
  assert.doesNotMatch(around, /token_budget_fallback/);
  assert.doesNotMatch(around, /buildCanonicalSafeReplyForMissingRag/);
  assert.doesNotMatch(engine, /48x \+ IGPM/);
  assert.doesNotMatch(engine, /120x com juros \+ IGPM/);
});