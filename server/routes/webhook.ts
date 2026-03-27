import { Router, type Request, type Response } from 'express';
import { verifyWebhook, processIncomingWebhook } from '../services/webhookProcessor.js';
import type { WebhookVerificationQuery } from '../types/webhook.js';
import type { WebhookPayload } from '../types/webhook.js';

const router = Router();

router.get('/', async (req: Request<object, string, unknown, WebhookVerificationQuery>, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const result = await verifyWebhook(mode ?? '', token ?? '', challenge ?? '');
  if (result === null) {
    return res.status(mode !== 'subscribe' || !challenge ? 400 : 403).send(mode !== 'subscribe' || !challenge ? 'Bad request' : 'Forbidden');
  }
  res.type('text/plain').send(result);
});

router.post('/', (req: Request, res: Response) => {
  res.status(200).send('OK');
  if (req.body?.object !== 'whatsapp_business_account') return;
  const payload = req.body as WebhookPayload;
  setImmediate(() => {
    processIncomingWebhook(payload).catch((e) => console.error('[Webhook] Process error:', e));
  });
});

export default router;
