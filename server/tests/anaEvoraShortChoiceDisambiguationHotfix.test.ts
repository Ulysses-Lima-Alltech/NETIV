import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

test('confirmacao curta quero apos seguranca ou localizacao pede escolha', () => {
  assert.match(engine, /\[ANA_EVORA_SHORT_CHOICE_DISAMBIGUATION_GUARD\]/);
  assert.match(engine, /evoraLastOfferedSecurityAndLocation/);
  assert.match(engine, /Você prefere que eu te explique sobre segurança ou sobre localização\?/);
});

test('confirmacao curta ambigua nao repete lazer quando a ultima pergunta ofereceu seguranca ou localizacao', () => {
  assert.match(engine, /security_or_location_ambiguous_short_confirmation/);
  assert.match(engine, /lastAssistantPreview/);
  assert.match(engine, /\^\(quero\|quero sim\|sim\|sim quero\|pode\|pode sim/);
});

test('confirmacao curta apos pagamento ou visita pede escolha objetiva', () => {
  assert.match(engine, /evoraLastOfferedPaymentOrVisit/);
  assert.match(engine, /Você prefere que eu te explique as formas de pagamento ou quer agendar uma visita\?/);
});

test('confirmacao curta apos subtopicos de lazer pede subtopico', () => {
  assert.match(engine, /evoraLastOfferedLeisureSubtopics/);
  assert.match(engine, /Você prefere que eu fale dos espaços para família, esportes ou convivência\?/);
});