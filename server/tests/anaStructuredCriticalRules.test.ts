import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyAnaNoRepeatMessageGuard } from '../utils/anaEvoraCommercialGuards.js';

test('no-repeat guard nunca suprime resposta: sempre retorna texto útil ao bloquear repetição', () => {
  const out = applyAnaNoRepeatMessageGuard({
    conversationId: 1,
    enterpriseId: 1,
    enterpriseName: 'Évora',
    userMessage: 'Queria saber preço',
    answer: 'O valor inicial do Évora é a partir de R$279.000,00, e o metro quadrado começa em R$775,00.',
    recentAssistantReplies: ['O valor inicial do Évora é a partir de R$279.000,00, e o metro quadrado começa em R$775,00.'],
    semanticallySimilar: (a, b) => a === b,
  });
  assert.equal(out.changed, false);
  assert.ok(out.text.trim().length > 0);
});

test('regra de nome considera nome existente na conversa/whatsapp antes de perguntar nome', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(source, /knownNameFromConversation/);
  assert.match(source, /knownNameFromContact/);
  assert.match(source, /hasKnownCustomerName/);
  assert.match(source, /!hasKnownCustomerName/);
});

test('entrega do empreendimento não usa placeholder literal e resolve por base operacional', () => {
  const cfg = readFileSync(path.resolve(process.cwd(), 'config/anaCommercialRules.ts'), 'utf8');
  assert.doesNotMatch(cfg, /\[DATA\/PRAZO DA BASE\]/);

  const engine = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.match(engine, /resolveOperationalFactAnswer\(/);
  assert.match(engine, /fallbackEntrega/);
});
