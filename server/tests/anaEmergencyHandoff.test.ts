import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  ANA_EMERGENCY_HANDOFF_MESSAGE,
  isAnaEmergencyHandoffEnabled,
  sendAnaEmergencyHandoff,
} from '../utils/anaEmergencyHandoff.js';

test('ANA_EMERGENCY_HANDOFF reconhece apenas valores ativos esperados', () => {
  for (const value of ['true', 'TRUE', '1', 'yes', 'YES', 'on', 'ON', ' on ']) {
    assert.equal(isAnaEmergencyHandoffEnabled(value), true);
  }

  for (const value of [undefined, '', 'false', '0', 'no', 'off', 'disabled', 'trueish']) {
    assert.equal(isAnaEmergencyHandoffEnabled(value), false);
  }
});

test('ANA_EMERGENCY_HANDOFF=true responde handoff padrao sem OpenAI/RAG', async () => {
  const previousEnv = process.env.ANA_EMERGENCY_HANDOFF;
  process.env.ANA_EMERGENCY_HANDOFF = 'true';

  const sendCalls: Array<{ to: string; text: string }> = [];
  const insertCalls: Array<{ conversationId: number; text: string; metaMessageId: string }> = [];
  const result = await sendAnaEmergencyHandoff({
    conversationId: 123,
    toPhoneNumber: '+55 11 99999-9999',
    sendTextMessage: async (to, text) => {
      sendCalls.push({ to, text });
      return { success: true, metaMessageId: 'wamid.emergency-test' };
    },
    insertAssistantMessage: async (conversationId, text, metaMessageId) => {
      insertCalls.push({ conversationId, text, metaMessageId });
    },
  });

  if (previousEnv === undefined) delete process.env.ANA_EMERGENCY_HANDOFF;
  else process.env.ANA_EMERGENCY_HANDOFF = previousEnv;

  assert.equal(result.sent, true);
  assert.deepEqual(sendCalls, [
    {
      to: '+55 11 99999-9999',
      text: ANA_EMERGENCY_HANDOFF_MESSAGE,
    },
  ]);
  assert.deepEqual(insertCalls, [
    {
      conversationId: 123,
      text: ANA_EMERGENCY_HANDOFF_MESSAGE,
      metaMessageId: 'wamid.emergency-test',
    },
  ]);

  const engineSource = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
  const emergencyCheck = engineSource.indexOf('isAnaEmergencyHandoffEnabled()');
  const aiSettingsResolve = engineSource.indexOf('resolveAiSettingsForEnterprise(');
  const ragLoad = engineSource.indexOf('await loadRankedKnowledgeChunksForPromptWithMeta');
  const openAiCompletion = engineSource.indexOf('await generateChatCompletion');

  assert.ok(emergencyCheck >= 0, 'emergency check should exist in conversationEngine');
  assert.ok(aiSettingsResolve >= 0, 'enterprise AI settings resolution should exist in conversationEngine');
  assert.ok(ragLoad >= 0, 'RAG load should exist in conversationEngine');
  assert.ok(openAiCompletion >= 0, 'OpenAI completion call should exist in conversationEngine');
  assert.ok(emergencyCheck < aiSettingsResolve, 'emergency check must happen before enterprise AI settings resolution');
  assert.ok(emergencyCheck < ragLoad, 'emergency check must happen before RAG retrieval');
  assert.ok(emergencyCheck < openAiCompletion, 'emergency check must happen before OpenAI generation');
  assert.match(engineSource, /phase: 'ana_emergency_handoff'/);
});
