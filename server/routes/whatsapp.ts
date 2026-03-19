import { Router } from 'express';
import { sendTextMessage } from '../services/whatsappMetaService.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import {
  findOrCreateConversation,
  listConversationsWithPreview,
  getConversationById,
  updateClassification,
} from '../repositories/conversationRepository.js';
import { getEnterpriseById } from '../repositories/enterpriseRepository.js';
import { insertMessage, getMessagesByConversationId } from '../repositories/messageRepository.js';
import { sendMessageSchema, updateClassificationSchema } from '../validators/whatsapp.js';

const router = Router();

function tempToStage(t: string | null): string {
  if (t === 'quente') return 'HOT';
  if (t === 'morno') return 'WARM';
  return 'COLD';
}

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
      const config = await getWhatsAppConfig();
      let conversationId: number | undefined;
      if (config && result.metaMessageId) {
        const conv = await findOrCreateConversation('whatsapp', to, to, null, config.whatsappPhoneNumberId);
        await insertMessage(conv.id, 'assistant', message, result.metaMessageId ?? null);
        conversationId = conv.id;
      }
      return res.json({ success: true, metaMessageId: result.metaMessageId, conversationId });
    }
    console.error('[WhatsApp] POST /send falhou:', { error: result.error, code: result.code });
    res.status(result.code && result.code >= 400 ? result.code : 502).json({ success: false, error: result.error || 'Falha ao enviar via Meta.' });
  } catch (e) {
    console.error('[WhatsApp] POST /send:', e);
    res.status(500).json({ success: false, error: 'Erro interno ao enviar.' });
  }
});

router.get('/config/check', async (_req, res) => {
  try {
    const config = await getWhatsAppConfig();
    const ok = !!(config?.enabled && config.metaAccessToken && config.whatsappPhoneNumberId);
    res.json({ configured: ok });
  } catch (e) {
    console.error('[WhatsApp] GET config/check:', e);
    res.status(500).json({ configured: false });
  }
});

router.get('/conversations', async (req, res) => {
  try {
    const channel = (req.query.channel as string) || 'whatsapp';
    const limit = Math.min(parseInt(String(req.query.limit), 10) || 100, 500);
    const rows = await listConversationsWithPreview(channel, limit);
    res.json({
      conversations: rows.map((r) => ({
        id: String(r.id),
        channel: r.channel,
        externalContactId: r.external_contact_id,
        contactPhone: r.contact_phone,
        contactName: r.customer_name,
        status: 'open',
        lastMessageAt: r.last_message_at?.toISOString() ?? null,
        lastMessagePreview: r.last_message_preview ?? null,
        projectId: r.enterprise_id ?? null,
        projectName: r.enterprise_name ?? null,
        enterpriseId: r.enterprise_id ?? null,
        enterpriseName: r.enterprise_name ?? null,
        classificationStatus: r.classification ?? 'Novo',
        handoff: r.handoff ?? false,
        leadStage: tempToStage(r.lead_temperature),
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error('[WhatsApp] GET conversations:', e);
    res.status(500).json({ error: 'Erro ao listar.' });
  }
});

router.patch('/conversations/:id/classification', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const parsed = updateClassificationSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e: { message: string }) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const { project_id, classification_status, handoff } = parsed.data;
    const conv = await updateClassification(id, {
      enterprise_id: project_id !== undefined ? project_id : undefined,
      classification: classification_status,
      handoff,
    });
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    const projectName = conv.enterprise_id ? (await getEnterpriseById(conv.enterprise_id))?.name ?? null : null;
    res.json({
      id: conv.id,
      projectId: conv.enterprise_id ?? null,
      projectName,
      enterpriseId: conv.enterprise_id ?? null,
      enterpriseName: projectName,
      classificationStatus: conv.classification ?? 'Novo',
      handoff: conv.handoff ?? false,
    });
  } catch (e) {
    console.error('[WhatsApp] PATCH classification:', e);
    res.status(500).json({ error: 'Erro ao atualizar.' });
  }
});

router.post('/conversations/:id/send', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!message) return res.status(400).json({ success: false, error: 'Campo "message" é obrigatório.' });
    const conv = await getConversationById(id);
    if (!conv) return res.status(404).json({ success: false, error: 'Conversa não encontrada.' });
    const to = (conv.contact_phone || conv.external_contact_id || '').replace(/\D/g, '');
    if (!to) return res.status(400).json({ success: false, error: 'Sem número de telefone na conversa.' });
    const result = await sendTextMessage(to, message);
    if (result.success && result.metaMessageId) {
      await insertMessage(id, 'assistant', message, result.metaMessageId);
    }
    if (result.success) {
      return res.json({ success: true, metaMessageId: result.metaMessageId });
    }
    console.error('[WhatsApp] POST /conversations/:id/send falhou:', { convId: id, to: to.slice(-4), error: result.error, code: result.code });
    res.status(result.code && result.code >= 400 ? result.code : 502).json({ success: false, error: result.error || 'Falha ao enviar via Meta.' });
  } catch (e) {
    console.error('[WhatsApp] POST send:', e);
    res.status(500).json({ success: false, error: 'Erro interno ao enviar.' });
  }
});

router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const conv = await getConversationById(id);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    const rows = await getMessagesByConversationId(id);
    res.json({
      conversationId: id,
      messages: rows.map((m) => ({
        id: String(m.id),
        conversationId: id,
        direction: m.role === 'user' ? 'inbound' : 'outbound',
        type: 'text',
        content: m.content,
        status: 'sent',
        externalMessageId: m.meta_message_id,
        createdAt: m.created_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error('[WhatsApp] GET messages:', e);
    res.status(500).json({ error: 'Erro ao listar mensagens.' });
  }
});

export default router;
