import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  __testOnlyShouldUseAnaNoEnterpriseGlobalMode,
} from '../services/conversationEngine.js';
import type { ResolvedEnterpriseAiSettings } from '../services/enterpriseAiSettingsService.js';

const engine = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');

function globalAiSettings(partial: Partial<ResolvedEnterpriseAiSettings> = {}): ResolvedEnterpriseAiSettings {
  return {
    enterpriseId: null,
    provider: 'openai',
    blocked: false,
    reason: null,
    blockedMessage: null,
    apiKeySource: 'global_fallback',
    openaiApiKey: 'sk-global-test',
    openaiApiKeyId: 'key_global',
    openaiProjectId: 'proj_global',
    openaiBaseUrl: 'https://api.openai.com/v1',
    modelHotLead: 'gpt-4.1',
    modelColdLead: 'gpt-4.1-mini',
    temperature: 0.5,
    maxTokens: 700,
    leadScoreThreshold: 0.75,
    aiEnabled: true,
    emergencyBlockEnabled: false,
    costTrackingEnabled: true,
    useGlobalDefaults: true,
    hasOwnApiKey: false,
    ...partial,
  };
}

test('conversation Novo sem enterprise e baixa confianca usa config global, LLM e envio normal', () => {
  const lowConfidenceSettings = globalAiSettings();
  assert.equal(
    __testOnlyShouldUseAnaNoEnterpriseGlobalMode({
      enterpriseIdForAi: null,
      conversationEnterpriseId: null,
      resolvedEnterpriseId: null,
      aiSettings: lowConfidenceSettings,
    }),
    true
  );

  assert.match(engine, /const enterpriseIdForAi =[\s\S]*null;/);
  assert.match(engine, /resolvedAiSettings = await resolveAiSettingsForEnterprise\(enterpriseIdForAi\);/);
  assert.match(engine, /\[ANA_NO_ENTERPRISE_GLOBAL_MODE\]/);
  assert.match(engine, /\[ANA_GLOBAL_NO_ENTERPRISE_MODE\]/);
  assert.match(engine, /shouldUseAnaNoEnterpriseGlobalMode\(\{[\s\S]*enterpriseIdForAi[\s\S]*aiSettings: resolvedAiSettings/);
  assert.match(engine, /globalNoEnterpriseMode \|\|[\s\S]*isKnowledgeGapTurn === true/);
  assert.match(engine, /globalNoEnterpriseMode[\s\S]*'global_no_enterprise_use_llm'/);
  assert.match(engine, /responseFormatJsonForTurn = isKnowledgeGapTurn === true \? false : !conversationalQwenMode/);
  assert.match(engine, /buildGlobalNoEnterpriseOperationalContext\(\{[\s\S]*enterpriseResolution/);
  assert.match(engine, /qual empreendimento, regiao, tipo de planta\/imovel, orcamento/);
  assert.match(engine, /const result = await generateChatCompletion\(\{/);
  assert.match(engine, /const sendResult = await sendAnaOutboundMessages\(\{/);
  assert.match(engine, /const sendResult = await sendTextMessage\(\{/);
  assert.match(engine, /const inserted = await insertMessage\(params\.conversationId, 'assistant'/);
  assert.match(engine, /\[ANA_REPLY_GENERATED\]/);
  assert.match(engine, /\[ANA_REPLY_SEND_ATTEMPT\]/);
  assert.match(engine, /\[ANA_REPLY_SEND_RESULT\]/);
  assert.match(engine, /\[ANA_GLOBAL_NO_ENTERPRISE_REPLY_SENT\]/);
  assert.match(engine, /\[ANA_GLOBAL_NO_ENTERPRISE_REPLY_SEND_FAILED\]/);
});

test('modo global sem enterprise nao bloqueia por material/foto/video antes do LLM', () => {
  assert.match(engine, /if \(!globalNoEnterpriseMode && isVideoMaterialRequest\(trimmed\)\)/);
  assert.match(engine, /if \(!globalNoEnterpriseMode && isImageMaterialRequest\(trimmed\)\)/);
  assert.match(engine, /if \(materialTurnResult\.handled && !globalNoEnterpriseMode\)/);
  assert.match(engine, /\[ANA_NO_ENTERPRISE_MATERIAL_FLOW_CONTINUES_TO_LLM\]/);
  assert.match(engine, /const shouldAttemptDocSend = !globalNoEnterpriseMode && anaDecision\.shouldSendMaterial/);
  assert.match(engine, /if \(userMaterialAsk && !globalNoEnterpriseMode\)/);
});

test('modo global sem enterprise desliga se a config global nao puder chamar IA', () => {
  for (const aiSettings of [
    globalAiSettings({ blocked: true, reason: 'missing_global_api_key', openaiApiKey: null }),
    globalAiSettings({ aiEnabled: false }),
    globalAiSettings({ openaiApiKey: null }),
    globalAiSettings({ useGlobalDefaults: false }),
  ]) {
    assert.equal(
      __testOnlyShouldUseAnaNoEnterpriseGlobalMode({
        enterpriseIdForAi: null,
        conversationEnterpriseId: null,
        resolvedEnterpriseId: null,
        aiSettings,
      }),
      false
    );
  }
});

test('modo global sem enterprise nao reativa esclarecimento deterministico legado', () => {
  assert.match(engine, /if \(false && \(enterpriseResolution\.source === 'ambiguous' \|\| enterpriseResolution\.source === 'unresolved'\)\)/);

  const globalModeIdx = engine.indexOf('const globalNoEnterpriseMode');
  const generationIdx = engine.indexOf('const result = await generateChatCompletion', globalModeIdx);
  assert.ok(globalModeIdx >= 0, 'globalNoEnterpriseMode deve existir');
  assert.ok(generationIdx > globalModeIdx, 'geracao LLM deve continuar depois do modo global');

  const legacyEndIdx = engine.indexOf('const currentFocusedEnterprise', globalModeIdx);
  assert.ok(legacyEndIdx > globalModeIdx, 'bloco legado deve terminar antes do fluxo ativo');

  const activeGlobalPath = engine.slice(legacyEndIdx, generationIdx);
  assert.doesNotMatch(activeGlobalPath, /buildNoEnterpriseResolvedReply\(trimmed\)/);
  assert.doesNotMatch(activeGlobalPath, /buildAmbiguousEnterpriseReply\(enterpriseResolution\.candidates\)/);
  assert.match(engine, /!globalNoEnterpriseMode &&\s+!ANA_LLM_FIRST_COMMERCIAL_REPLIES/);
  assert.match(engine, /if \(!structured && conversationalQwenMode && !isKnowledgeGapTurn && !globalNoEnterpriseMode\)/);
  assert.match(engine, /\[ANA_SILENT_EXIT_BLOCKED\]/);
});
