import { Router, type Request, type Response } from 'express';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { config } from '../config.js';
import { processIncomingWebhook } from '../services/webhookProcessor.js';
import type { WebhookPayload } from '../types/webhook.js';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  getMetaWebhookSignatureBypassDecision,
  type MetaWebhookSignatureBypassDecision,
} from '../services/metaWebhookSignatureBypass.js';

type WebhookLogger = Pick<Console, 'info' | 'warn' | 'error'>;

export interface MetaWebhookRouterDependencies {
  getVerifyToken?: () => Promise<string>;
  getAppSecret?: () => string;
  processIncomingWebhook?: (payload: WebhookPayload) => Promise<void>;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  logger?: WebhookLogger;
}

async function getVerifyToken(): Promise<string> {
  try {
    const dbCfg = await getWhatsAppConfig();
    if (dbCfg?.webhookVerifyToken?.trim()) return dbCfg.webhookVerifyToken;
  } catch {
    /* DB indisponível */
  }
  return config.meta.verifyToken;
}

function payloadObjectForSafeLog(payload: WebhookPayload | null): string | null {
  return payload?.object === 'whatsapp_business_account' ? payload.object : null;
}

function warnBypassStateOnce(
  decision: MetaWebhookSignatureBypassDecision,
  environment: string,
  loggedStates: Set<string>,
  logger: WebhookLogger
): void {
  const key = `${decision.active}:${decision.reason}:${decision.expiresAt}`;
  if (loggedStates.has(key)) return;
  loggedStates.add(key);

  if (decision.active) {
    logger.info('[META_WEBHOOK_SIGNATURE_BYPASS_ACTIVE]', {
      expiresAt: decision.expiresAt,
      now: decision.now,
      environment,
      reason: 'temporary_unsigned_webhook_contingency',
    });
    return;
  }

  if (decision.reason === 'allow_unsigned_until_missing' ||
      decision.reason === 'allow_unsigned_until_invalid' ||
      decision.reason === 'allow_unsigned_until_expired') {
    logger.warn('[META_WEBHOOK_SIGNATURE_BYPASS_INACTIVE]', {
      expiresAt: decision.expiresAt,
      now: decision.now,
      environment,
      reason: decision.reason,
    });
  }
}

export function createMetaWebhookRouter(dependencies: MetaWebhookRouterDependencies = {}): Router {
  const router = Router();
  const resolveVerifyToken = dependencies.getVerifyToken ?? getVerifyToken;
  const resolveAppSecret = dependencies.getAppSecret ?? (() => config.meta.appSecret);
  const enqueueWebhook = dependencies.processIncomingWebhook ?? processIncomingWebhook;
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? (() => new Date());
  const logger = dependencies.logger ?? console;
  const loggedBypassStates = new Set<string>();

  router.get('/', async (req: Request, res: Response) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    const expected = await resolveVerifyToken();
    if (mode === 'subscribe' && expected && token === expected && challenge != null && String(challenge).length > 0) {
      res.status(200).type('text/plain').send(String(challenge));
      return;
    }
    res.status(403).end();
  });

  router.post('/', (req: Request, res: Response) => {
    const appSecret = resolveAppSecret().trim();
    const signature = String(req.header('x-hub-signature-256') ?? '');
    const expected = req.rawBody && appSecret
      ? `sha256=${createHmac('sha256', appSecret).update(req.rawBody).digest('hex')}`
      : '';
    const validSignature = Boolean(signature && expected) &&
      Buffer.byteLength(signature) === Buffer.byteLength(expected) &&
      timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    const bypass = getMetaWebhookSignatureBypassDecision({ env, now: now() });
    const environment = String(env.APP_ENVIRONMENT ?? env.NODE_ENV ?? 'unknown').trim() || 'unknown';
    warnBypassStateOnce(bypass, environment, loggedBypassStates, logger);

    if (!validSignature && !bypass.active) {
      res.status(appSecret ? 401 : 503).send(appSecret ? 'Invalid signature' : 'Webhook signature not configured');
      return;
    }

    const payload = req.body as WebhookPayload;
    if (!validSignature && bypass.active) {
      logger.warn('[META_WEBHOOK_SIGNATURE_BYPASS_USED]', {
        signatureHeaderPresent: Boolean(signature),
        requestId: req.header('x-request-id') ?? null,
        payloadObject: payloadObjectForSafeLog(payload),
        now: bypass.now,
      });
    }

    res.status(200).send('OK');
    if (!payload || typeof payload !== 'object') {
      logger.info('[ANA_PIPELINE] webhook_body_invalid');
      return;
    }
    logger.info('[ANA_PIPELINE] webhook_post_accepted_enqueue');
    setImmediate(() => {
      enqueueWebhook(payload).catch((e) => {
        logger.error('[ANA_PIPELINE] processIncomingWebhook', e instanceof Error ? e.message : String(e));
        if (e instanceof Error && e.stack) logger.error(e.stack);
      });
    });
  });

  return router;
}

export default createMetaWebhookRouter();
