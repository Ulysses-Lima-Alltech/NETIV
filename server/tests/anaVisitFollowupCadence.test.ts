import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeAnaVisitFollowupNextRunAt,
  getAnaVisitFollowupOffsetFromAnchorMs,
  getAnaVisitFollowupMessage,
  shouldStartAnaVisitFollowup,
} from '../utils/anaVisitFollowupCadence.js';

test('regua de visita usa a cadencia oficial com teto de 20 tentativas', () => {
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(1), 5 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(2), 6 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(5), 9 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(6), 69 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(10), 73 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(11), 313 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(15), 317 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(16), 617 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(20), 621 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(0), null);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(21), null);

  assert.match(getAnaVisitFollowupMessage(1, 'amanha as 14h') ?? '', /amanha as 14h/);
  assert.match(getAnaVisitFollowupMessage(10, 'amanha as 14h') ?? '', /amanha as 14h/);
  assert.match(getAnaVisitFollowupMessage(20, 'amanha as 14h') ?? '', /amanha as 14h/);
  assert.equal(getAnaVisitFollowupMessage(21, 'amanha as 14h'), null);
});

test('calculo de next_run_at usa anchor e notBefore para evitar rajada apos atraso', () => {
  const anchor = new Date('2026-06-10T12:00:00.000Z');
  assert.equal(
    computeAnaVisitFollowupNextRunAt({ anchor, nextAttemptIndex: 1 })?.toISOString(),
    '2026-06-10T12:05:00.000Z'
  );
  assert.equal(
    computeAnaVisitFollowupNextRunAt({ anchor, nextAttemptIndex: 20 })?.toISOString(),
    '2026-06-10T22:21:00.000Z'
  );
  assert.equal(computeAnaVisitFollowupNextRunAt({ anchor, nextAttemptIndex: 21 }), null);
  assert.equal(
    computeAnaVisitFollowupNextRunAt({
      anchor,
      nextAttemptIndex: 2,
      notBefore: new Date('2026-06-10T12:10:00.000Z'),
    })?.toISOString(),
    '2026-06-10T12:10:00.000Z'
  );
});

test('follow-up de visita inicia quando Ana aguarda resposta sobre horario sugerido', () => {
  assert.equal(
    shouldStartAnaVisitFollowup({
      flowState: {
        pendingVisitScheduling: true,
        suggestedVisitStatus: 'awaiting_confirmation',
        suggestedVisitSlotLabel: 'amanha as 14h',
      },
      replyText: 'Tenho uma sugestao para voce: amanha as 14h. Funciona?',
    }),
    true
  );

  assert.equal(
    shouldStartAnaVisitFollowup({
      flowState: {
        pendingVisitScheduling: true,
        suggestedVisitStatus: 'awaiting_confirmation',
        suggestedVisitSlotLabel: 'amanha as 14h',
      },
      replyText: 'Perfeito! Que tal amanha as 14h? Posso deixar sua visita encaminhada nesse horario?',
    }),
    true
  );

  assert.equal(
    shouldStartAnaVisitFollowup({
      flowState: {
        pendingVisitScheduling: true,
        pendingVisitMissingSlot: 'nome',
      },
      replyText: 'Como posso te chamar para confirmar o agendamento?',
    }),
    false
  );

  assert.equal(
    shouldStartAnaVisitFollowup({
      flowState: {
        pendingVisitScheduling: false,
        visitScheduling: {
          active: false,
          offered: true,
          accepted: true,
          requestedDateText: 'amanha',
          requestedTimeText: '14h',
          normalizedDate: '2026-06-11',
          normalizedTime: '14:00',
          nameCollected: true,
          customerName: 'Cliente',
          status: 'scheduled',
        },
      },
      replyText: 'Perfeito, sua visita ficou agendada.',
    }),
    false
  );
});
