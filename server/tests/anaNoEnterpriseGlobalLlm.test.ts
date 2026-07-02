import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../services/conversationEngine.js', import.meta.url), 'utf8');

test('WhatsApp ativo sem enterprise tenta LLM global antes do airbag final', () => {
  const guardIndex = source.indexOf("console.log('[ANA_ACTIVE_WHATSAPP_NO_ENTERPRISE_GUARD]'");
  const llmStartIndex = source.indexOf("console.log('[ANA_NO_ENTERPRISE_GLOBAL_LLM_START]'");
  const enterpriseResolutionIndex = source.indexOf('let enterpriseResolution = await resolveEnterpriseForAnaTurn');

  assert.notEqual(guardIndex, -1);
  assert.notEqual(llmStartIndex, -1);
  assert.notEqual(enterpriseResolutionIndex, -1);
  assert.ok(guardIndex < llmStartIndex);
  assert.ok(llmStartIndex < enterpriseResolutionIndex);
  assert.match(source, /if \(activeWhatsAppNoEnterpriseForTurn\) \{/);
  assert.match(source, /const globalAiSettings = await resolveAiSettingsForEnterprise\(null\)/);
  assert.match(source, /const globalResult = await generateChatCompletion\(\{/);
  assert.match(source, /requestType: 'ana_no_enterprise_global_llm'/);
  assert.match(source, /\[ANA_NO_ENTERPRISE_GLOBAL_LLM_REPLY\]/);
});

test('pergunta de portfolio usa contexto seguro e nao associa empreendimento', () => {
  const pathStart = source.indexOf('if (activeWhatsAppNoEnterpriseForTurn) {');
  const pathEnd = source.indexOf('const linkedContact =', pathStart);
  const pathSource = source.slice(pathStart, pathEnd);

  assert.match(pathSource, /Portfolio ativo seguro/);
  assert.match(pathSource, /enterprise\.name/);
  assert.match(pathSource, /enterprise\.tipo/);
  assert.match(pathSource, /enterprise\.city/);
  assert.match(pathSource, /nao fixe interesse sem escolha do cliente/);
  assert.match(pathSource, /Nao assuma empreendimento especifico/);
  assert.match(pathSource, /Se o cliente perguntar quais opcoes voces tem/);
  assert.doesNotMatch(pathSource, /setConversationEnterpriseId/);
  assert.doesNotMatch(pathSource, /classification = 'Handoff'/);
  assert.doesNotMatch(pathSource, /handoff = true/);
});

test('LLM global envia resposta propria e safe discovery fica so como fallback', () => {
  const pathStart = source.indexOf('if (activeWhatsAppNoEnterpriseForTurn) {');
  const pathEnd = source.indexOf('const linkedContact =', pathStart);
  const pathSource = source.slice(pathStart, pathEnd);

  assert.match(pathSource, /assistantReplyAttemptedOrSent = true;[\s\S]*sendAnaOutboundMessages\(\{[\s\S]*phase: 'ana_no_enterprise_global_llm'/);
  assert.match(pathSource, /anaTurnDiagnostics\.finalResponse\.replySource = 'global_no_enterprise_llm'/);
  assert.match(pathSource, /global_no_enterprise_llm_failed/);
  assert.match(pathSource, /global_no_enterprise_llm_empty/);
  assert.doesNotMatch(pathSource, /ANA_GLOBAL_NO_ENTERPRISE_SAFE_DISCOVERY_REPLY/);
});

