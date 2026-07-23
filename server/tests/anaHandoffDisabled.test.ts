import { readServerSourceFile } from './helpers/serverSourceResolver.js';
import assert from 'node:assert/strict';
import test from 'node:test';

const source = readServerSourceFile('services/conversationEngine.js');

test('ANA_HANDOFF_DISABLED default true bloqueia somente criacao de novo handoff', () => {
  assert.match(source, /const ANA_AUTO_HANDOFF_CREATION_DISABLED =\s*String\(process\.env\.ANA_HANDOFF_DISABLED \?\? 'true'\)/);
  assert.doesNotMatch(source, /\[ANA_HANDOFF_DISABLED_IGNORED\]/);
  assert.doesNotMatch(source, /handoff:\s*false,\s*classification:/s);
  assert.match(source, /isAnaAutomationBlockedByHandoff\(conversationAtEntry\)/);
  assert.match(source, /isAnaAutomationBlockedByHandoff\(effectiveConv\)/);
});

test('pedido por corretor nao ativa broker assignment quando handoff disabled', () => {
  assert.match(source, /const rawExplicitBrokerRequest = hasExplicitHandoffIntent\(trimmed\)/);
  assert.match(source, /const explicitBrokerRequest = ANA_AUTO_HANDOFF_CREATION_DISABLED \? false : rawExplicitBrokerRequest/);
  assert.match(source, /const handoffDisabledBrokerIntent =[\s\S]*rawExplicitBrokerRequest \|\| pendingResolutionChoiceIntent === 'broker'/);
  assert.match(source, /\[ANA_HANDOFF_MUTATION_BLOCKED\]/);
  assert.match(source, /reason: 'handoff_disabled'/);
  assert.match(source, /const shouldAssignBroker =\s*ANA_AUTO_HANDOFF_CREATION_DISABLED\s*\?\s*false/);
  assert.match(source, /\? 'handoff_disabled'/);
});

test('mutacoes de handoff e assignConversationToNextBroker ficam guardadas', () => {
  const repairIndex = source.indexOf('SET handoff = true');
  const repairGuardIndex = source.lastIndexOf('if (shouldRepairHandoffMode)', repairIndex);
  assert.ok(repairGuardIndex >= 0 && repairGuardIndex < repairIndex);
  assert.match(source, /const shouldRepairHandoffMode =\s*!ANA_AUTO_HANDOFF_CREATION_DISABLED/);

  for (const match of source.matchAll(/assignConversationToNextBroker\(\{/g)) {
    const before = source.slice(Math.max(0, match.index - 2000), match.index);
    assert.match(before, /ANA_AUTO_HANDOFF_CREATION_DISABLED|!ANA_AUTO_HANDOFF_CREATION_DISABLED|shouldAssignBroker/);
  }

});
