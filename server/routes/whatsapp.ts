import { Router, type Request, type Response, type NextFunction } from 'express';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFile, unlink } from 'fs/promises';
import multer from 'multer';
import {
  sendTextMessage,
  sendTemplateMessage,
  isMetaWindowClosedError,
  sendLocalMediaToWhatsApp,
} from '../services/whatsappMetaService.js';
import {
  normalizeManualAttachmentMime,
  isManualAttachmentAllowed,
  MANUAL_WHATSAPP_ATTACHMENT_MAX_BYTES,
} from '../utils/manualWhatsappAttachment.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import {
  findOrCreateConversation,
  listConversationsWithPreview,
  getConversationById,
  updateClassification,
  deleteConversation,
  deleteAllConversationsByPhone,
  conversationReserveToPublic,
} from '../repositories/conversationRepository.js';
import { reprocessLastUserMessage } from '../services/conversationEngine.js';
import { getEnterpriseById } from '../repositories/enterpriseRepository.js';
import {
  insertMessage,
  getMessagesByConversationId,
  type MessageAttachmentPayload,
} from '../repositories/messageRepository.js';
import { getCorretorById } from '../repositories/corretorRepository.js';
import { sendMessageSchema, updateClassificationSchema } from '../validators/whatsapp.js';
import {
  getConversationWhatsAppWindowStatus,
  getPhoneWhatsAppWindowStatus,
} from '../services/whatsappWindowService.js';

const router = Router();

const manualAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MANUAL_WHATSAPP_ATTACHMENT_MAX_BYTES },
});

function conditionalManualFileUpload(req: Request, res: Response, next: NextFunction) {
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('multipart/form-data')) {
    return manualAttachmentUpload.single('file')(req, res, next);
  }
  return next();
}

function tempToStage(t: string | null | undefined): string | null {
  if (t == null || String(t).trim() === '') return null;
  const x = String(t).trim().toLowerCase();
  if (x === 'quente') return 'HOT';
  if (x === 'morno') return 'WARM';
  if (x === 'frio') return 'COLD';
  return null;
}

router.post('/send', async (req, res) => {
  try {
    console.log('[MANUAL_SEND_ROUTE] body recebido', req.body);
    const templateKey = typeof req.body?.templateKey === 'string' ? req.body.templateKey.trim() : '';
    if (templateKey) {
      const toRaw = typeof req.body?.to === 'string' ? req.body.to : '';
      const finalNumber = String(toRaw).replace(/\D/g, '');
      if (!finalNumber || finalNumber.length < 10) {
        return res.status(400).json({ success: false, error: 'Campo "to" é obrigatório e deve ser válido.' });
      }
      const templateResult = await sendTemplateMessage(finalNumber, templateKey);
      if (templateResult.success) {
        return res.json({ success: true, metaMessageId: templateResult.metaMessageId });
      }
      const code = templateResult.code && templateResult.code >= 400 ? templateResult.code : 502;
      return res.status(code).json({ success: false, error: templateResult.error || 'Falha ao enviar template.' });
    }

    const parsed = sendMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e: { message: string }) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ success: false, error: msg });
    }
    const { to, message } = parsed.data;
    const finalNumber = String(to).replace(/\D/g, '');
    const finalText = String(message);
    console.log('[MANUAL_SEND_ROUTE] número final', { to: finalNumber });
    console.log('[MANUAL_SEND_ROUTE] texto final', { message: finalText });

    const byPhone = await getPhoneWhatsAppWindowStatus(finalNumber);
    console.log('[WHATSAPP_WINDOW_CHECK]', {
      conversationId: byPhone.conversationId,
      lastInboundAt: byPhone.window.lastInboundAt,
      closesAt: byPhone.window.closesAt,
      isOpen: byPhone.window.isOpen,
      reason: byPhone.window.reason,
    });
    if (!byPhone.window.isOpen) {
      const windowClosedResponse = {
        success: false,
        error: 'Janela de atendimento encerrada. Envie uma mensagem padrão/template.',
        code: 'WHATSAPP_WINDOW_CLOSED',
        windowOpen: false,
      };
      console.log('[MANUAL_SEND_ROUTE] resposta final enviada ao frontend', windowClosedResponse);
      return res.status(409).json(windowClosedResponse);
    }

    const result = await sendTextMessage(to, message);

    if (result.success) {
      const config = await getWhatsAppConfig();
      let conversationId: number | undefined;
      if (config && result.metaMessageId) {
        const conv = await findOrCreateConversation('whatsapp', to, to, config.whatsappPhoneNumberId, null);
        await insertMessage(conv.id, 'assistant', message, result.metaMessageId ?? null);
        conversationId = conv.id;
      }
      const responseBody = { success: true, metaMessageId: result.metaMessageId, conversationId };
      console.log('[MANUAL_SEND_ROUTE] resposta final enviada ao frontend', responseBody);
      return res.json(responseBody);
    }
    if (isMetaWindowClosedError({ code: result.code, message: result.error })) {
      const windowClosedResponse = {
        success: false,
        error: 'Janela de atendimento encerrada. Envie uma mensagem padrão/template.',
        code: 'WHATSAPP_WINDOW_CLOSED',
        windowOpen: false,
      };
      console.log('[MANUAL_SEND_ROUTE] resposta final enviada ao frontend', windowClosedResponse);
      return res.status(409).json(windowClosedResponse);
    }
    console.error('[WhatsApp] POST /send falhou:', { error: result.error, code: result.code });
    const errorResponse = { success: false, error: result.error || 'Falha ao enviar via Meta.' };
    console.log('[MANUAL_SEND_ROUTE] resposta final enviada ao frontend', errorResponse);
    res.status(result.code && result.code >= 400 ? result.code : 502).json(errorResponse);
  } catch (e) {
    console.error('[WhatsApp] POST /send:', e);
    const errorResponse = { success: false, error: 'Erro interno ao enviar.' };
    console.log('[MANUAL_SEND_ROUTE] resposta final enviada ao frontend', errorResponse);
    res.status(500).json(errorResponse);
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
    const mode = req.query.mode as string | undefined;
    const status = req.query.status as string | undefined;
    const enterpriseId = req.query.enterpriseId != null ? parseInt(String(req.query.enterpriseId), 10) : undefined;
    const search = req.query.search as string | undefined;
    const filters: { mode?: 'ANA' | 'handoff'; status?: string; enterpriseId?: number; search?: string } = {};
    if (mode === 'ANA' || mode === 'handoff') filters.mode = mode;
    if (status && status !== 'all') filters.status = status;
    if (enterpriseId != null && !Number.isNaN(enterpriseId)) filters.enterpriseId = enterpriseId;
    if (search && search.trim() !== '') filters.search = search.trim();
    const hasFilters = Object.keys(filters).length > 0;
    const rows = await listConversationsWithPreview(channel, limit, hasFilters ? filters : undefined);
    res.json({
      conversations: rows.map((r) => ({
        id: String(r.id),
        channel: r.channel,
        externalContactId: r.external_contact_id,
        contactPhone: r.contact_phone,
        contactName:
          (r.whatsapp_display_name ?? '').trim() ||
          (r.customer_name ?? '').trim() ||
          null,
        whatsappDisplayName: r.whatsapp_display_name ?? null,
        customerName: r.customer_name ?? null,
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
        enterpriseOriginId: r.enterprise_origin_id ?? null,
        leadSourceRaw: r.lead_source_raw ?? null,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
        assignedBrokerName: (r as { assigned_broker_name?: string | null }).assigned_broker_name ?? null,
        assignedBrokerId: (r as { assigned_broker_id?: number | null }).assigned_broker_id ?? null,
        ...conversationReserveToPublic(r),
      })),
    });
  } catch (e) {
    console.error('[WhatsApp] GET conversations:', e);
    res.status(500).json({ error: 'Erro ao listar.' });
  }
});

router.delete('/conversations/by-phone/:phone', async (req, res) => {
  try {
    const phone = (req.params.phone || '').trim();
    if (!phone || phone.replace(/\D/g, '').length < 8) {
      return res.status(400).json({ error: 'Número de telefone inválido.' });
    }
    const count = await deleteAllConversationsByPhone(phone);
    console.log('[WhatsApp] DELETE by-phone:', { phone: phone.slice(-4), deletedCount: count });
    res.json({ success: true, deletedCount: count });
  } catch (e) {
    console.error('[WhatsApp] DELETE by-phone:', e);
    res.status(500).json({ error: 'Erro ao excluir histórico.' });
  }
});

router.delete('/conversations/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const deleted = await deleteConversation(id);
    if (!deleted) return res.status(404).json({ error: 'Conversa não encontrada.' });
    res.json({ success: true });
  } catch (e) {
    console.error('[WhatsApp] DELETE conversation:', e);
    res.status(500).json({ error: 'Erro ao excluir.' });
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
    const { project_id, classification_status, handoff, reserve, lead_temperature, assigned_broker_id } = parsed.data;
    const convBefore = handoff === false ? await getConversationById(id) : null;
    const conv = await updateClassification(id, {
      enterprise_id: project_id !== undefined ? project_id : undefined,
      classification: classification_status,
      handoff,
      lead_temperature,
      reserve,
      assigned_broker_id,
    });
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    if (convBefore?.handoff === true && conv.handoff === false) {
      try {
        await reprocessLastUserMessage(id);
      } catch (e) {
        console.error('[WhatsApp] reprocessLastUserMessage:', e);
      }
    }
    const projectName = conv.enterprise_id ? (await getEnterpriseById(conv.enterprise_id))?.name ?? null : null;
    const originName =
      conv.enterprise_origin_id != null ? (await getEnterpriseById(conv.enterprise_origin_id))?.name ?? null : null;
    const bid = conv.assigned_broker_id;
    const brokerRow = bid != null ? await getCorretorById(bid) : null;
    res.json({
      id: conv.id,
      projectId: conv.enterprise_id ?? null,
      projectName,
      enterpriseId: conv.enterprise_id ?? null,
      enterpriseName: projectName,
      enterpriseOriginId: conv.enterprise_origin_id ?? null,
      enterpriseOriginName: originName,
      leadSourceRaw: conv.lead_source_raw ?? null,
      classificationStatus: conv.classification ?? 'Novo',
      leadStage: tempToStage(conv.lead_temperature),
      handoff: conv.handoff ?? false,
      assignedBrokerId: conv.assigned_broker_id ?? null,
      assignedBrokerName: brokerRow?.full_name ?? null,
      ...conversationReserveToPublic(conv),
    });
  } catch (e) {
    console.error('[WhatsApp] PATCH classification:', e);
    res.status(500).json({ error: 'Erro ao atualizar.' });
  }
});

router.post('/conversations/:id/send', conditionalManualFileUpload, async (req, res) => {
  try {
    const idParam = req.params['id'];
    const id = parseInt(Array.isArray(idParam) ? idParam[0]! : String(idParam), 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const templateKey = typeof req.body?.templateKey === 'string' ? req.body.templateKey.trim() : '';
    const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    const file = req.file;

    if (templateKey && file) {
      return res.status(400).json({ success: false, error: 'Não é possível enviar template e anexo no mesmo pedido.' });
    }
    if (!templateKey && !message && !file) {
      return res.status(400).json({ success: false, error: 'Envie texto e/ou arquivo.' });
    }

    const conv = await getConversationById(id);
    if (!conv) return res.status(404).json({ success: false, error: 'Conversa não encontrada.' });
    const to = (conv.contact_phone || conv.external_contact_id || '').replace(/\D/g, '');
    if (!to) return res.status(400).json({ success: false, error: 'Sem número de telefone na conversa.' });

    if (templateKey) {
      const result = await sendTemplateMessage(to, templateKey, {
        customerName: conv.customer_name ?? conv.whatsapp_display_name ?? conv.contact_phone ?? conv.external_contact_id,
        enterpriseName: conv.enterprise_id ? (await getEnterpriseById(conv.enterprise_id))?.name ?? null : null,
      });
      if (result.success && result.metaMessageId) {
        await insertMessage(id, 'assistant', `[template:${templateKey}]`, result.metaMessageId);
      }
      if (result.success) return res.json({ success: true, metaMessageId: result.metaMessageId });
      return res.status(result.code && result.code >= 400 ? result.code : 502).json({
        success: false,
        error: result.error || 'Falha ao enviar template.',
      });
    }

    const window = await getConversationWhatsAppWindowStatus(id);
    console.log('[WHATSAPP_WINDOW_CHECK]', {
      conversationId: id,
      lastInboundAt: window.lastInboundAt,
      closesAt: window.closesAt,
      isOpen: window.isOpen,
      reason: window.reason,
    });
    if (!window.isOpen) {
      return res.status(409).json({
        success: false,
        error: 'Janela de atendimento encerrada. Envie uma mensagem padrão/template.',
        code: 'WHATSAPP_WINDOW_CLOSED',
        windowOpen: false,
      });
    }

    if (file) {
      const safeName = (file.originalname || 'anexo').replace(/[\r\n\u0000\\/]/g, '_').slice(0, 240);
      const resolvedMime = normalizeManualAttachmentMime(safeName, file.mimetype);
      if (!resolvedMime || !isManualAttachmentAllowed(safeName, file.mimetype, file.size)) {
        return res.status(400).json({
          success: false,
          error: 'Anexo não suportado. Use PDF, JPG, PNG ou WEBP (máx. 10 MB).',
        });
      }
      const tempPath = join(tmpdir(), `wa-manual-${randomBytes(16).toString('hex')}-${safeName}`);
      await writeFile(tempPath, file.buffer);
      try {
        const mediaRes = await sendLocalMediaToWhatsApp(to, tempPath, safeName, resolvedMime, {
          caption: message.length > 0 ? message : null,
        });
        if (mediaRes.success && mediaRes.metaMessageId) {
          const mk = mediaRes.messageKind === 'image' ? 'image' : 'document';
          const displayText =
            message.length > 0 ? `${message}\n\n📎 ${safeName}` : `📎 ${safeName}`;
          const attachment: MessageAttachmentPayload = {
            fileName: safeName,
            mimeType: resolvedMime,
            sizeBytes: file.size,
            whatsappMediaId: mediaRes.whatsappMediaId ?? null,
            caption: message.length > 0 ? message : null,
            enterpriseFileId: null,
          };
          await insertMessage(id, 'assistant', displayText, mediaRes.metaMessageId, {
            messageKind: mk,
            attachment,
          });
          return res.json({ success: true, metaMessageId: mediaRes.metaMessageId, messageKind: mk });
        }
        if (mediaRes.success) {
          return res.json({ success: true, metaMessageId: mediaRes.metaMessageId, messageKind: 'document' });
        }
        if (isMetaWindowClosedError({ code: mediaRes.code, message: mediaRes.error })) {
          return res.status(409).json({
            success: false,
            error: 'Janela de atendimento encerrada. Envie uma mensagem padrão/template.',
            code: 'WHATSAPP_WINDOW_CLOSED',
            windowOpen: false,
          });
        }
        console.error('[WhatsApp] POST /conversations/:id/send (mídia) falhou:', {
          convId: id,
          error: mediaRes.error,
          code: mediaRes.code,
        });
        return res.status(mediaRes.code && mediaRes.code >= 400 ? mediaRes.code : 502).json({
          success: false,
          error: mediaRes.error || 'Falha ao enviar arquivo via Meta.',
        });
      } finally {
        await unlink(tempPath).catch(() => {});
      }
    }

    const result = await sendTextMessage(to, message);
    if (result.success && result.metaMessageId) {
      await insertMessage(id, 'assistant', message, result.metaMessageId);
    }
    if (result.success) {
      return res.json({ success: true, metaMessageId: result.metaMessageId });
    }
    if (isMetaWindowClosedError({ code: result.code, message: result.error })) {
      return res.status(409).json({
        success: false,
        error: 'Janela de atendimento encerrada. Envie uma mensagem padrão/template.',
        code: 'WHATSAPP_WINDOW_CLOSED',
        windowOpen: false,
      });
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
    const window = await getConversationWhatsAppWindowStatus(id);
    res.json({
      conversationId: id,
      window,
      messages: rows.map((m) => {
        const kind = (m.message_kind as string | undefined) || 'text';
        const hasAtt = kind === 'document' || kind === 'image';
        return {
          id: String(m.id),
          conversationId: id,
          direction: m.role === 'user' ? 'inbound' : 'outbound',
          type: hasAtt ? kind : 'text',
          content: m.content,
          status: 'sent',
          externalMessageId: m.meta_message_id,
          createdAt: m.created_at.toISOString(),
          attachment: hasAtt ? m.attachment_json : null,
        };
      }),
    });
  } catch (e) {
    console.error('[WhatsApp] GET messages:', e);
    res.status(500).json({ error: 'Erro ao listar mensagens.' });
  }
});

export default router;
