import { Router, type Request, type Response } from 'express';
import { sendTextMessage } from '../services/whatsappMetaService.js';
import { findOrCreateConversation } from '../repositories/conversationRepository.js';
import { insertMessage, findMessageByMetaId } from '../repositories/messageRepository.js';
import { getOpenAIConfig } from '../repositories/openaiConfigRepository.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { handleIncomingMessage } from '../services/conversationEngine.js';
import { config } from '../config.js';

const router = Router();

const NON_TEXT_MESSAGE = 'No momento só consigo responder a mensagens de texto.';

async function canSendWhatsApp(): Promise<boolean> {
  const c = await getWhatsAppConfig();
  return !!(c?.metaAccessToken?.trim() && c?.whatsappPhoneNumberId?.trim());
}

async function sendReply(to: string, text: string): Promise<void> {
  const r = await sendTextMessage(to, text);
  if (r.success) return;
  throw new Error(r.error || 'Falha ao enviar WhatsApp.');
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
  console.log('[ANA DEBUG] webhook received');
  res.status(200).send('OK');

  const payload = req.body;
  if (!payload || typeof payload !== 'object') {
    console.log('[ANA DEBUG] payload inválido ou ausente');
    return;
  }
  if (payload.object !== 'whatsapp_business_account') {
    console.log('[ANA DEBUG] payload.object !== whatsapp_business_account', payload.object);
    return;
  }

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
            console.error('[ANA DEBUG] Erro em processOneMessage:', e instanceof Error ? e.message : String(e));
            if (e instanceof Error && e.stack) {
              console.error('[ANA DEBUG] Stack:', e.stack);
            }
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
    console.error('[ANA DEBUG] WhatsApp não configurado — mensagem ignorada.');
    return;
  }

  if (metaMessageId && (await findMessageByMetaId(metaMessageId))) {
    console.log('[ANA DEBUG] mensagem já processada (idempotência)', { metaMessageId });
    return;
  }

  const conv = await findOrCreateConversation('whatsapp', from, from, contactName, phoneNumberId);
  console.log('[ANA DEBUG] conversa obtida', { conversationId: conv.id, from });

  if (type !== 'text' || !textBody) {
    console.log('[ANA DEBUG] mensagem não textual, enviando resposta fixa', { type, hasBody: !!textBody });
    try {
      await sendReply(from, NON_TEXT_MESSAGE);
    } catch (e) {
      console.error('[ANA DEBUG] Falha ao enviar resposta para não-texto:', e instanceof Error ? e.message : e);
    }
    return;
  }

  if (metaMessageId) {
    await insertMessage(conv.id, 'user', textBody, metaMessageId);
  } else {
    await insertMessage(conv.id, 'user', textBody, `in-${Date.now()}`);
  }
  console.log('[ANA DEBUG] message saved', { conversationId: conv.id, metaMessageId: metaMessageId ?? 'gerado' });

  const aiConfig = await getOpenAIConfig();
  console.log('[ANA DEBUG] aiConfig loaded', {
    hasConfig: !!aiConfig,
    hasApiKey: !!aiConfig?.openaiApiKey?.trim(),
    aiEnabled: aiConfig?.aiEnabled,
    conversationId: conv.id,
  });
  if (!aiConfig) {
    console.error('[ANA DEBUG] getOpenAIConfig retornou null — integration_settings id=1 inexistente?', { conversationId: conv.id });
    return;
  }
  if (!aiConfig.openaiApiKey?.trim()) {
    console.error('[ANA DEBUG] OpenAI API Key não configurada — mensagem salva mas não processada pela IA', { conversationId: conv.id });
    return;
  }
  if (!aiConfig.aiEnabled) {
    console.log('[ANA DEBUG] aiEnabled check blocked — ai_enabled=false no banco. Ative em Configurações > IA.', { conversationId: conv.id });
    return;
  }
  console.log('[ANA DEBUG] aiEnabled check passed');

  try {
    console.log('[ANA DEBUG] chamando handleIncomingMessage', { conversationId: conv.id });
    await handleIncomingMessage({
      conversationId: conv.id,
      userMessage: textBody,
      toPhoneNumber: from,
    });
  } catch (e) {
    console.error('[ANA DEBUG] Erro ao processar com IA:', e instanceof Error ? e.message : String(e));
    if (e instanceof Error && e.stack) {
      console.error('[ANA DEBUG] Stack:', e.stack);
    }
  }
}

export default router;
