import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../services/conversationEngine.js', import.meta.url), 'utf8');

test('ANA_HANDOFF_DISABLED default true e ignora estado legado Handoff', () => {
  assert.match(source, /const ANA_HANDOFF_DISABLED =\s*String\(process\.env\.ANA_HANDOFF_DISABLED \?\? 'true'\)/);
  assert.match(source, /\[ANA_HANDOFF_DISABLED_IGNORED\]/);
  assert.match(
    source,
    /if \(ANA_HANDOFF_DISABLED && \(effectiveConv\.handoff === true \|\| effectiveConv\.classification === 'Handoff'\)\)/
  );
  assert.match(source, /handoff: false/);
  assert.match(source, /classification: effectiveConv\.classification === 'Handoff' \? 'Novo' : effectiveConv\.classification/);
  assert.match(source, /if \(!ANA_HANDOFF_DISABLED && \(effectiveConv\.handoff === true \|\| effectiveConv\.classification === 'Handoff'\)\)/);
});

test('pedido por corretor nao ativa broker assignment quando handoff disabled', () => {
  assert.match(source, /const rawExplicitBrokerRequest = hasExplicitHandoffIntent\(trimmed\)/);
  assert.match(source, /const explicitBrokerRequest = ANA_HANDOFF_DISABLED \? false : rawExplicitBrokerRequest/);
  assert.match(source, /const handoffDisabledBrokerIntent =[\s\S]*rawExplicitBrokerRequest \|\| pendingResolutionChoiceIntent === 'broker'/);
  assert.match(source, /\[ANA_HANDOFF_MUTATION_BLOCKED\]/);
  assert.match(source, /reason: 'handoff_disabled'/);
  assert.match(source, /const shouldAssignBroker =\s*ANA_HANDOFF_DISABLED\s*\?\s*false/);
  assert.match(source, /\? 'handoff_disabled'/);
});

test('mutacoes de handoff e assignConversationToNextBroker ficam guardadas', () => {
  const repairIndex = source.indexOf('SET handoff = true');
  const repairGuardIndex = source.lastIndexOf('if (shouldRepairHandoffMode)', repairIndex);
  assert.ok(repairGuardIndex >= 0 && repairGuardIndex < repairIndex);
  assert.match(source, /const shouldRepairHandoffMode =\s*!ANA_HANDOFF_DISABLED/);

  for (const match of source.matchAll(/assignConversationToNextBroker\(\{/g)) {
    const before = source.slice(Math.max(0, match.index - 2000), match.index);
    assert.match(before, /ANA_HANDOFF_DISABLED|!ANA_HANDOFF_DISABLED|shouldAssignBroker/);
  }

  assert.doesNotMatch(source, /if \(isAnaEmergencyHandoffEnabled\(\)\)/);
  assert.match(source, /if \(!ANA_HANDOFF_DISABLED && isAnaEmergencyHandoffEnabled\(\)\)/);
});
