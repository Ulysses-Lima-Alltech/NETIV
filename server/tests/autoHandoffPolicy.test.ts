import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { isAutoHandoffEnabled } from '../utils/autoHandoffPolicy.js';

const ORIGINAL_AUTO_HANDOFF = process.env.AUTO_HANDOFF_ENABLED;

test('isAutoHandoffEnabled padrão é false e só ativa com valores truthy', () => {
  delete process.env.AUTO_HANDOFF_ENABLED;
  assert.equal(isAutoHandoffEnabled(), false);

  process.env.AUTO_HANDOFF_ENABLED = 'true';
  assert.equal(isAutoHandoffEnabled(), true);

  process.env.AUTO_HANDOFF_ENABLED = '1';
  assert.equal(isAutoHandoffEnabled(), true);

  process.env.AUTO_HANDOFF_ENABLED = 'false';
  assert.equal(isAutoHandoffEnabled(), false);

  if (ORIGINAL_AUTO_HANDOFF == null) delete process.env.AUTO_HANDOFF_ENABLED;
  else process.env.AUTO_HANDOFF_ENABLED = ORIGINAL_AUTO_HANDOFF;
});

test('fluxos automáticos da Ana não promovem Handoff automaticamente', () => {
  const repoSource = readFileSync(new URL('../repositories/conversationRepository.js', import.meta.url), 'utf8');
  assert.match(repoSource, /const autoHandoffEnabled = isAutoHandoffEnabled\(\)/);
  assert.match(repoSource, /const handoff = autoHandoffEnabled \? !!meta\.handoff : false/);
  assert.match(repoSource, /if \(!autoHandoffEnabled && classification === 'Handoff'\)/);
  assert.match(repoSource, /logAutoHandoffBlocked\(/);

  const engineSource = readFileSync(new URL('../services/conversationEngine.js', import.meta.url), 'utf8');
  assert.match(engineSource, /if \(hasExplicitHandoffIntent\(trimmed\)\)/);
  assert.match(engineSource, /auto_handoff_blocked_by_temporary_policy/);
  assert.doesNotMatch(engineSource, /phase: 'handoff_intent_confirm'/);
});

test('handoff manual continua possível via updateClassification', () => {
  const repoSource = readFileSync(new URL('../repositories/conversationRepository.js', import.meta.url), 'utf8');
  assert.match(repoSource, /export async function updateClassification/);
  assert.match(repoSource, /if \(handoff\) \{/);
  assert.match(repoSource, /classification = 'Handoff';/);
});
