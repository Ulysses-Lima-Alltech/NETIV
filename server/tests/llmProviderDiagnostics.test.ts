import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyLlmProviderError } from '../utils/llmProviderDiagnostics.js';

test('classifica quota/billing em 429', () => {
  const result = classifyLlmProviderError({
    provider: 'openai',
    httpStatus: 429,
    providerErrorCode: 'insufficient_quota',
    message: 'You exceeded your current quota, please check your plan and billing details.',
  });

  assert.equal(result.classifiedError, 'OPENAI_INSUFFICIENT_QUOTA_OR_BILLING');
});

test('classifica auth em 401/403', () => {
  const result = classifyLlmProviderError({
    provider: 'openai',
    httpStatus: 401,
    message: 'Incorrect API key provided',
  });

  assert.equal(result.classifiedError, 'OPENAI_AUTH_ERROR');
});

test('classifica rate limit sem billing em 429', () => {
  const result = classifyLlmProviderError({
    provider: 'openai',
    httpStatus: 429,
    message: 'Rate limit reached for requests per min',
  });

  assert.equal(result.classifiedError, 'OPENAI_RATE_LIMIT');
});

test('classifica timeout e rede', () => {
  const result = classifyLlmProviderError({
    provider: 'openai',
    message: 'fetch failed: ETIMEDOUT while contacting provider',
  });

  assert.equal(result.classifiedError, 'OPENAI_TIMEOUT_OR_NETWORK');
});

test('sanitiza segredos da mensagem', () => {
  const result = classifyLlmProviderError({
    provider: 'openai',
    httpStatus: 401,
    message: 'Authorization: Bearer sk-secret-example-key incorrect API key provided',
  });

  assert.equal(result.classifiedError, 'OPENAI_AUTH_ERROR');
  assert.doesNotMatch(result.sanitizedMessage, /sk-secret-example-key/i);
  assert.doesNotMatch(result.sanitizedMessage, /Bearer sk-/i);
});
