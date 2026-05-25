import assert from 'node:assert/strict';
import test from 'node:test';
import {
  computeRetryDelayMs,
  extractRetryAfterMs,
  isRateLimitError,
  isRetryableLlmError,
} from '../utils/llmRetry.js';

test('extractRetryAfterMs lê "Please try again in 12.614s"', () => {
  const ms = extractRetryAfterMs({ message: 'Rate limit reached. Please try again in 12.614s.' });
  assert.ok(ms != null);
  assert.ok(ms! >= 12600 && ms! <= 12630);
});

test('isRetryableLlmError detecta 429/TPM', () => {
  assert.equal(
    isRetryableLlmError({ httpStatus: 429, message: 'Rate limit reached for gpt-4.1 TPM' }),
    true
  );
  assert.equal(isRateLimitError({ message: 'try again in 2s RPM' }), true);
});

test('computeRetryDelayMs aplica backoff rate-limit e cap', () => {
  assert.equal(computeRetryDelayMs({ attemptCount: 0, hasExplicitRetryAfter: false, retryAfterMs: null, error: { httpStatus: 429 } }), 15000);
  assert.equal(computeRetryDelayMs({ attemptCount: 1, hasExplicitRetryAfter: false, retryAfterMs: null, error: { httpStatus: 429 } }), 30000);
  assert.equal(computeRetryDelayMs({ attemptCount: 2, hasExplicitRetryAfter: false, retryAfterMs: null, error: { httpStatus: 429 } }), 60000);
  assert.equal(computeRetryDelayMs({ attemptCount: 3, hasExplicitRetryAfter: false, retryAfterMs: null, error: { httpStatus: 429 } }), 120000);
  assert.equal(computeRetryDelayMs({ attemptCount: 7, hasExplicitRetryAfter: false, retryAfterMs: null, error: { httpStatus: 429 } }), 300000);
});
