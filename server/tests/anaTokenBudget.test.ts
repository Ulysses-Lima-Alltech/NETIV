import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnaCommercialSpecificNoLlmReply,
  detectAnaCommercialSpecificNoLlmIntent,
  evaluateAnaTokenBudget,
} from '../utils/anaTokenBudget.js';

test('ana token budget classifica prompt acima do teto como block', () => {
  const decision = evaluateAnaTokenBudget(
    [
      { role: 'system', content: 'x'.repeat(22_000) },
      { role: 'user', content: 'Qual o valor?' },
    ],
    {
      auditEnabled: true,
      targetInputTokens: 1500,
      warnInputTokens: 3000,
      shrinkInputTokens: 4000,
      blockInputTokens: 5000,
      disableSameContextRetryAbove: 3500,
      priceMissingNoLlm: true,
      maxOutputTokens: 220,
      ragMaxChunks: 3,
      recentMessagesMax: 8,
    }
  );

  assert.equal(decision.level, 'block');
  assert.equal(decision.shouldBlock, true);
});

test('ana detecta intents comerciais especificas para bypass sem LLM', () => {
  assert.equal(detectAnaCommercialSpecificNoLlmIntent('Consegue simular pra mim?'), 'simulation');
  assert.equal(detectAnaCommercialSpecificNoLlmIntent('Manda a tabela comercial'), 'commercial_table');
  assert.equal(detectAnaCommercialSpecificNoLlmIntent('Tem desconto nesse lote?'), 'discount');
});

test('fallback comercial seguro nao menciona NETIV e conduz para corretor ou visita', () => {
  const reply = buildAnaCommercialSpecificNoLlmReply({
    intent: 'simulation',
    userMessage: 'Consegue simular pra mim?',
  });

  assert.doesNotMatch(reply, /NETIV/i);
  assert.match(reply, /corretor|visita/i);
});

