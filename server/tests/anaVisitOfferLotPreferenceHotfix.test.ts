import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

const visit = fs.readFileSync(new URL('../utils/anaDirectVisitScheduling.ts', import.meta.url), 'utf8');

test('aceite de visita reconhece vamos sim e oferta com agendarmos', () => {
  assert.match(visit, /vamos sim/);
  assert.match(visit, /agendarmos uma visita/);
  assert.match(visit, /que tal agendarmos/);
});

test('preferencia perto da piscina nao vira troca para lazer', () => {
  assert.match(visit, /function extractVisitLotPreference/);
  assert.match(visit, /perto da piscina\/área de lazer/);
  assert.match(visit, /\[ANA_VISIT_LOT_PREFERENCE_NOT_TOPIC_SWITCH\]/);
  assert.match(visit, /extractVisitLotPreference\(text\) != null\) return false/);
});

test('preferencia de lote durante visita continua no fluxo de visita', () => {
  assert.match(visit, /const lotPreferenceContinuation =/);
  assert.match(visit, /assistantAskedLotPreference/);
  assert.match(visit, /input\.flowState\.pendingVisitScheduling === true/);
});

test('quando cliente informa perto da piscina Ana anota preferencia e continua pedindo dia ou horario', () => {
  assert.match(visit, /visit_lot_preference_captured/);
  assert.match(visit, /Anotei sua preferência por/);
  assert.match(visit, /A disponibilidade de lote específico precisa ser confirmada no atendimento/);
  assert.match(visit, /Para qual dia você prefere agendar a visita/);
  assert.match(visit, /Qual horário fica melhor para você/);
});