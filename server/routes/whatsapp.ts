import { Router } from 'express';
import { sendTextMessage } from '../services/whatsappMetaService.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import { findOrCreateConversation, listConversationsWithPreview, getConversationById, updateClassification } from '../repositories/conversationRepository.js';
import { getProjectById } from '../repositories/projectRepository.js';
import { insertMessage } from '../repositories/messageRepository.js';
import { getMessagesByConversationId } from '../repositories/messageRepository.js';
import { sendMessageSchema, updateClassificationSchema } from '../validators/whatsapp.js';

const router = Router();

router.post('/send', async (req, res) => {
  try {
    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e: { message: string }) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ success: false, error: msg });
    }
    const { to, message } = parsed.data;
    const result = await sendTextMessage(to, message);

    if (result.success) {
      const config = getWhatsAppConfig();
      let conversationId: number | undefined;
      if (config && result.metaMessageId) {
        const conv = findOrCreateConversation(
          'whatsapp',
          to,
          to,
          null,
          config.whatsappPhoneNumberId
        );
        insertMessage(conv.id, 'outbound', result.metaMessageId, 'sent', message, null);
        conversationId = conv.id;
      }
      return res.json({ success: true, metaMessageId: result.metaMessageId, conversationId });
    }
    const status = result.code && result.code >= 400 ? result.code : 400;
    res.status(status).json({ success: false, error: result.error });
  } catch (e) {
    console.error('[WhatsApp] POST /send:', e);
    res.status(500).json({ success: false, error: 'Erro interno ao enviar mensagem.' });
  }
});

router.get('/config/check', (req, res) => {
  try {
    const config = getWhatsAppConfig();
    const ok = !!(
      config?.enabled &&
      config.metaAccessToken &&
      config.whatsappPhoneNumberId
    );
    res.json({ configured: ok });
  } catch (e) {
    console.error('[WhatsApp] GET config/check:', e);
    res.status(500).json({ configured: false });
  }
});

router.get('/conversations', (req, res) => {
  try {
    const channel = (req.query.channel as string) || 'whatsapp';
    const limit = Math.min(parseInt(String(req.query.limit), 10) || 100, 500);
    const rows = listConversationsWithPreview(channel, limit);
    res.json({
      conversations: rows.map((r) => ({
        id: String(r.id),
        channel: r.channel,
        externalContactId: r.external_id,
        contactPhone: r.contact_phone,
        contactName: r.contact_name,
        status: r.status,
        lastMessageAt: r.last_message_at,
        lastMessagePreview: r.last_message_preview ?? null,
        projectId: r.project_id ?? null,
        projectName: (r as { project_name?: string | null }).project_name ?? null,
        classificationStatus: r.classification_status ?? 'Novo',
        leadStage: r.lead_stage ?? null,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (e) {
    console.error('[WhatsApp] GET conversations:', e);
    res.status(500).json({ error: 'Erro ao listar conversas.' });
  }
});

router.patch('/conversations/:id/classification', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const parsed = updateClassificationSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e: { message: string }) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const { project_id, classification_status } = parsed.data;
    const conv = updateClassification(id, {
      project_id: project_id ?? null,
      classification_status,
    });
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    const projectName = conv.project_id ? (getProjectById(conv.project_id)?.name ?? null) : null;
    res.json({
      id: conv.id,
      projectId: conv.project_id ?? null,
      projectName,
      classificationStatus: conv.classification_status ?? 'Novo',
    });
  } catch (e) {
    console.error('[WhatsApp] PATCH conversations/:id/classification:', e);
    res.status(500).json({ error: 'Erro ao atualizar classificação.' });
  }
});

router.post('/conversations/:id/send', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const body = req.body as { message?: string };
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) return res.status(400).json({ success: false, error: 'Campo "message" é obrigatório.' });
    const conv = getConversationById(id);
    if (!conv) return res.status(404).json({ success: false, error: 'Conversa não encontrada.' });
    const to = (conv.contact_phone || conv.external_id || '').replace(/\D/g, '');
    if (!to) return res.status(400).json({ success: false, error: 'Conversa sem número de contato.' });
    const result = await sendTextMessage(to, message);
    if (result.success && result.metaMessageId) {
      insertMessage(id, 'outbound', result.metaMessageId, 'sent', message, null);
    }
    if (result.success) {
      return res.json({ success: true, metaMessageId: result.metaMessageId });
    }
    const status = result.code && result.code >= 400 ? result.code : 400;
    res.status(status).json({ success: false, error: result.error });
  } catch (e) {
    console.error('[WhatsApp] POST conversations/:id/send:', e);
    res.status(500).json({ success: false, error: 'Erro ao enviar mensagem.' });
  }
});

router.get('/conversations/:id/messages', (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const conv = getConversationById(id);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    const rows = getMessagesByConversationId(id);
    res.json({
      conversationId: id,
      messages: rows.map((m) => ({
        id: String(m.id),
        conversationId: m.conversation_id,
        direction: m.direction,
        type: m.type ?? 'text',
        content: m.content ?? m.body_text,
        status: m.status,
        externalMessageId: m.meta_message_id,
        createdAt: m.created_at,
      })),
    });
  } catch (e) {
    console.error('[WhatsApp] GET conversations/:id/messages:', e);
    res.status(500).json({ error: 'Erro ao listar mensagens.' });
  }
});

export default router;
