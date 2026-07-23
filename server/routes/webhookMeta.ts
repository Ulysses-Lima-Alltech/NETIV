import { Router, type Request, type Response } from 'express';
import { createHmac, timingSafeEqual } from 'crypto';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { config } from '../config.js';
import { processIncomingWebhook } from '../services/webhookProcessor.js';
import type { WebhookPayload } from '../types/webhook.js';

async function getVerifyToken(): Promise<string> {
  try {
    const dbCfg = await getWhatsAppConfig();
    if (dbCfg?.webhookVerifyToken?.trim()) return dbCfg.webhookVerifyToken;
  } catch { /* DB unavailable */ }
  return config.meta.verifyToken;
}

type MetaWebhookRouterDependencies = {
  getVerifyToken: () => Promise<string>;
  getAppSecret: () => string;
  isUnsignedTemporarilyAllowed: () => boolean;
  getEnvironment: () => string;
  now: () => Date;
  processIncomingWebhook: (payload: WebhookPayload) => Promise<void>;
  schedule: (callback: () => void) => void;
  log: (...values: unknown[]) => void;
  warn: (...values: unknown[]) => void;
  error: (...values: unknown[]) => void;
};

const defaultDependencies: MetaWebhookRouterDependencies = {
  getVerifyToken,
  getAppSecret: () => config.meta.appSecret,
  isUnsignedTemporarilyAllowed: () => config.meta.allowUnsignedWebhook,
  getEnvironment: () => config.nodeEnv,
  now: () => new Date(),
  processIncomingWebhook,
  schedule: (callback) => { setImmediate(callback); },
  log: (...values) => { console.log(...values); },
  warn: (...values) => { console.warn(...values); },
  error: (...values) => { console.error(...values); },
};

export function hasValidMetaWebhookSignature(
  appSecret: string,
  signature: string,
  rawBody: Buffer | undefined,
): boolean {
  if (!appSecret || !signature || !rawBody) return false;
  const expected = `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
  return Buffer.byteLength(signature) === Buffer.byteLength(expected)
    && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export function createMetaWebhookRouter(
  overrides: Partial<MetaWebhookRouterDependencies> = {},
): Router {
  const dependencies = { ...defaultDependencies, ...overrides };
  const router = Router();
  router.get('/', async (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];
    const expected = await dependencies.getVerifyToken();
    if (mode === 'subscribe' && expected && token === expected && challenge != null && String(challenge).length > 0) {
      res.status(200).type('text/plain').send(String(challenge));
      return;
    }
    res.status(403).end();
  });
  router.post('/', (req: Request, res: Response) => {
    const appSecret = dependencies.getAppSecret().trim();
    const signature = String(req.header('x-hub-signature-256') ?? '');
    if (appSecret) {
      if (!hasValidMetaWebhookSignature(appSecret, signature, req.rawBody)) {
        res.status(401).send('Invalid signature');
        return;
      }
    } else if (!dependencies.isUnsignedTemporarilyAllowed()) {
      res.status(503).send('Webhook signature not configured');
      return;
    } else {
      dependencies.warn('[META_WEBHOOK_UNSIGNED_TEMPORARILY_ALLOWED]', JSON.stringify({
        path: req.originalUrl || req.path,
        timestamp: dependencies.now().toISOString(),
        environment: dependencies.getEnvironment(),
        appSecretPresent: false,
        temporaryFlagEnabled: true,
      }));
    }
    res.status(200).send('OK');
    const payload = req.body as WebhookPayload;
    if (!payload || typeof payload !== 'object') {
      dependencies.log('[ANA_PIPELINE] webhook_body_invalid');
      return;
    }
    dependencies.log('[ANA_PIPELINE] webhook_post_accepted_enqueue');
    dependencies.schedule(() => {
      dependencies.processIncomingWebhook(payload).catch((e) => {
        dependencies.error('[ANA_PIPELINE] processIncomingWebhook', e instanceof Error ? e.message : String(e));
        if (e instanceof Error && e.stack) dependencies.error(e.stack);
      });
    });
  });
  return router;
}

export default createMetaWebhookRouter();
