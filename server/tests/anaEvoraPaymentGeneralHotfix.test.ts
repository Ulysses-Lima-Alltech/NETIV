import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

test('assistantNameQuestionRegex nao contem replacement character', () => {
  const replacementChar = String.fromCharCode(0xfffd);
  assert.equal(source.includes(replacementChar), false);
  assert.match(source, /const assistantNameQuestionRegex =/);
  assert.match(source, /qual\(\?:\\s\+é\)\?\\s\+seu\\s\+nome/);
});

test('pagamento geral do Evora e respondido antes de knowledge gap', () => {
  const paymentIndex = source.indexOf('[ANA_EVORA_PAYMENT_GENERAL_AUTHORIZED_USED]');
  const gapIndex = source.indexOf('const knowledgeGapMeta = detectAnaKnowledgeGap');

  assert.ok(paymentIndex > -1, 'handler autorizado de pagamento geral não encontrado');
  assert.ok(gapIndex > -1, 'knowledge gap não encontrado');
  assert.ok(paymentIndex < gapIndex, 'pagamento geral precisa ser tratado antes de knowledge gap');
});

test('pagamento geral autorizado contem entrada, 48x, 120x e financiamento direto', () => {
  assert.match(source, /entrada padrão do Évora é de 20%/);
  assert.match(source, /sem juros em até 48x/);
  assert.match(source, /120x com juros/);
  assert.match(source, /financiamento é direto com a incorporadora\/construtora/);
});

test('pagamento personalizado continua separado de pagamento geral', () => {
  assert.match(source, /evoraPaymentPersonalizedIntent/);
  assert.match(source, /simulacao\|simulação\|simular/);
  assert.match(source, /valor da parcela/);
  assert.match(source, /desconto/);
  assert.match(source, /proposta/);
});

test('handler de pagamento geral usa eixo financiamento e nao chama LLM nem fallback', () => {
  const idx = source.indexOf('[ANA_EVORA_PAYMENT_GENERAL_AUTHORIZED_USED]');
  const around = source.slice(Math.max(0, idx - 1800), idx + 3200);

  assert.doesNotMatch(around, /generateChatCompletion/);
  assert.doesNotMatch(around, /token_budget_fallback/);
  assert.doesNotMatch(around, /buildCanonicalSafeReplyForMissingRag/);
  assert.match(around, /handler: 'evora_payment_general_authorized'/);
  assert.match(around, /commercialAxis: 'financiamento'/);
  assert.match(around, /shouldCallQwen: false/);
});