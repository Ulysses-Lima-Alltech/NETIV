import { Router, type Request, type Response } from 'express';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { config } from '../config.js';
import { processIncomingWebhook } from '../services/webhookProcessor.js';
import type { WebhookPayload } from '../types/webhook.js';
import { createHmac, timingSafeEqual } from 'crypto';

const router = Router();

async function getVerifyToken(): Promise<string> {
  try {
    const dbCfg = await getWhatsAppConfig();
    if (dbCfg?.webhookVerifyToken?.trim()) return dbCfg.webhookVerifyToken;
  } catch {
    /* DB indisponível */
  }
  return config.meta.verifyToken;
}

router.get('/', async (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const expected = await getVerifyToken();
  if (mode === 'subscribe' && expected && token === expected && challenge != null && String(challenge).length > 0) {
    res.status(200).type('text/plain').send(String(challenge));
    return;
  }
  res.status(403).end();
});

router.post('/', (req: Request, res: Response) => {
  const appSecret = config.meta.appSecret.trim();
  const signature = String(req.header('x-hub-signature-256') ?? '');
  const expected = req.rawBody && appSecret
    ? `sha256=${createHmac('sha256', appSecret).update(req.rawBody).digest('hex')}`
    : '';
  const validSignature = Boolean(signature && expected) &&
    Buffer.byteLength(signature) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));

  const temporaryUnsignedUntilRaw = String(
    process.env.META_WEBHOOK_ALLOW_UNSIGNED_UNTIL ?? ''
  ).trim();

  const temporaryUnsignedUntilMs = Date.parse(
    temporaryUnsignedUntilRaw
  );

  const temporaryUnsignedWindowActive =
    !appSecret &&
    Number.isFinite(temporaryUnsignedUntilMs) &&
    Date.now() < temporaryUnsignedUntilMs;

  if (!validSignature && !temporaryUnsignedWindowActive) {
    res.status(appSecret ? 401 : 503).send(
      appSecret
        ? 'Invalid signature'
        : 'Webhook signature not configured'
    );
    return;
  }

  if (!validSignature && temporaryUnsignedWindowActive) {
    console.warn(
      '[WEBHOOK_SECURITY] unsigned webhook temporarily accepted',
      {
        expiresAt: new Date(
          temporaryUnsignedUntilMs
        ).toISOString(),
      }
    );
  }
  res.status(200).send('OK');
  const payload = req.body as WebhookPayload;
  if (!payload || typeof payload !== 'object') {
    console.log('[ANA_PIPELINE] webhook_body_invalid');
    return;
  }
  console.log('[ANA_PIPELINE] webhook_post_accepted_enqueue');
  setImmediate(() => {
    processIncomingWebhook(payload).catch((e) => {
      console.error('[ANA_PIPELINE] processIncomingWebhook', e instanceof Error ? e.message : String(e));
      if (e instanceof Error && e.stack) console.error(e.stack);
    });
  });
});

export default router;
