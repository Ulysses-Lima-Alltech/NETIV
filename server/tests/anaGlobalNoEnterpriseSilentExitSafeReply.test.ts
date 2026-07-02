import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../services/conversationEngine.js', import.meta.url), 'utf8');

test('globalNoEnterpriseMode bloqueia saida silenciosa com safe discovery reply', () => {
  assert.match(
    source,
    /const ANA_GLOBAL_NO_ENTERPRISE_SAFE_DISCOVERY_REPLY =\s*['"]Claro, posso te ajudar\. Voc/
  );
  assert.match(source, /let anaGlobalNoEnterpriseModeForTurn = false/);
  assert.match(source, /anaGlobalNoEnterpriseModeForTurn = globalNoEnterpriseMode/);
  assert.match(source, /const sendGlobalNoEnterpriseFinalSafeReply = async \(reason\)/);
  assert.match(source, /phase: 'ana_global_no_enterprise_final_safe_reply'/);
  assert.match(source, /\[ANA_GLOBAL_NO_ENTERPRISE_FINAL_SAFE_REPLY\]/);
  assert.match(
    source,
    /anaGlobalNoEnterpriseModeForTurn[\s\S]*anaTurnAuditOutcome === 'silent'[\s\S]*sendGlobalNoEnterpriseFinalSafeReply\(anaTurnAuditBlockedReason\)/
  );
});

test('safe reply usa envio central sem ativar handoff ou setar empreendimento', () => {
  const helperStart = source.indexOf('const sendGlobalNoEnterpriseFinalSafeReply = async');
  const helperEnd = source.indexOf('const selectTurnDecision', helperStart);
  const helperSource = source.slice(helperStart, helperEnd);

  assert.match(helperSource, /sendAnaOutboundMessages\(\{/);
  assert.match(helperSource, /anaTurnAuditOutcome = 'sent'/);
  assert.match(helperSource, /anaTurnDiagnostics\.finalResponse\.handoffUsed = false/);
  assert.doesNotMatch(helperSource, /setConversationEnterpriseId/);
  assert.doesNotMatch(helperSource, /enterprise_id\s*=/);
  assert.doesNotMatch(helperSource, /classification = 'Handoff'/);
  assert.doesNotMatch(helperSource, /handoff = true/);
  assert.doesNotMatch(helperSource, /Evora/);
});
