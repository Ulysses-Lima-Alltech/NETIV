import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const engineSource = readFileSync(path.resolve(process.cwd(), 'services/conversationEngine.ts'), 'utf8');
const workerSource = readFileSync(path.resolve(process.cwd(), 'services/anaRetryWorkerService.ts'), 'utf8');
const routeSource = readFileSync(path.resolve(process.cwd(), 'routes/whatsapp.ts'), 'utf8');

test('conversationEngine agenda retry persistente para falha retryable', () => {
  assert.match(engineSource, /scheduleAnaRetry\(/);
  assert.match(engineSource, /\[ANA_RETRY\] llm_retryable_error/);
  assert.match(engineSource, /llm_retry_scheduled/);
});

test('worker possui logs e processamento de jobs', () => {
  assert.match(workerSource, /\[ANA_RETRY\] worker_started/);
  assert.match(workerSource, /\[ANA_RETRY\] picked/);
  assert.match(workerSource, /\[ANA_RETRY\] completed/);
  assert.match(workerSource, /\[ANA_RETRY\] rescheduled/);
  assert.match(workerSource, /\[ANA_RETRY\] failed_non_retryable/);
  assert.match(workerSource, /skipped_already_answered/);
});

test('rota manual de retry existe', () => {
  assert.match(routeSource, /post\('\/conversations\/:id\/ana-retry'/i);
});
