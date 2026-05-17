import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('resolução de enterprise prioriza conversa e contato antes da campanha', () => {
  const source = readFileSync(new URL('../repositories/enterpriseMatch.js', import.meta.url), 'utf8');
  const conversationIdx = source.indexOf('const fromConversation =');
  const contactIdx = source.indexOf('const fromContact =');
  const campaignIdx = source.indexOf('const fromCampaign =');

  assert.ok(conversationIdx >= 0);
  assert.ok(contactIdx >= 0);
  assert.ok(campaignIdx >= 0);
  assert.ok(conversationIdx < contactIdx);
  assert.ok(contactIdx < campaignIdx);
});

test('engine de conversa tenta usar contact.enterprise_id no fallback de enterprise', () => {
  const source = readFileSync(new URL('../services/conversationEngine.js', import.meta.url), 'utf8');
  assert.match(source, /linkedContact\?\.enterprise_id/);
  assert.match(source, /effectiveConv\.enterprise_id\s*\?\?/);
});
