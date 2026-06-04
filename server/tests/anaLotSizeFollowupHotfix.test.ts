import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
const rules = fs.readFileSync(new URL('../config/anaCommercialRules.ts', import.meta.url), 'utf8');

test('quero mais sobre lotes e tamanhos tem handler deterministico', () => {
  assert.match(engine, /\[ANA_EVORA_LOT_SIZE_FOLLOWUP_USED\]/);
  assert.match(engine, /customer_asked_lot_sizes_after_offer/);
  assert.match(engine, /handler: 'evora_lot_size_followup'/);
  assert.match(engine, /shouldCallQwen: false/);
});

test('handler de lotes responde somente o que sabe e usa pergunta segura dinamica', () => {
  assert.match(engine, /O Évora tem 145 lotes no total, com metragens de 360 m² a 725 m²/);
  assert.match(engine, /As opções específicas mudam conforme disponibilidade/);
  assert.match(engine, /buildEvoraSafeNextTopicQuestion\('lotes'\)/);
});

test('regra de metragem nao oferece tipo de lote que nao sabe responder', () => {
  assert.match(rules, /Os lotes do Évora vão de 360 m² a 725 m²/);
  assert.doesNotMatch(rules, /Quer que eu te explique os tipos de lote que existem no empreendimento/);
  assert.match(rules, /Quer que eu te fale agora sobre valores\/formas de pagamento ou sobre localização\/acesso\?/);
});

test('handler de lotes nao chama LLM nem fallback', () => {
  const idx = engine.indexOf('[ANA_EVORA_LOT_SIZE_FOLLOWUP_USED]');
  const around = engine.slice(Math.max(0, idx - 2600), idx + 4300);

  assert.doesNotMatch(around, /generateChatCompletion/);
  assert.doesNotMatch(around, /token_budget_fallback/);
  assert.doesNotMatch(around, /buildCanonicalSafeReplyForMissingRag/);
});