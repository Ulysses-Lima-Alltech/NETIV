import assert from 'node:assert/strict';
import test from 'node:test';
import { DispatchEventSchema } from '../validators/dispatchEvents.js';

const validPayload = {
  requestId: '223e4567-e89b-12d3-a456-426614174000',
  name: 'Open house',
  sendMode: 'NOW',
  postSendMode: 'ANA',
  mapping: {
    templateKey: 'open_house',
    selectedEnterpriseId: 12,
    selectedBrokerIds: [],
    customerNameColumn: 'NOME',
    phoneColumn: 'TELEFONE',
    variableMappings: {},
  },
  rows: [{ NOME: 'Ana', TELEFONE: '+5511999999999' }],
};

test('valida contrato do modal e as colunas canonicas da planilha', () => {
  assert.equal(DispatchEventSchema.safeParse(validPayload).success, true);
  assert.equal(DispatchEventSchema.safeParse({
    ...validPayload,
    mapping: { ...validPayload.mapping, phoneColumn: 'Celular' },
  }).success, false);
  assert.equal(DispatchEventSchema.safeParse({
    ...validPayload,
    rows: [{ NOME: '', TELEFONE: '+5511999999999' }],
  }).success, false);
});

test('agendamento exige data, mas validacao temporal e feita apos a consulta de idempotencia', () => {
  assert.equal(DispatchEventSchema.safeParse({
    ...validPayload,
    sendMode: 'SCHEDULED',
  }).success, false);
  assert.equal(DispatchEventSchema.safeParse({
    ...validPayload,
    sendMode: 'SCHEDULED',
    scheduledAt: '2020-01-01T10:00:00.000Z',
  }).success, true);
});
