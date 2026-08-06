import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import test from 'node:test';
import express from 'express';
import { createMetaWebhookRouter } from '../routes/webhookMeta.js';
import {
  getMetaWebhookSignatureBypassDecision,
  isMetaWebhookSignatureBypassActive,
} from '../services/metaWebhookSignatureBypass.js';
import type { WebhookPayload } from '../types/webhook.js';

const NOW = new Date('2030-01-10T12:00:00.000Z');
const SECRET = 'correct-meta-app-secret';
const BODY = JSON.stringify({
  object: 'whatsapp_business_account',
  entry: [{ id: 'entry-1', changes: [] }],
  privateMessageBody: 'must-not-appear-in-bypass-log',
  phone: '5511999999999',
});

type LogEntry = unknown[];

interface WebhookFixture {
  baseUrl: string;
  processed: WebhookPayload[];
  logs: LogEntry[];
  close: () => Promise<void>;
}

async function createWebhookFixture(params: {
  appSecret?: string;
  env?: NodeJS.ProcessEnv;
  verifyToken?: string;
} = {}): Promise<WebhookFixture> {
  const processed: WebhookPayload[] = [];
  const logs: LogEntry[] = [];
  const logger = {
    info: (...args: unknown[]) => logs.push(args),
    warn: (...args: unknown[]) => logs.push(args),
    error: (...args: unknown[]) => logs.push(args),
  };
  const app = express();
  app.use(express.json({
    verify(req, _res, buffer) {
      (req as express.Request).rawBody = Buffer.from(buffer);
    },
  }));
  app.use('/webhook', createMetaWebhookRouter({
    getAppSecret: () => params.appSecret ?? SECRET,
    getVerifyToken: async () => params.verifyToken ?? 'verify-token',
    processIncomingWebhook: async (payload) => { processed.push(payload); },
    env: params.env ?? {},
    now: () => NOW,
    logger,
  }));
  const server: Server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    processed,
    logs,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function signature(body = BODY, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

async function post(fixture: WebhookFixture, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(`${fixture.baseUrl}/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: BODY,
  });
}

async function afterEnqueue(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test('assinatura Meta válida é aceita e o payload segue para processamento', async () => {
  const fixture = await createWebhookFixture();
  try {
    const response = await post(fixture, { 'x-hub-signature-256': signature() });
    assert.equal(response.status, 200);
    await afterEnqueue();
    assert.equal(fixture.processed.length, 1);
  } finally {
    await fixture.close();
  }
});

test('sem contingência, assinatura inválida e header ausente são rejeitados', async () => {
  const fixture = await createWebhookFixture();
  try {
    assert.equal((await post(fixture, { 'x-hub-signature-256': 'sha256=invalid' })).status, 401);
    assert.equal((await post(fixture)).status, 401);
    assert.equal(fixture.processed.length, 0);
  } finally {
    await fixture.close();
  }
});

test('sem App Secret e sem contingência, webhook público retorna status seguro', async () => {
  const fixture = await createWebhookFixture({ appSecret: '' });
  try {
    assert.equal((await post(fixture)).status, 503);
    assert.equal(fixture.processed.length, 0);
  } finally {
    await fixture.close();
  }
});

test('contingência ativa aceita header ausente ou inválido, processa payload e mantém assinatura válida normal', async () => {
  const fixture = await createWebhookFixture({
    env: {
      META_WEBHOOK_ALLOW_UNSIGNED: 'true',
      META_WEBHOOK_ALLOW_UNSIGNED_UNTIL: '2030-01-10T12:01:00.000Z',
      APP_ENVIRONMENT: 'controlled-test',
    },
  });
  try {
    assert.equal((await post(fixture)).status, 200);
    assert.equal((await post(fixture, { 'x-hub-signature-256': 'sha256=invalid' })).status, 200);
    assert.equal((await post(fixture, { 'x-hub-signature-256': signature() })).status, 200);
    await afterEnqueue();
    assert.equal(fixture.processed.length, 3);
    assert.equal(fixture.logs.filter((entry) => entry[0] === '[META_WEBHOOK_SIGNATURE_BYPASS_USED]').length, 2);

    const logs = JSON.stringify(fixture.logs);
    assert.match(logs, /META_WEBHOOK_SIGNATURE_BYPASS_ACTIVE/);
    assert.match(logs, /META_WEBHOOK_SIGNATURE_BYPASS_USED/);
    assert.doesNotMatch(logs, new RegExp(SECRET));
    assert.doesNotMatch(logs, /sha256=invalid/);
    assert.doesNotMatch(logs, /must-not-appear-in-bypass-log/);
    assert.doesNotMatch(logs, /5511999999999/);
  } finally {
    await fixture.close();
  }
});

test('contingência ativa não exige App Secret para aceitar o POST público', async () => {
  const fixture = await createWebhookFixture({
    appSecret: '',
    env: {
      META_WEBHOOK_ALLOW_UNSIGNED: 'true',
      META_WEBHOOK_ALLOW_UNSIGNED_UNTIL: '2030-01-10T12:01:00.000Z',
    },
  });
  try {
    assert.equal((await post(fixture)).status, 200);
    await afterEnqueue();
    assert.equal(fixture.processed.length, 1);
  } finally {
    await fixture.close();
  }
});

test('contingência expirada rejeita assinatura inválida e header ausente', async () => {
  const fixture = await createWebhookFixture({
    env: {
      META_WEBHOOK_ALLOW_UNSIGNED: 'true',
      META_WEBHOOK_ALLOW_UNSIGNED_UNTIL: '2030-01-10T12:00:00.000Z',
    },
  });
  try {
    assert.equal((await post(fixture, { 'x-hub-signature-256': 'sha256=invalid' })).status, 401);
    assert.equal((await post(fixture)).status, 401);
    assert.match(JSON.stringify(fixture.logs), /META_WEBHOOK_SIGNATURE_BYPASS_INACTIVE/);
  } finally {
    await fixture.close();
  }
});

test('flag false e data inválida nunca ativam a contingência', () => {
  const falseFlag = { META_WEBHOOK_ALLOW_UNSIGNED: 'false', META_WEBHOOK_ALLOW_UNSIGNED_UNTIL: '2030-01-10T12:01:00.000Z' };
  const invalidDate = { META_WEBHOOK_ALLOW_UNSIGNED: 'true', META_WEBHOOK_ALLOW_UNSIGNED_UNTIL: 'not-a-date' };
  assert.equal(isMetaWebhookSignatureBypassActive({ env: falseFlag, now: NOW }), false);
  assert.equal(isMetaWebhookSignatureBypassActive({ env: invalidDate, now: NOW }), false);
  assert.equal(getMetaWebhookSignatureBypassDecision({ env: invalidDate, now: NOW }).reason, 'allow_unsigned_until_invalid');
});

test('GET de verificação continua exigindo Verify Token correto', async () => {
  const fixture = await createWebhookFixture({
    env: { META_WEBHOOK_ALLOW_UNSIGNED: 'true', META_WEBHOOK_ALLOW_UNSIGNED_UNTIL: '2030-01-10T12:01:00.000Z' },
  });
  try {
    const accepted = await fetch(`${fixture.baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=verify-token&hub.challenge=challenge`);
    const rejected = await fetch(`${fixture.baseUrl}/webhook?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=challenge`);
    assert.equal(accepted.status, 200);
    assert.equal(await accepted.text(), 'challenge');
    assert.equal(rejected.status, 403);
  } finally {
    await fixture.close();
  }
});

test('contingência fica limitada ao router público /webhook, não às rotas administrativas', () => {
  const adminRoutes = readFileSync(new URL('../routes/index.ts', import.meta.url), 'utf8');
  assert.match(adminRoutes, /router\.use\('\/webhook\/whatsapp', requireRole\([^\n]+, webhookRouter\)/);
  assert.doesNotMatch(adminRoutes, /webhookMetaRouter/);
});
