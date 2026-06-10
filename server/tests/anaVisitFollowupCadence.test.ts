import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ANA_VISIT_FOLLOWUP_MAX_ATTEMPT,
  computeAnaVisitFollowupNextRunAt,
  getAnaVisitFollowupOffsetFromAnchorMs,
  getAnaVisitFollowupMessage,
  shouldStartAnaVisitFollowup,
} from '../utils/anaVisitFollowupCadence.js';

test('regua de visita tem 10 tentativas ancoradas na pergunta de dia e horario', () => {
  assert.equal(ANA_VISIT_FOLLOWUP_MAX_ATTEMPT, 10);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(1), 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(2), 120_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(3), 180_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(4), 240_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(5), 300_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(6), 65 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(7), 125 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(8), 185 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(9), 245 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(10), 305 * 60_000);
  assert.equal(getAnaVisitFollowupOffsetFromAnchorMs(11), null);

  assert.match(getAnaVisitFollowupMessage(1) ?? '', /qual dia e hor[aá]rio/i);
  assert.match(getAnaVisitFollowupMessage(10) ?? '', /Vou deixar por aqui/i);
});

test('calculo de next_run_at usa anchor e notBefore para evitar rajada apos atraso', () => {
  const anchor = new Date('2026-06-10T12:00:00.000Z');
  assert.equal(
    computeAnaVisitFollowupNextRunAt({ anchor, nextAttemptIndex: 1 })?.toISOString(),
    '2026-06-10T12:01:00.000Z'
  );
  assert.equal(
    computeAnaVisitFollowupNextRunAt({ anchor, nextAttemptIndex: 10 })?.toISOString(),
    '2026-06-10T17:05:00.000Z'
  );
  assert.equal(
    computeAnaVisitFollowupNextRunAt({
      anchor,
      nextAttemptIndex: 2,
      notBefore: new Date('2026-06-10T12:10:00.000Z'),
    })?.toISOString(),
    '2026-06-10T12:10:00.000Z'
  );
});

test('follow-up de visita inicia apenas quando Ana esta aguardando dia ou horario', () => {
  assert.equal(
    shouldStartAnaVisitFollowup({
      flowState: {
        pendingVisitScheduling: true,
        pendingVisitMissingSlot: 'dia',
      },
      replyText: 'Para qual dia você prefere agendar a visita?',
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
          requestedDateText: 'amanhã',
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
