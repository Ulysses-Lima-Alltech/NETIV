import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { generateText } from '../services/openaiResponsesService.js';
import { sendTextMessage, hasWhatsAppEnv } from '../services/whatsappService.js';

const router = Router();

const FALLBACK_MESSAGE = 'Tive um problema ao processar sua mensagem agora. Tente novamente em instantes.';
const NON_TEXT_MESSAGE = 'No momento só consigo responder a mensagens de texto.';

/** GET /webhook — validação da Meta (hub.mode, hub.verify_token, hub.challenge) */
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.meta.verifyToken && challenge != null && String(challenge).length > 0) {
    res.status(200).type('text/plain').send(String(challenge));
    return;
  }
  res.status(403).end();
});

/** POST /webhook — recebe eventos da Meta; responde 200 rápido e processa em background */
router.post('/', (req: Request, res: Response) => {
  res.status(200).send('OK');

  const payload = req.body;
  if (!payload || typeof payload !== 'object') return;

  if (payload.object !== 'whatsapp_business_account') return;
  const entry = payload.entry;
  if (!Array.isArray(entry)) return;

  for (const item of entry) {
    const changes = item.changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes) {
      if (change.field !== 'messages') continue;
      const value = change.value;
      if (!value || !Array.isArray(value.messages)) continue;

      for (const msg of value.messages) {
        const from = msg.from;
        const type = msg.type;
        const textBody = type === 'text' && msg.text?.body ? String(msg.text.body).trim() : null;

        setImmediate(() => {
          processOneMessage(String(from), type, textBody).catch((e) => {
            console.error('[Webhook Meta] processOneMessage:', e instanceof Error ? e.message : String(e));
          });
        });
      }
    }
  }
});

async function processOneMessage(from: string, type: string, textBody: string | null): Promise<void> {
  if (!hasWhatsAppEnv()) {
    console.error('[Webhook Meta] META_WHATSAPP_TOKEN ou META_PHONE_NUMBER_ID não configurados.');
    return;
  }

  let reply: string;
  if (type !== 'text' || !textBody) {
    reply = NON_TEXT_MESSAGE;
  } else {
    try {
      reply = await generateText(textBody, {
        systemPrompt: 'Você é um assistente prestativo. Responda de forma clara e concisa.',
      });
    } catch {
      reply = FALLBACK_MESSAGE;
    }
  }

  try {
    await sendTextMessage(from, reply);
  } catch (e) {
    console.error('[Webhook Meta] sendTextMessage:', e instanceof Error ? e.message : String(e));
  }
}

export default router;
