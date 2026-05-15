import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { resolveClassificationAndHandoffTransition } from '../repositories/conversationRepository.js';

test('handoff -> ANA manual restaura classification valida e remove Handoff', () => {
  const out = resolveClassificationAndHandoffTransition({
    currentClassification: 'Handoff',
    currentClassificationBeforeHandoff: 'Qualificado',
    requestedClassification: 'Handoff',
    requestedHandoff: false,
  });
  assert.equal(out.handoff, false);
  assert.equal(out.classification, 'Qualificado');
  assert.equal(out.classificationBeforeHandoff, null);
});

test('handoff -> ANA manual sem historico cai para Novo e nunca fica Handoff', () => {
  const out = resolveClassificationAndHandoffTransition({
    currentClassification: 'Handoff',
    currentClassificationBeforeHandoff: null,
    requestedClassification: 'Handoff',
    requestedHandoff: false,
  });
  assert.equal(out.handoff, false);
  assert.equal(out.classification, 'Novo');
  assert.notEqual(out.classification, 'Handoff');
  assert.equal(out.classificationBeforeHandoff, null);
});

test('handoff manual continua funcionando', () => {
  const out = resolveClassificationAndHandoffTransition({
    currentClassification: 'Qualificado',
    currentClassificationBeforeHandoff: null,
    requestedClassification: 'Qualificado',
    requestedHandoff: true,
  });
  assert.equal(out.handoff, true);
  assert.equal(out.classification, 'Handoff');
  assert.equal(out.classificationBeforeHandoff, 'Qualificado');
});

test('updateClassification limpa estados de handoff ao voltar para ANA', () => {
  const source = readFileSync(new URL('../repositories/conversationRepository.js', import.meta.url), 'utf8');
  assert.match(source, /handoff_deferred_until\s*=\s*\$\d+/);
  assert.match(source, /handoff_deferred_broker_id\s*=\s*\$\d+/);
  assert.match(source, /manual_closed_at\s*=\s*\$\d+/);
  assert.match(source, /manual_closed_by_user_id\s*=\s*\$\d+/);
  assert.match(source, /manual_closed_reason\s*=\s*\$\d+/);
  assert.match(source, /const shouldClearHandoffState = u\.handoff === false/);
});
