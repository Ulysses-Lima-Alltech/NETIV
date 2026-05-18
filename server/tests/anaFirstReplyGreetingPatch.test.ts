import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('engine corrige saudacao ausente localmente antes do retry OpenAI', () => {
  const engineSource = readFileSync(new URL('../services/conversationEngine.js', import.meta.url), 'utf8');

  assert.match(engineSource, /\[ANA_FIRST_REPLY_GREETING_PATCHED\]/);
  assert.match(engineSource, /phase:\s*'empty_fallback_pre_retry'/);
  assert.match(engineSource, /finalEmptyFallbackGuard\.reason === 'first_reply_missing_greeting'/);
  assert.match(
    engineSource,
    /finalEmptyFallbackGuard\s*=\s*patchedEmptyGuard;[\s\S]*const shouldRetryEmptyFallbackGuard\s*=/
  );
});

test('bloco de patch de saudacao nao aciona retry OpenAI nem handoff', () => {
  const engineSource = readFileSync(new URL('../services/conversationEngine.js', import.meta.url), 'utf8');
  const marker = "phase: 'empty_fallback_pre_retry'";
  const markerIndex = engineSource.indexOf(marker);
  assert.notEqual(markerIndex, -1, 'bloco de patch pre_retry precisa existir');

  const scope = engineSource.slice(Math.max(0, markerIndex - 1400), markerIndex + 900);
  assert.doesNotMatch(scope, /generateChatCompletion\(/);
  assert.doesNotMatch(scope, /applyAnaConversationUpdate\(/);
  assert.doesNotMatch(scope, /handoff:\s*true/);
});

test('guard de fallback vazio continua existindo para casos realmente invalidos', () => {
  const engineSource = readFileSync(new URL('../services/conversationEngine.js', import.meta.url), 'utf8');
  assert.match(engineSource, /\[ANA_EMPTY_FALLBACK_GUARD\]/);
  assert.match(engineSource, /\[ANA_EMPTY_FALLBACK_BLOCKED\]/);
});

test('guard vazio nao faz segunda chamada OpenAI quando resposta valida ja existe', () => {
  const engineSource = readFileSync(new URL('../services/conversationEngine.js', import.meta.url), 'utf8');
  assert.match(engineSource, /\[ANA_EMPTY_FALLBACK_GUARD_SKIP_RETRY_VALID_REPLY\]/);
  assert.doesNotMatch(engineSource, /ana_rag_empty_fallback_retry/);
});

test('rate limit bloqueia sem forcar handoff automatico', () => {
  const engineSource = readFileSync(new URL('../services/conversationEngine.js', import.meta.url), 'utf8');
  assert.match(engineSource, /classifiedError === 'OPENAI_RATE_LIMIT'/);
  assert.match(engineSource, /\[ANA_RATE_LIMIT_ABORT_NO_FALLBACK\]/);
});
