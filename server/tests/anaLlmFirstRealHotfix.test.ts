import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';

test('conversationEngine nao usa lead_qualification_policy como resposta final no Evora LLM-first', () => {
  const source = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

  assert.match(source, /!\(ANA_LLM_FIRST_COMMERCIAL_REPLIES && isEvoraEnterpriseName\(ent\?\.name \?\? null\)\)/);
  assert.match(source, /leadQualificationSignalsChangedThisTurn/);
});

test('conversationEngine usa prompt compacto com RAG para Evora LLM-first', () => {
  const source = fs.readFileSync(new URL('../services/conversationEngine.ts', import.meta.url), 'utf8');

  assert.match(source, /evoraLlmFirstCompactMode/);
  assert.match(source, /compactConversationalKnowledge/);
  assert.match(source, /promptKnowledgeText\.slice\(0, 3_500\)/);
  assert.match(source, /BASE AUTORIZADA DO EMPREENDIMENTO/);
});
