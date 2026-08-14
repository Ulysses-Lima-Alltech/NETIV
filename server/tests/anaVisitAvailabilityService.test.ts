import assert from 'node:assert/strict';
import test from 'node:test';
import {
  findNextAvailableVisitSlot,
  validateVisitSlotStillAvailable,
  type AnaVisitSlotAvailabilityChecker,
} from '../services/anaVisitAvailabilityService.js';

function hmInSaoPaulo(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  return `${parts.find((part) => part.type === 'hour')?.value}:${parts.find((part) => part.type === 'minute')?.value}`;
}

function ymdInSaoPaulo(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function checkerFor(availableSlots: Record<string, number | null>): AnaVisitSlotAvailabilityChecker {
  return async ({ startAt }) => {
    const key = `${ymdInSaoPaulo(startAt)} ${hmInSaoPaulo(startAt)}`;
    const brokerId = availableSlots[key] ?? null;
    return {
      available: brokerId != null,
      brokerId,
      eligibleBrokerCount: brokerId != null ? 1 : 0,
    };
  };
}

test('findNextAvailableVisitSlot em dia util comeca no dia seguinte', async () => {
  const slot = await findNextAvailableVisitSlot({
    enterpriseId: 10,
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    checkSlotAvailability: checkerFor({
      '2026-06-10 14:00': 7,
    }),
  });

  assert.equal(slot?.startYmd, '2026-06-10');
  assert.equal(slot?.timeHm, '14:00');
  assert.equal(slot?.label, 'amanhã às 14h');
  assert.equal(slot?.brokerId, 7);
});

test('findNextAvailableVisitSlot pula dia util seguinte sem disponibilidade', async () => {
  const slot = await findNextAvailableVisitSlot({
    enterpriseId: 10,
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    checkSlotAvailability: checkerFor({
      '2026-06-11 10:00': 8,
    }),
  });

  assert.equal(slot?.startYmd, '2026-06-11');
  assert.equal(slot?.timeHm, '10:00');
  assert.equal(slot?.label, 'quinta às 10h');
});

test('fim de semana tenta horario futuro no mesmo dia primeiro', async () => {
  const slot = await findNextAvailableVisitSlot({
    enterpriseId: 10,
    referenceNow: new Date('2026-06-13T11:00:00-03:00'),
    checkSlotAvailability: checkerFor({
      '2026-06-13 15:00': 9,
    }),
  });

  assert.equal(slot?.startYmd, '2026-06-13');
  assert.equal(slot?.timeHm, '15:00');
  assert.equal(slot?.label, 'hoje às 15h');
});

test('sabado sem disponibilidade no domingo cai na segunda', async () => {
  const slot = await findNextAvailableVisitSlot({
    enterpriseId: 10,
    referenceNow: new Date('2026-06-13T11:00:00-03:00'),
    checkSlotAvailability: checkerFor({
      '2026-06-15 10:00': 11,
    }),
  });

  assert.equal(slot?.startYmd, '2026-06-15');
  assert.equal(slot?.timeHm, '10:00');
  assert.equal(slot?.label, 'segunda às 10h');
});

test('slot passado nao e ofertado', async () => {
  const slot = await findNextAvailableVisitSlot({
    enterpriseId: 10,
    referenceNow: new Date('2026-06-13T16:00:00-03:00'),
    checkSlotAvailability: checkerFor({
      '2026-06-13 15:00': 7,
      '2026-06-13 17:00': 7,
    }),
  });

  assert.equal(slot?.startYmd, '2026-06-13');
  assert.equal(slot?.timeHm, '17:00');
});

test('disponibilidade exige corretor elegivel', async () => {
  const slot = await findNextAvailableVisitSlot({
    enterpriseId: 10,
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    checkSlotAvailability: checkerFor({
      '2026-06-10 09:00': null,
      '2026-06-10 10:00': 12,
    }),
  });

  assert.equal(slot?.timeHm, '10:00');
  assert.equal(slot?.brokerId, 12);
});

test('validateVisitSlotStillAvailable aceita outro corretor no mesmo horario', async () => {
  const result = await validateVisitSlotStillAvailable({
    enterpriseId: 10,
    startAt: new Date('2026-06-10T14:00:00-03:00'),
    endAt: new Date('2026-06-10T15:00:00-03:00'),
    preferredBrokerId: 1,
    checkSlotAvailability: async () => ({
      available: true,
      brokerId: 2,
      eligibleBrokerCount: 1,
    }),
  });

  assert.equal(result.available, true);
  assert.equal(result.brokerId, 2);
});

test('domingo so e ofertado quando ha corretor disponivel', async () => {
  const sunday = await findNextAvailableVisitSlot({
    enterpriseId: 10,
    referenceNow: new Date('2026-06-14T10:00:00-03:00'),
    checkSlotAvailability: checkerFor({
      '2026-06-14 12:00': 22,
    }),
  });
  const monday = await findNextAvailableVisitSlot({
    enterpriseId: 10,
    referenceNow: new Date('2026-06-14T10:00:00-03:00'),
    checkSlotAvailability: checkerFor({
      '2026-06-15 09:00': 23,
    }),
  });

  assert.equal(sunday?.startYmd, '2026-06-14');
  assert.equal(sunday?.timeHm, '12:00');
  assert.equal(sunday?.brokerId, 22);
  assert.equal(monday?.startYmd, '2026-06-15');
  assert.equal(monday?.brokerId, 23);
});

test('slot recusado pode ser excluido da proxima busca', async () => {
  const slot = await findNextAvailableVisitSlot({
    enterpriseId: 10,
    referenceNow: new Date('2026-06-09T13:00:00-03:00'),
    excludeStartAt: new Date('2026-06-10T14:00:00-03:00'),
    checkSlotAvailability: checkerFor({
      '2026-06-10 14:00': 7,
      '2026-06-10 15:00': 8,
    }),
  });

  assert.equal(slot?.startYmd, '2026-06-10');
  assert.equal(slot?.timeHm, '15:00');
  assert.equal(slot?.brokerId, 8);
});

test('validateVisitSlotStillAvailable encaminha preferredBrokerId para a checagem', async () => {
  const preferredBrokerIds: Array<number | null | undefined> = [];
  const result = await validateVisitSlotStillAvailable({
    enterpriseId: 10,
    startAt: new Date('2026-06-10T14:00:00-03:00'),
    endAt: new Date('2026-06-10T15:00:00-03:00'),
    preferredBrokerId: 7,
    checkSlotAvailability: async (params) => {
      preferredBrokerIds.push(params.preferredBrokerId);
      return {
        available: true,
        brokerId: 7,
        eligibleBrokerCount: 1,
      };
    },
  });

  assert.equal(result.available, true);
  assert.equal(result.brokerId, 7);
  assert.deepEqual(preferredBrokerIds, [7]);
});

test('domingo nao oferece horario apos 14h mesmo com corretor disponivel', async () => {
  const slot = await findNextAvailableVisitSlot({
    enterpriseId: 10,
    referenceNow: new Date('2026-06-13T11:00:00-03:00'),
    checkSlotAvailability: checkerFor({
      '2026-06-14 15:00': 30,
      '2026-06-15 10:00': 31,
    }),
  });

  assert.equal(slot?.startYmd, '2026-06-15');
  assert.equal(slot?.timeHm, '10:00');
  assert.equal(slot?.brokerId, 31);
});

test('sabado continua atendendo ate 18h', async () => {
  const slot = await findNextAvailableVisitSlot({
    enterpriseId: 10,
    referenceNow: new Date('2026-06-12T11:00:00-03:00'),
    checkSlotAvailability: checkerFor({
      '2026-06-13 17:00': 32,
    }),
  });

  assert.equal(slot?.startYmd, '2026-06-13');
  assert.equal(slot?.timeHm, '17:00');
  assert.equal(slot?.brokerId, 32);
});
