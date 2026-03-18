import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { sendTextMessage, hasWhatsAppEnv } from '../services/whatsappService.js';
import { sendTextMessage as sendTextMeta } from '../services/whatsappMetaService.js';
import { findOrCreateConversation } from '../repositories/conversationRepository.js';
import { insertMessage, findMessageByMetaId } from '../repositories/messageRepository.js';
import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { handleIncomingMessage } from '../services/conversationEngine.js';

const router = Router();

const NON_TEXT_MESSAGE = 'No momento só consigo responder a mensagens de texto.';

async function canSendWhatsApp(): Promise<boolean> {
  if (hasWhatsAppEnv()) return true;
  const c = await getWhatsAppConfig();
  return !!(c?.enabled && c?.metaAccessToken?.trim() && c?.whatsappPhoneNumberId?.trim());
}

async function sendReply(to: string, text: string): Promise<void> {
  const r = await sendTextMeta(to, text);
  if (r.success) return;
  if (hasWhatsAppEnv()) {
    await sendTextMessage(to, text);
    return;
  }
  throw new Error(r.error || 'Sem canal de envio WhatsApp.');
}

async function getVerifyToken(): Promise<string> {
  try {
    const dbCfg = await getWhatsAppConfig();
    if (dbCfg?.webhookVerifyToken?.trim()) return dbCfg.webhookVerifyToken;
  } catch { /* DB indisponível, usa fallback */ }
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
      if (change?.field !== 'messages') continue;
      const value = change.value;
      if (!value) continue;
      const messages = value.messages;
      if (!Array.isArray(messages) || messages.length === 0) continue;
      const phoneNumberId = value.metadata?.phone_number_id ?? null;
      const contact = value.contacts?.[0];
      const contactName = contact?.profile?.name ?? null;

      for (const msg of messages) {
        const msgId = msg.id ? String(msg.id) : null;

        const from = String(msg.from || '');
        const type = msg?.type ?? 'unknown';
        const textBody = type === 'text' && msg.text?.body != null ? String(msg.text.body).trim() : null;

        setImmediate(() => {
          processOneMessage(from, type, textBody, msgId, contactName, phoneNumberId).catch((e) => {
            console.error('[Webhook Meta]', e instanceof Error ? e.message : String(e));
          });
        });
      }
    }
  }
});

async function processOneMessage(
  from: string,
  type: string,
  textBody: string | null,
  metaMessageId: string | null,
  contactName: string | null,
  phoneNumberId: string | null
): Promise<void> {
  if (!(await canSendWhatsApp())) {
    console.error('[Webhook Meta] WhatsApp não configurado.');
    return;
  }

  if (metaMessageId && (await findMessageByMetaId(metaMessageId))) return;

  const conv = await findOrCreateConversation('whatsapp', from, from, contactName, phoneNumberId);

  if (type !== 'text' || !textBody) {
    try {
      await sendReply(from, NON_TEXT_MESSAGE);
    } catch (e) {
      console.error('[Webhook Meta] send:', e);
    }
    return;
  }

  if (metaMessageId) {
    await insertMessage(conv.id, 'user', textBody, metaMessageId);
  } else {
    await insertMessage(conv.id, 'user', textBody, `in-${Date.now()}`);
  }

  const aiConfig = await getOpenAIConfig();
  if (aiConfig?.aiEnabled && aiConfig.openaiApiKey?.trim()) {
    await handleIncomingMessage({
      conversationId: conv.id,
      userMessage: textBody,
      toPhoneNumber: from,
    });
    return;
  }

  try {
    await sendReply(
      from,
      'Olá! No momento o assistente automático está desligado. Em breve um consultor da Quero Meu Apê retorna o contato.'
    );
  } catch (e) {
    console.error('[Webhook Meta] send:', e);
  }
}

export default router;
