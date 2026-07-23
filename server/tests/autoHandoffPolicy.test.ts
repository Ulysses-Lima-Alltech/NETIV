import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { isAutoHandoffEnabled } from '../utils/autoHandoffPolicy.js';

const ORIGINAL_AUTO_HANDOFF = process.env.AUTO_HANDOFF_ENABLED;

test('isAutoHandoffEnabled util permanece, mas não controla fluxo automático da Ana', () => {
  delete process.env.AUTO_HANDOFF_ENABLED;
  assert.equal(isAutoHandoffEnabled(), false);
  process.env.AUTO_HANDOFF_ENABLED = 'true';
  assert.equal(isAutoHandoffEnabled(), true);
  if (ORIGINAL_AUTO_HANDOFF == null) delete process.env.AUTO_HANDOFF_ENABLED;
  else process.env.AUTO_HANDOFF_ENABLED = ORIGINAL_AUTO_HANDOFF;
});

test('conversationEngine não dispara handoff automático', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  assert.doesNotMatch(source, /handoff:\s*true/);
  assert.doesNotMatch(source, /classification:\s*'Handoff'/);
  assert.doesNotMatch(source, /handoff:\s*structured\.handoff/);
});

test('applyAnaConversationUpdate nao ativa handoff automatico', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'repositories/conversationRepository.ts'), 'utf8');
  assert.match(source, /const handoff = handoffAlreadyActive/);
  assert.match(source, /ana_automatic_handoff_removed/);
  assert.match(source, /updates automáticos da Ana nunca podem ativar handoff/i);
});

test('applyAnaConversationUpdate preserva handoff manual existente', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'repositories/conversationRepository.ts'), 'utf8');
  assert.match(source, /const handoffAlreadyActive = isAnaAutomationBlockedByHandoff\(conv\)/);
  assert.match(source, /if \(handoff\) \{\s*classification = 'Handoff';/);
});

test('handoff manual permanece via updateClassification', () => {
  const source = readFileSync(path.resolve(process.cwd(), 'repositories/conversationRepository.ts'), 'utf8');
  assert.match(source, /export async function updateClassification/);
  assert.match(source, /if \(handoff\) \{/);
  assert.match(source, /classification = 'Handoff';/);
});
