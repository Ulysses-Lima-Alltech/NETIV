import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  unclassifiedLeadFollowupSendSchema,
  unclassifiedLeadSettingsSchema,
} from '../validators/anaUnclassifiedLeadSettings.js';

test('valida texto opcional ou null dentro do limite', () => {
  assert.equal(unclassifiedLeadSettingsSchema.safeParse({ initialMessage: null }).success, true);
  assert.equal(unclassifiedLeadSettingsSchema.safeParse({ initialMessage: '  ' }).success, true);
  assert.equal(unclassifiedLeadSettingsSchema.safeParse({ initialMessage: 'a'.repeat(2000) }).success, true);
  assert.equal(unclassifiedLeadSettingsSchema.safeParse({ initialMessage: 'a'.repeat(2001) }).success, false);
  assert.equal(unclassifiedLeadSettingsSchema.safeParse({ initialMessage: 123 }).success, false);
  assert.equal(
    unclassifiedLeadSettingsSchema.safeParse({
      initialMessage: null,
      followUpMessage: 'a'.repeat(2000),
    }).success,
    true
  );
  assert.equal(
    unclassifiedLeadSettingsSchema.safeParse({
      initialMessage: null,
      followUpMessage: 'a'.repeat(2001),
    }).success,
    false
  );
});

test('rota da mensagem geral permanece sob o mesmo papel ADMIN das configurações', () => {
  const routes = readFileSync(new URL('../routes/index.ts', import.meta.url), 'utf8');
  assert.match(routes, /router\.use\('\/settings', requireRole\(\.\.\.ROLES_SETTINGS_ADMIN\), settingsUnclassifiedLeadsRouter\)/);
});

test('disparo do Follow-Up exige confirmação do operador e confirmação de consentimento', () => {
  const body = {
    requestId: '986a4e12-539e-49e2-883b-c407d74dd065',
    templateKey: 'marketing_followup',
    previewFingerprint: 'a'.repeat(64),
    confirmed: true,
    consentConfirmed: true,
  };
  assert.equal(unclassifiedLeadFollowupSendSchema.safeParse(body).success, true);
  assert.equal(
    unclassifiedLeadFollowupSendSchema.safeParse({ ...body, consentConfirmed: false }).success,
    false
  );
  assert.equal(
    unclassifiedLeadFollowupSendSchema.safeParse({ ...body, confirmed: false }).success,
    false
  );
});
