import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');
const triageService = readFileSync(
  new URL('../services/anaUnclassifiedLeadTriageService.ts', import.meta.url),
  'utf8'
);

test('triagem deterministica intercepta leads ativos sem empreendimento antes da descoberta por LLM', () => {
  const guardIndex = source.indexOf("console.log('[ANA_ACTIVE_WHATSAPP_NO_ENTERPRISE_GUARD]'");
  const triageIndex = source.indexOf('const triageResult = await runUnclassifiedLeadTriage', guardIndex);
  const pendingContinuationIndex = source.indexOf('const pendingContinuationTurn =', triageIndex);
  const globalLlmIndex = source.indexOf("console.log('[ANA_NO_ENTERPRISE_GLOBAL_LLM_START]'");

  assert.notEqual(guardIndex, -1);
  assert.notEqual(triageIndex, -1);
  assert.notEqual(pendingContinuationIndex, -1);
  assert.notEqual(globalLlmIndex, -1);
  assert.ok(guardIndex < triageIndex);
  assert.ok(triageIndex < pendingContinuationIndex);
  assert.match(source.slice(triageIndex, pendingContinuationIndex), /phase: 'ana_unclassified_lead_triage'/);
  assert.match(source.slice(triageIndex, pendingContinuationIndex), /triageResult\.kind === 'replied'[\s\S]*return;/);
  assert.match(source.slice(triageIndex, pendingContinuationIndex), /triageResult\.kind === 'resolved'/);
});

test('triagem respeita a resolução por empreendimento e não transforma cidade em handoff', () => {
  assert.match(triageService, /resolveEnterpriseForAnaTurn/);
  assert.match(triageService, /isTriageCityAnswer/);
  assert.match(triageService, /assignEnterprise/);
  assert.doesNotMatch(triageService, /updateClassification\(/);
  assert.doesNotMatch(triageService, /assignConversationToNextBroker\(/);
  assert.doesNotMatch(triageService, /handoff\s*:\s*true/);
});

test('resposta já tentada não cai em um segundo envio global no finally', () => {
  const triageIndex = source.indexOf('const triageResult = await runUnclassifiedLeadTriage');
  const triageEnd = source.indexOf('const pendingContinuationTurn =', triageIndex);
  const triageSource = source.slice(triageIndex, triageEnd);
  assert.match(triageSource, /assistantReplyAttemptedOrSent = true/);
  assert.match(triageSource, /triageResult\.kind === 'failed'[\s\S]*return;/);
  assert.match(source, /!assistantReplyAttemptedOrSent[\s\S]*sendGlobalNoEnterpriseFinalSafeReply/);
});
