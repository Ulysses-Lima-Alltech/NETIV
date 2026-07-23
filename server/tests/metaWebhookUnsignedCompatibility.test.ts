import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import test from 'node:test';
import express from 'express';
import { isExplicitlyEnabled } from '../config.js';
import { createMetaWebhookRouter } from '../routes/webhookMeta.js';
import type { WebhookPayload } from '../types/webhook.js';
import { readServerSourceFile } from './helpers/serverSourceResolver.js';

const PAYLOAD = {
  object: 'whatsapp_business_account',
  entry: [],
  testMarker: 'payload-must-not-be-logged-5511999999999',
} as unknown as WebhookPayload;

type PostScenario = {
  appSecret?: string;
  allowUnsigned?: boolean;
  signature?: 'valid' | 'invalid' | 'missing';
};

async function postWebhook(scenario: PostScenario) {
  const rawBody = Buffer.from(JSON.stringify(PAYLOAD));
  const appSecret = scenario.appSecret ?? '';
  const warnings: unknown[][] = [];
  const logs: unknown[][] = [];
  let processed = 0;
  let processedPayload: WebhookPayload | null = null;

  const app = express();
  app.use(express.json({
    verify(req, _res, buffer) {
      (req as express.Request).rawBody = Buffer.from(buffer);
    },
  }));
  app.use('/webhook', createMetaWebhookRouter({
    getAppSecret: () => appSecret,
    isUnsignedTemporarilyAllowed: () => scenario.allowUnsigned === true,
    getEnvironment: () => 'test',
    now: () => new Date('2026-07-22T12:00:00.000Z'),
    processIncomingWebhook: async (payload) => {
      processed += 1;
      processedPayload = payload;
    },
    schedule: (callback) => { callback(); },
    log: (...values) => { logs.push(values); },
    warn: (...values) => { warnings.push(values); },
    error: (...values) => { logs.push(values); },
  }));

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (scenario.signature === 'valid') {
    headers['x-hub-signature-256'] = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  } else if (scenario.signature === 'invalid') {
    headers['x-hub-signature-256'] = 'sha256=invalid-signature-value';
  }

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/webhook`, {
      method: 'POST',
      headers,
      body: rawBody,
    });
    return {
      status: response.status,
      body: await response.text(),
      processed,
      processedPayload,
      warnings,
      logs,
    };
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('secret presente e assinatura valida retorna 200 e processa o payload', async () => {
  const result = await postWebhook({ appSecret: 'test-app-secret', signature: 'valid' });
  assert.equal(result.status, 200);
  assert.equal(result.processed, 1);
  assert.deepEqual(result.processedPayload, PAYLOAD);
});

test('secret presente e assinatura invalida retorna 401 sem processar', async () => {
  const result = await postWebhook({ appSecret: 'test-app-secret', signature: 'invalid' });
  assert.equal(result.status, 401);
  assert.equal(result.processed, 0);
});

test('secret presente e assinatura ausente retorna 401 sem processar', async () => {
  const result = await postWebhook({ appSecret: 'test-app-secret', signature: 'missing' });
  assert.equal(result.status, 401);
  assert.equal(result.processed, 0);
});

test('secret ausente e flag false retorna 503 exato sem processar', async () => {
  const result = await postWebhook({ allowUnsigned: false });
  assert.equal(result.status, 503);
  assert.equal(result.body, 'Webhook signature not configured');
  assert.equal(result.processed, 0);
});

test('flag ausente e valores diferentes de true permanecem seguros por padrao', async () => {
  assert.equal(isExplicitlyEnabled(undefined), false);
  assert.equal(isExplicitlyEnabled('false'), false);
  assert.equal(isExplicitlyEnabled('1'), false);
  assert.equal(isExplicitlyEnabled('yes'), false);
  assert.equal(isExplicitlyEnabled(' TRUE '), true);
  const result = await postWebhook({});
  assert.equal(result.status, 503);
  assert.equal(result.processed, 0);
});

test('secret ausente e flag true aceita, processa e emite alerta estruturado', async () => {
  const result = await postWebhook({ allowUnsigned: true });
  assert.equal(result.status, 200);
  assert.equal(result.processed, 1);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0]?.[0], '[META_WEBHOOK_UNSIGNED_TEMPORARILY_ALLOWED]');
  assert.deepEqual(JSON.parse(String(result.warnings[0]?.[1])), {
    path: '/webhook',
    timestamp: '2026-07-22T12:00:00.000Z',
    environment: 'test',
    appSecretPresent: false,
    temporaryFlagEnabled: true,
  });
});

test('secret presente prevalece sobre flag true e assinatura invalida continua 401', async () => {
  const result = await postWebhook({
    appSecret: 'test-app-secret',
    allowUnsigned: true,
    signature: 'invalid',
  });
  assert.equal(result.status, 401);
  assert.equal(result.processed, 0);
  assert.equal(result.warnings.length, 0);
});

test('GET do webhook continua retornando o challenge correto', async () => {
  const app = express();
  app.use('/webhook', createMetaWebhookRouter({ getVerifyToken: async () => 'verify-token-test' }));
  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/webhook?hub.mode=subscribe&hub.verify_token=verify-token-test&hub.challenge=challenge-123`,
    );
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'challenge-123');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('modo temporario entrega inbound ao pipeline que persiste e publica antes do guard de HANDOFF', async () => {
  const result = await postWebhook({ allowUnsigned: true });
  assert.equal(result.status, 200);
  assert.equal(result.processed, 1);

  const processor = readServerSourceFile('services/webhookProcessor.ts');
  const persisted = processor.indexOf("await insertMessage(conv.id, 'user', text, mid)");
  const handoffGuard = processor.indexOf("blockedAt: 'inbound_entry'", persisted);
  assert.ok(persisted >= 0 && handoffGuard > persisted);

  const repository = readServerSourceFile('repositories/messageRepository.ts');
  const insertStart = repository.indexOf('async function insertMessageUnlocked');
  const insertEnd = repository.indexOf('export async function getMessageCreatedAtById');
  const insertion = repository.slice(insertStart, insertEnd);
  assert.match(insertion, /publishMessageCreated\(/);
  assert.match(insertion, /publishConversationUpdated\(/);
});

test('alerta unsigned nao registra segredo, assinatura, token, telefone ou payload', async () => {
  const result = await postWebhook({ allowUnsigned: true });
  const output = JSON.stringify([...result.warnings, ...result.logs]);
  assert.doesNotMatch(output, /payload-must-not-be-logged/);
  assert.doesNotMatch(output, /5511999999999/);
  assert.doesNotMatch(output, /test-app-secret/);
  assert.doesNotMatch(output, /x-hub-signature-256/i);
  assert.doesNotMatch(output, /authorization/i);
});
