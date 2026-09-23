import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

function readScript(): string {
  return readFileSync(new URL('../scripts/backfillOliva317LeadClassification.ts', import.meta.url), 'utf8');
}

test('backfill oliva317 e dry-run por padrao e limitado ao enterprise 12', () => {
  const source = readScript();

  assert.match(source, /const OLIVA317_ENTERPRISE_ID = 12;/);
  assert.match(source, /mode: 'dry-run'/);
  assert.match(source, /c\.enterprise_id = \$1/);
  assert.match(source, /OLIVA317_ENTERPRISE_ID/);
});

test('backfill oliva317 nao faz UPDATE direto e reutiliza classificador e setters', () => {
  const source = readScript();

  assert.doesNotMatch(source, /UPDATE\s+conversations/i);
  assert.match(source, /classifyLeadConversation/);
  assert.match(source, /setConversationLeadTemperature/);
  assert.match(source, /setConversationFunnelStatusAutomatic/);
  assert.match(source, /saveLeadClassificationAudit/);
});

test('backfill oliva317 nao altera enterprise_id e separa decisao ambigua para revisao', () => {
  const source = readScript();

  assert.doesNotMatch(source, /setConversationEnterpriseId/);
  assert.match(source, /ambiguous_enterprise_decision/);
  assert.match(source, /proposedEnterpriseId: decision\.enterpriseId/);
});

test('backfill oliva317 ignora handoff, carteira, override manual, auditados e ja classificados', () => {
  const source = readScript();

  assert.match(source, /classification === 'Handoff'/);
  assert.match(source, /classification === 'Carteira'/);
  assert.match(source, /manualTemperatureOverride/);
  assert.match(source, /manualEnterpriseOverride/);
  assert.match(source, /last_lead_classification_audit/);
  assert.match(source, /already_classified/);
});
