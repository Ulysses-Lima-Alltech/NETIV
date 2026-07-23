import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const engineSource = readFileSync('services/conversationEngine.ts', 'utf8');
const outboundSource = readFileSync('services/anaOutboundQuotaService.ts', 'utf8');

test('ANA_HANDOFF_DISABLED bloqueia somente criacao de novo Handoff', () => {
  assert.match(engineSource, /const ANA_HANDOFF_DISABLED =\s*String\(process\.env\.ANA_HANDOFF_DISABLED \?\? 'true'\)/);
  assert.match(engineSource, /const explicitBrokerRequest = ANA_HANDOFF_DISABLED \? false : rawExplicitBrokerRequest/);
  assert.match(engineSource, /const shouldAssignBroker =\s*ANA_HANDOFF_DISABLED\s*\?\s*false/);
  assert.doesNotMatch(engineSource, /ANA_HANDOFF_DISABLED_IGNORED/);
});

test('Handoff persistido continua bloqueando a Ana', () => {
  assert.match(engineSource, /isAnaAutomationBlockedByHandoff\(entryConversation\)/);
  assert.match(engineSource, /isAnaAutomationBlockedByHandoff\(effectiveConv\)/);
  assert.match(outboundSource, /isAnaAutomationBlockedByHandoff\(latestConversation\)/);
  assert.match(outboundSource, /error: 'handoff_active'/);
  assert.match(outboundSource, /code: 423/);
});

test('pedido automatico de corretor nao cria Handoff quando criacao esta desabilitada', () => {
  assert.match(engineSource, /const rawExplicitBrokerRequest = hasExplicitHandoffIntent\(trimmed\)/);
  assert.match(engineSource, /const handoffDisabledBrokerIntent =[\s\S]*rawExplicitBrokerRequest \|\| pendingResolutionChoiceIntent === 'broker'/);
  assert.match(engineSource, /\[ANA_HANDOFF_MUTATION_BLOCKED\]/);
  assert.match(engineSource, /reason: 'handoff_disabled'/);
  assert.match(engineSource, /\? 'handoff_disabled'/);
});

test('mutacoes de novo handoff e assignConversationToNextBroker ficam guardadas', () => {
  const repairIndex = engineSource.indexOf('SET handoff = true');
  const repairGuardIndex = engineSource.lastIndexOf('if (shouldRepairHandoffMode)', repairIndex);
  assert.ok(repairGuardIndex >= 0 && repairGuardIndex < repairIndex);
  assert.match(engineSource, /const shouldRepairHandoffMode =\s*!ANA_HANDOFF_DISABLED/);

  for (const match of engineSource.matchAll(/assignConversationToNextBroker\(\{/g)) {
    const before = engineSource.slice(Math.max(0, match.index - 2000), match.index);
    assert.match(before, /ANA_HANDOFF_DISABLED|!ANA_HANDOFF_DISABLED|shouldAssignBroker/);
  }
});
