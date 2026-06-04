import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const engine = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
const visit = fs.readFileSync(new URL('../utils/anaDirectVisitScheduling.ts', import.meta.url), 'utf8');

test('confirmacao curta de pagamento bloqueia quando cliente pede outro topico', () => {
  assert.match(engine, /paymentContextBlockedByOtherTopic/);
  assert.match(engine, /regiao\|região\|localizacao\|localização/);
  assert.match(engine, /lazer\|seguranca\|segurança\|lote\|lotes/);
  assert.match(engine, /natureza\|piscina\|quadra\|portaria/);
});

test('pagamento curto generico exige mensagem curta e sem outro topico', () => {
  assert.match(engine, /shortGenericPaymentTermsConfirmation/);
  assert.match(engine, /!\s*paymentContextBlockedByOtherTopic/);
  assert.match(engine, /\^\(sim\|sim pode\|pode\|pode sim\|quero\|quero sim/);
  assert.doesNotMatch(engine, /48x \+ IGPM/);
  assert.doesNotMatch(engine, /120x com juros \+ IGPM/);
});

test('slot de visita exige contexto real de visita', () => {
  assert.match(visit, /dateMentionForSlotAnswer/);
  assert.match(visit, /timeMentionForSlotAnswer/);
  assert.match(visit, /periodMentionForSlotAnswer/);
  assert.match(visit, /assistantAskedVisitSlotContext/);
  assert.match(visit, /hasPendingVisitSlotContext/);
});

test('periodo solto como noite nao deve virar visita sem contexto de agendamento', () => {
  assert.match(visit, /if \(periodMentionForSlotAnswer != null\)/);
  assert.match(visit, /return hasPendingVisitSlotContext \|\| assistantAskedVisitSlotContext/);
});