import { Router, type Request, type Response, type NextFunction } from 'express';
import type { ZodIssue } from 'zod';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFile, unlink } from 'fs/promises';
import multer, { MulterError } from 'multer';
import {
  sendTextMessage,
  sendTemplateMessage,
  isMetaWindowClosedError,
  sendLocalMediaToWhatsApp,
} from '../services/whatsappMetaService.js';
import { listWhatsAppTemplatesCatalog } from '../catalogs/whatsappTemplates.js';
import {
  createMetaTemplate,
  deleteMetaTemplateByName,
  listMetaTemplatesRaw,
  listBatchTemplatesFromMetaOrFallback,
  MetaTemplateDeleteError,
} from '../services/whatsappTemplateCatalogSyncService.js';
import { parseSpreadsheet } from '../services/spreadsheetParseService.js';
import {
  parseBatchConfigSchema,
  batchSendSchema,
  batchTestSchema,
} from '../validators/whatsappBatch.js';
import {
  buildBatchSuggestions,
  buildBatchPreview,
  sendBatchTemplate,
  sendBatchTemplateTest,
} from '../services/whatsappBatchTemplateService.js';
import {
  normalizeManualAttachmentMime,
  isManualAttachmentAllowed,
  manualAttachmentRejectionMessage,
  MANUAL_UPLOAD_BODY_LIMIT_BYTES,
} from '../utils/manualWhatsappAttachment.js';
import { getWhatsAppConfig } from '../repositories/whatsappConfigRepository.js';
import {
  findOrCreateConversation,
  listConversationsWithPreview,
  getConversationWithPreviewById,
  getConversationById,
  updateClassification,
  deleteConversation,
  deleteAllConversationsByPhone,
  resetConversationState,
  updateConversationType,
  conversationReserveToPublic,
  setConversationCustomerName,
  closeConversationManual,
  reopenConversationManual,
  type ConversationWithPreview,
} from '../repositories/conversationRepository.js';
import { requireRole, type AuthenticatedRequest } from '../middleware/auth.js';
import { assertCanAccessConversation } from '../middleware/conversationAccess.js';
import { reprocessLastUserMessage } from '../services/conversationEngine.js';
import { getEnterpriseById } from '../repositories/enterpriseRepository.js';
import { findContactById, updateContactType } from '../repositories/contactsRepository.js';
import {
  insertMessage,
  getMessagesByConversationId,
  softDeleteMessage,
  getLastUserMessageRow,
  type MessageAttachmentPayload,
} from '../repositories/messageRepository.js';
import { scheduleAnaRetry } from '../services/anaRetrySchedulerService.js';
import { getCorretorById } from '../repositories/corretorRepository.js';
import {
  sendMessageSchema,
  updateClassificationSchema,
  updateConversationTypeSchema,
} from '../validators/whatsapp.js';
import { resolveSafeDisplayName } from '../utils/customerNameResolver.js';
import {
  getConversationWhatsAppWindowStatus,
  getPhoneWhatsAppWindowStatus,
} from '../services/whatsappWindowService.js';
import { registerWhatsAppEventsSse } from '../services/whatsappEvents.js';
import { publishConversationUpdated } from '../realtime/realtimePublisher.js';
import { canAccessAll, canAccessBroker, canAccessEnterprise, getAccessibleConversationIds } from '../services/authorizationService.js';

const router = Router();

router.use('/templates', requireRole('ADMIN'));
router.use('/config', requireRole('ADMIN'));

router.get('/events', (req, res) => {
  registerWhatsAppEventsSse(req, res);
});

const manualAttachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MANUAL_UPLOAD_BODY_LIMIT_BYTES },
});
const batchUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 },
});

function conditionalManualFileUpload(req: Request, res: Response, next: NextFunction) {
  const ct = String(req.headers['content-type'] || '');
  if (ct.includes('multipart/form-data')) {
    return manualAttachmentUpload.single('file')(req, res, (err: unknown) => {
      if (err instanceof MulterError && err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({
          success: false,
          error: 'Arquivo excede o limite de 100 MB permitido pelo servidor.',
          code: 'PAYLOAD_TOO_LARGE',
        });
      }
      if (err) return next(err);
      next();
    });
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

function mapConversationWithPreviewRow(r: ConversationWithPreview) {
  const isHandoff = r.handoff === true || (r.classification ?? '') === 'Handoff';
  const assignedBrokerNameRaw = (r as { assigned_broker_name?: string | null }).assigned_broker_name ?? null;
  const assignedBrokerIdRaw = (r as { assigned_broker_id?: number | null }).assigned_broker_id ?? null;
  const brokerNotificationStatusRaw =
    (r as { broker_notification_status?: string | null }).broker_notification_status ?? null;
  const brokerPushNotificationStatusRaw =
    (r as { broker_push_notification_status?: string | null }).broker_push_notification_status ?? null;
  return {
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
    classificationStatus: isHandoff ? 'Handoff' : (r.classification ?? 'Novo'),
    handoff: isHandoff,
    attendanceMode: isHandoff ? 'handoff' : 'ana',
    leadStage: tempToStage(r.lead_temperature),
    enterpriseOriginId: r.enterprise_origin_id ?? null,
    leadSourceRaw: r.lead_source_raw ?? null,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
    assignedBrokerName: isHandoff ? assignedBrokerNameRaw : null,
    assignedBrokerId: isHandoff ? assignedBrokerIdRaw : null,
    brokerNotificationStatus: isHandoff ? brokerNotificationStatusRaw : null,
    brokerPushNotificationStatus: isHandoff ? brokerPushNotificationStatusRaw : null,
    conversationType: (r as { conversation_type?: string | null }).conversation_type ?? 'CLIENT',
    manualClosedAt: (r as { manual_closed_at?: Date | null }).manual_closed_at?.toISOString() ?? null,
    manualClosedByUserId: (r as { manual_closed_by_user_id?: number | null }).manual_closed_by_user_id ?? null,
    manualClosedReason: (r as { manual_closed_reason?: string | null }).manual_closed_reason ?? null,
    reengagementCount: (r as { reengagement_count?: number }).reengagement_count ?? 0,
    ...conversationReserveToPublic(r),
  };
}

function parseBatchPayload(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function ensureBatchFile(req: Request, res: Response): Express.Multer.File | null {
  if (!req.file?.buffer) {
    res.status(400).json({ success: false, error: 'Arquivo CSV/XLSX é obrigatório.' });
    return null;
  }
  return req.file;
}

router.get('/templates', async (_req, res) => {
  try {
    const list = await listMetaTemplatesRaw();
    return res.json({
      templates: list.map((item) => ({ ...item, source: 'meta' as const })),
      source: 'meta_sync',
    });
  } catch (error) {
    console.error('[WHATSAPP_TEMPLATES_LIST_ERROR]', error);
    return res.json({
      templates: listWhatsAppTemplatesCatalog().map((item) => ({ ...item, source: 'local_fallback' as const })),
      source: 'local_fallback',
    });
  }
});

const createTemplateSchema = z.object({
  name: z.string().min(1),
  category: z.enum(['MARKETING', 'UTILITY', 'AUTHENTICATION']),
  language: z.string().default('pt_BR'),
  body: z.string().min(1),
  headerText: z.string().optional(),
  footerText: z.string().optional(),
  bodyExamples: z.record(z.string(), z.string()).optional(),
});

router.post('/templates', async (req, res) => {
  try {
    const parsed = createTemplateSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ error: 'Payload inválido para criação de template.', details: parsed.error.issues });
    }
    console.log('[WHATSAPP_TEMPLATE_CREATE_REQUEST]', {
      name: parsed.data.name,
      category: parsed.data.category,
      language: parsed.data.language,
    });
    const result = await createMetaTemplate(parsed.data);
    console.log('[WHATSAPP_TEMPLATE_CREATE_SUCCESS]', { name: parsed.data.name });
    return res.json({ success: true, result });
  } catch (error) {
    console.error('[WHATSAPP_TEMPLATE_CREATE_ERROR]', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao criar template na Meta.',
    });
  }
});

router.delete('/templates/:name', async (req, res) => {
  try {
    const templateName = String(req.params.name ?? '').trim();
    if (!templateName) return res.status(400).json({ error: 'Nome do template é obrigatório.' });
    console.log('[WHATSAPP_TEMPLATE_DELETE_REQUEST]', { name: templateName });
    const result = await deleteMetaTemplateByName(templateName);
    console.log('[WHATSAPP_TEMPLATE_DELETE_SUCCESS]', { name: templateName });
    return res.json({ success: true, result });
  } catch (error) {
    console.error('[WHATSAPP_TEMPLATE_DELETE_ERROR]', error);
    if (error instanceof MetaTemplateDeleteError) {
      return res.status(error.statusCode).json({
        success: false,
        error: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      error: 'Erro ao excluir template na Meta.',
    });
  }
});

router.post('/templates/sync', async (_req, res) => {
  try {
    const { templates, fallbackUsed } = await listBatchTemplatesFromMetaOrFallback({ forceRefresh: true });
    return res.json({ success: true, templates, fallbackUsed });
  } catch (error) {
    console.error('[WHATSAPP_TEMPLATE_SYNC_ERROR]', error);
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Erro ao sincronizar templates com a Meta.',
    });
  }
});

router.post('/templates/batch/parse', batchUpload.single('file'), async (req, res) => {
  try {
    const file = ensureBatchFile(req, res);
    if (!file) return;
    const parsedCfg = parseBatchConfigSchema.safeParse(parseBatchPayload(req.body?.config) ?? {});
    if (!parsedCfg.success) {
      const msg = parsedCfg.error.issues.map((e: ZodIssue) => e.message).join('; ') || 'Configuração inválida.';
      return res.status(400).json({ success: false, error: msg });
    }
    const parsed = parseSpreadsheet(file.buffer, file.originalname, file.mimetype);
    const suggestions = buildBatchSuggestions(parsed.headers);
    res.json({
      headers: parsed.headers,
      rowCount: parsed.rowCount,
      sampleRows: parsed.sampleRows,
      suggestions,
      templateKey: parsedCfg.data.templateKey ?? null,
    });
  } catch (e) {
    console.error('[WhatsApp] POST /templates/batch/parse:', e);
    res.status(500).json({ success: false, error: 'Erro ao processar planilha.' });
  }
});

router.post('/templates/batch/preview', batchUpload.single('file'), async (req, res) => {
  try {
    const file = ensureBatchFile(req, res);
    if (!file) return;
    const parsedBody = batchSendSchema.safeParse(parseBatchPayload(req.body?.payload));
    if (!parsedBody.success) {
      const msg = parsedBody.error.issues.map((e: ZodIssue) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ success: false, error: msg });
    }
    const parsed = parseSpreadsheet(file.buffer, file.originalname, file.mimetype);
    const preview = await buildBatchPreview({ rows: parsed.rows, mapping: parsedBody.data.mapping });
    res.json(preview);
  } catch (e) {
    console.error('[WhatsApp] POST /templates/batch/preview:', e);
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Erro no preview.' });
  }
});

router.post('/templates/batch/test', batchUpload.single('file'), async (req, res) => {
  try {
    const file = ensureBatchFile(req, res);
    if (!file) return;
    const parsedBody = batchTestSchema.safeParse(parseBatchPayload(req.body?.payload));
    if (!parsedBody.success) {
      const msg = parsedBody.error.issues.map((e: ZodIssue) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ success: false, error: msg });
    }
    const parsed = parseSpreadsheet(file.buffer, file.originalname, file.mimetype);
    const result = await sendBatchTemplateTest({
      rows: parsed.rows,
      mapping: parsedBody.data.mapping,
      testPhone: parsedBody.data.testPhone,
      mode: parsedBody.data.mode,
      sampleRowIndex: parsedBody.data.sampleRowIndex,
      manualVariables: parsedBody.data.manualVariables,
    });
    if (!result.success) {
      const status = result.httpStatus && result.httpStatus >= 400 ? result.httpStatus : 502;
      return res.status(status).json(result);
    }
    res.json(result);
  } catch (e) {
    console.error('[WhatsApp] POST /templates/batch/test:', e);
    res.status(500).json({ success: false, error: e instanceof Error ? e.message : 'Erro no envio de teste.' });
  }
});

router.post('/templates/batch/send', batchUpload.single('file'), async (req, res) => {
  try {
    const file = ensureBatchFile(req, res);
    if (!file) return;
    const parsedBody = batchSendSchema.safeParse(parseBatchPayload(req.body?.payload));
    if (!parsedBody.success) {
      const msg = parsedBody.error.issues.map((e: ZodIssue) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ success: false, error: msg });
    }
    const parsed = parseSpreadsheet(file.buffer, file.originalname, file.mimetype);
    const result = await sendBatchTemplate({ rows: parsed.rows, mapping: parsedBody.data.mapping });
    res.json(result);
  } catch (e) {
    console.error('[WhatsApp] POST /templates/batch/send:', e);
    const message = e instanceof Error ? e.message : 'Erro no envio em lote.';
    const status = message === 'Nenhum número válido para envio.' ? 400 : 500;
    res.status(status).json({ success: false, error: message });
  }
});

router.post('/send', requireRole('ADMIN'), async (req, res) => {
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
    const typeRaw = String(req.query.type || 'CLIENT').toUpperCase();
    const type = typeRaw === 'INTERNO' ? 'INTERNO' : 'CLIENT';

    // ── Scope filtering (broker_portfolio) ──
    // Se o usuário tem escopo broker_portfolio, SEMPRE passa o array (mesmo vazio).
    // O repositório interpreta `[]` como "não retornar nada" e `undefined` como "sem restrição".
    const user = (req as AuthenticatedRequest).user;
    const scopeConvIds = canAccessAll(user) ? undefined : await getAccessibleConversationIds(user);

    const filters: {
      mode?: 'ANA' | 'handoff';
      status?: string;
      enterpriseId?: number;
      search?: string;
      conversationTypeFilter?: 'CLIENT' | 'INTERNO';
      scopeConvIds?: number[];
    } = {};
    if (mode === 'ANA' || mode === 'handoff') filters.mode = mode;
    if (status && status !== 'all') filters.status = status;
    if (enterpriseId != null && !Number.isNaN(enterpriseId)) filters.enterpriseId = enterpriseId;
    if (search && search.trim() !== '') filters.search = search.trim();
    if (scopeConvIds !== undefined) filters.scopeConvIds = scopeConvIds;
    filters.conversationTypeFilter = type as 'CLIENT' | 'INTERNO';
    const hasFilters = Object.keys(filters).length > 0;
    const rows = await listConversationsWithPreview(channel, limit, hasFilters ? filters : undefined);
    console.log('[INBOX_CONTACT_TYPE_FILTER]', { requestedType: type, returned: rows.length, scopeSize: scopeConvIds?.length });
    res.json({
      conversations: rows.map((r) => mapConversationWithPreviewRow(r)),
    });
  } catch (e) {
    console.error('[WhatsApp] GET conversations:', e);
    res.status(500).json({ error: 'Erro ao listar.' });
  }
});

router.get('/conversations/:id', async (req, res) => {
  try {
    const idRaw = req.params['id'];
    const id = parseInt(Array.isArray(idRaw) ? idRaw[0]! : String(idRaw), 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    if (!(await assertCanAccessConversation(req as AuthenticatedRequest, res, id))) return;
    const row = await getConversationWithPreviewById(id);
    if (!row) {
      res.status(404).json({ error: 'Conversa não encontrada.' });
      return;
    }
    res.json(mapConversationWithPreviewRow(row));
  } catch (e) {
    console.error('[WhatsApp] GET conversation:', e);
    res.status(500).json({ error: 'Erro ao carregar conversa.' });
  }
});

router.delete('/conversations/by-phone/:phone', async (req, res) => {
  try {
    if ((req as AuthenticatedRequest).user?.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Operação não permitida.' });
    }
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
    if (!(await assertCanAccessConversation(req as AuthenticatedRequest, res, id))) return;
    const deleted = await deleteConversation(id);
    if (!deleted) return res.status(404).json({ error: 'Conversa não encontrada.' });
    res.json({ success: true });
  } catch (e) {
    console.error('[WhatsApp] DELETE conversation:', e);
    res.status(500).json({ error: 'Erro ao excluir.' });
  }
});

router.post('/conversations/:id/reset', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    if (!(await assertCanAccessConversation(req as AuthenticatedRequest, res, id))) return;
    const ok = await resetConversationState(id);
    if (!ok) return res.status(404).json({ error: 'Conversa não encontrada.' });
    void publishConversationUpdated(id);
    res.json({ success: true, conversationId: id });
  } catch (e) {
    console.error('[WhatsApp] POST reset:', e);
    res.status(500).json({ error: 'Erro ao resetar conversa.' });
  }
});

router.patch('/conversations/:id/classification', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    if (!(await assertCanAccessConversation(req as AuthenticatedRequest, res, id))) return;
    const parsed = updateClassificationSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e: { message: string }) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const { project_id, classification_status, handoff, reserve, lead_temperature, assigned_broker_id } = parsed.data;
    const actor = (req as AuthenticatedRequest).user;
    if (project_id != null && !(await canAccessEnterprise(actor, project_id))) {
      return res.status(403).json({ error: 'Empreendimento fora do seu escopo.', code: 'OUT_OF_SCOPE' });
    }
    if (assigned_broker_id != null && !(await canAccessBroker(actor, assigned_broker_id))) {
      return res.status(403).json({ error: 'Corretor fora do seu escopo.', code: 'OUT_OF_SCOPE' });
    }
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
    if (handoff === false) {
      const clearedFields = {
        handoff: conv.handoff === false,
        classification: conv.classification !== 'Handoff',
        classification_before_handoff: (conv.classification_before_handoff ?? null) === null,
        assigned_broker_id: (conv.assigned_broker_id ?? null) === null,
        assigned_broker_at: (conv.assigned_broker_at ?? null) === null,
        handoff_reason: (conv.handoff_reason ?? null) === null,
        handoff_requested_at: (conv.handoff_requested_at ?? null) === null,
        broker_notified_at: (conv.broker_notified_at ?? null) === null,
        broker_notification_status: (conv.broker_notification_status ?? null) === null,
        broker_notification_error: (conv.broker_notification_error ?? null) === null,
        broker_notification_template: (conv.broker_notification_template ?? null) === null,
        broker_push_notified_at: (conv.broker_push_notified_at ?? null) === null,
        broker_push_notification_status: (conv.broker_push_notification_status ?? null) === null,
        broker_push_notification_error: (conv.broker_push_notification_error ?? null) === null,
        handoff_deferred_until: (conv.handoff_deferred_until ?? null) === null,
        handoff_deferred_broker_id: (conv.handoff_deferred_broker_id ?? null) === null,
        manual_closed_at: (conv.manual_closed_at ?? null) === null,
        manual_closed_by_user_id: (conv.manual_closed_by_user_id ?? null) === null,
        manual_closed_reason: (conv.manual_closed_reason ?? null) === null,
      };
      console.log('handoff_state_cleared_by_operator', {
        conversationId: id,
        from: {
          handoff: convBefore?.handoff ?? null,
          classification: convBefore?.classification ?? null,
        },
        to: {
          handoff: conv.handoff ?? false,
          classification: conv.classification ?? 'Novo',
        },
        clearedFields,
      });
      console.log('manual_ana_mode_restored', {
        conversationId: id,
        handoff: conv.handoff ?? false,
        classification: conv.classification ?? 'Novo',
      });
    }
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
    const isHandoff = conv.handoff === true || conv.classification === 'Handoff';
    res.json({
      id: conv.id,
      projectId: conv.enterprise_id ?? null,
      projectName,
      enterpriseId: conv.enterprise_id ?? null,
      enterpriseName: projectName,
      enterpriseOriginId: conv.enterprise_origin_id ?? null,
      enterpriseOriginName: originName,
      leadSourceRaw: conv.lead_source_raw ?? null,
      classificationStatus: isHandoff ? 'Handoff' : (conv.classification ?? 'Novo'),
      leadStage: tempToStage(conv.lead_temperature),
      handoff: isHandoff,
      attendanceMode: isHandoff ? 'handoff' : 'ana',
      assignedBrokerId: isHandoff ? (conv.assigned_broker_id ?? null) : null,
      assignedBrokerName: isHandoff ? (brokerRow?.full_name ?? null) : null,
      brokerNotificationStatus: isHandoff ? (conv.broker_notification_status ?? null) : null,
      brokerPushNotificationStatus: isHandoff ? (conv.broker_push_notification_status ?? null) : null,
      ...conversationReserveToPublic(conv),
    });
    void publishConversationUpdated(conv.id);
  } catch (e) {
    console.error('[WhatsApp] PATCH classification:', e);
    res.status(500).json({ error: 'Erro ao atualizar.' });
  }
});

router.post('/conversations/:id/ana-retry', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    if (!(await assertCanAccessConversation(req as AuthenticatedRequest, res, id))) return;
    const conv = await getConversationById(id);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    const lastInbound = await getLastUserMessageRow(id);
    await scheduleAnaRetry({
      conversationId: id,
      triggerMessageId: lastInbound?.id ?? null,
      error: { message: 'manual_retry' },
      reasonOverride: 'manual_retry',
    });
    return res.json({ success: true, conversationId: id, scheduled: true });
  } catch (e) {
    console.error('[WhatsApp] POST ana-retry:', e);
    return res.status(500).json({ error: 'Erro ao agendar retry da Ana.' });
  }
});

router.patch('/conversations/:id/type', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    if (!(await assertCanAccessConversation(req as AuthenticatedRequest, res, id))) return;
    const parsed = updateConversationTypeSchema.safeParse(req.body);
    if (!parsed.success) {
      const msg = parsed.error.issues.map((e: { message: string }) => e.message).join('; ') || 'Dados inválidos.';
      return res.status(400).json({ error: msg });
    }
    const convBefore = await getConversationById(id);
    if (!convBefore) return res.status(404).json({ error: 'Conversa não encontrada.' });

    const newConversationType = parsed.data.conversationType === 'INTERNAL' ? 'ADMIN' : 'CLIENT';
    const previousType = String(convBefore.conversation_type ?? 'CLIENT').toUpperCase();
    await updateConversationType(id, newConversationType);
    if (convBefore.contact_id != null) {
      await updateContactType(convBefore.contact_id, parsed.data.conversationType === 'INTERNAL' ? 'INTERNO' : 'CLIENT');
    }

    console.log('[MANUAL_CONVERSATION_TYPE_CHANGED]', {
      conversationId: id,
      previousType,
      newType: newConversationType,
    });

    const row = await getConversationWithPreviewById(id);
    if (!row) return res.status(404).json({ error: 'Conversa não encontrada.' });
    void publishConversationUpdated(id);
    return res.json(mapConversationWithPreviewRow(row));
  } catch (e) {
    console.error('[WhatsApp] PATCH conversation type:', e);
    return res.status(500).json({ error: 'Erro ao atualizar tipo da conversa.' });
  }
});

router.post('/conversations/:id/send', conditionalManualFileUpload, async (req, res) => {
  try {
    const idParam = req.params['id'];
    const id = parseInt(Array.isArray(idParam) ? idParam[0]! : String(idParam), 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    if (!(await assertCanAccessConversation(req as AuthenticatedRequest, res, id))) return;
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
      const linkedContact = conv.contact_id != null ? await findContactById(conv.contact_id) : null;
      const resolvedTemplateCustomerName = resolveSafeDisplayName({
        conversationCustomerName: conv.customer_name ?? null,
        whatsappDisplayName: conv.whatsapp_display_name ?? null,
        contactFullName: linkedContact?.full_name ?? null,
        contactFirstName: linkedContact?.first_name ?? null,
        phone: conv.contact_phone ?? conv.external_contact_id,
        fallbackLabel: 'Cliente',
      });
      const result = await sendTemplateMessage(to, templateKey, {
        customerName: resolvedTemplateCustomerName,
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
          error: manualAttachmentRejectionMessage(safeName, file.mimetype, file.size),
        });
      }
      const tempPath = join(tmpdir(), `wa-manual-${randomBytes(16).toString('hex')}-${safeName}`);
      await writeFile(tempPath, file.buffer);
      try {
        const mediaRes = await sendLocalMediaToWhatsApp(to, tempPath, safeName, resolvedMime, {
          caption: message.length > 0 ? message : null,
        });
        if (mediaRes.success && mediaRes.metaMessageId) {
          const mk =
            mediaRes.messageKind === 'image' ? 'image' : mediaRes.messageKind === 'video' ? 'video' : 'document';
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
  let step = 'start';
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    console.log('[WHATSAPP_GET_MESSAGES_START]', { conversationId: id });
    step = 'assert_access';
    if (!(await assertCanAccessConversation(req as AuthenticatedRequest, res, id))) return;
    step = 'load_conversation';
    const conv = await getConversationById(id);
    console.log('[WHATSAPP_GET_MESSAGES_CONVERSATION_LOADED]', {
      conversationId: id,
      found: conv != null,
    });
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });
    step = 'load_messages';
    const rows = await getMessagesByConversationId(id);
    console.log('[WHATSAPP_GET_MESSAGES_MESSAGES_LOADED]', {
      conversationId: id,
      count: rows.length,
    });
    step = 'load_window';
    const window = await getConversationWhatsAppWindowStatus(id);
    console.log('[WHATSAPP_GET_MESSAGES_WINDOW_LOADED]', {
      conversationId: id,
      isOpen: window.isOpen,
      reason: window.reason,
    });
    res.json({
      conversationId: id,
      window,
      messages: rows.map((m) => {
        const kind = (m.message_kind as string | undefined) || 'text';
        const hasAtt = kind === 'document' || kind === 'image' || kind === 'video';
        const isDeleted = m.deleted_at != null;
        return {
          id: String(m.id),
          conversationId: id,
          direction: m.role === 'user' ? 'inbound' : 'outbound',
          type: hasAtt && !isDeleted ? kind : 'text',
          // Mensagens apagadas não expõem conteúdo nem anexo
          content: isDeleted ? null : m.content,
          status: 'sent',
          externalMessageId: m.meta_message_id,
          createdAt: m.created_at.toISOString(),
          attachment: hasAtt && !isDeleted ? m.attachment_json : null,
          deleted: isDeleted,
          deletedAt: m.deleted_at ? m.deleted_at.toISOString() : null,
          deleteScope: m.delete_scope ?? null,
        };
      }),
    });
  } catch (e) {
    const id = parseInt(req.params.id, 10);
    console.error('[WHATSAPP_GET_MESSAGES_FAILED]', {
      conversationId: Number.isNaN(id) ? null : id,
      step,
      error: e instanceof Error ? e.message : String(e),
      stack: e instanceof Error ? e.stack : null,
    });
    res.status(500).json({ error: 'Erro ao listar mensagens.' });
  }
});

/** Encerrar conversa manualmente — bloqueia reengajamento automático. */
router.patch('/conversations/:id/close', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const idRaw = authReq.params['id'];
    const id = parseInt(Array.isArray(idRaw) ? idRaw[0]! : String(idRaw), 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    if (!(await assertCanAccessConversation(authReq, res, id))) return;
    const reason = typeof authReq.body?.reason === 'string' ? authReq.body.reason.trim().slice(0, 500) : null;
    const updated = await closeConversationManual(id, authReq.user.id, reason || null);
    if (!updated) {
      res.status(404).json({ error: 'Conversa não encontrada ou já encerrada.' });
      return;
    }
    console.log('[CONVERSATION_CLOSE]', { conversationId: id, userId: authReq.user.id });
    void publishConversationUpdated(id);
    res.json({
      success: true,
      conversationId: id,
      manualClosedAt: updated.manual_closed_at?.toISOString() ?? null,
    });
  } catch (e) {
    console.error('[WhatsApp] PATCH close:', e);
    res.status(500).json({ error: 'Erro ao encerrar conversa.' });
  }
});

/** Reabrir conversa encerrada manualmente. */
router.patch('/conversations/:id/reopen', async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const idRaw = authReq.params['id'];
    const id = parseInt(Array.isArray(idRaw) ? idRaw[0]! : String(idRaw), 10);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'ID inválido.' });
      return;
    }
    if (!(await assertCanAccessConversation(authReq, res, id))) return;
    const updated = await reopenConversationManual(id);
    if (!updated) {
      res.status(404).json({ error: 'Conversa não encontrada ou não estava encerrada.' });
      return;
    }
    console.log('[CONVERSATION_REOPEN]', { conversationId: id, userId: authReq.user.id });
    void publishConversationUpdated(id);
    res.json({
      success: true,
      conversationId: id,
      manualClosedAt: null,
    });
  } catch (e) {
    console.error('[WhatsApp] PATCH reopen:', e);
    res.status(500).json({ error: 'Erro ao reabrir conversa.' });
  }
});

// PATCH /conversations/:id/customer-name — edição manual do nome do contato pelo operador
router.patch('/conversations/:id/customer-name', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    if (!(await assertCanAccessConversation(req as AuthenticatedRequest, res, id))) return;
    const conv = await getConversationById(id);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });

    const raw = req.body?.name;
    // Aceita string (novo nome) ou null/undefined (limpar nome)
    if (raw !== undefined && raw !== null && typeof raw !== 'string') {
      return res.status(400).json({ error: 'Campo "name" deve ser string ou null.' });
    }
    const name: string | null = typeof raw === 'string' ? raw.trim().slice(0, 80) || null : null;

    await setConversationCustomerName(id, name);
    void publishConversationUpdated(id);
    return res.json({ success: true, conversationId: id, customerName: name });
  } catch (e) {
    console.error('[WhatsApp] PATCH customer-name:', e);
    return res.status(500).json({ error: 'Erro ao atualizar nome do contato.' });
  }
});

// DELETE /conversations/:convId/messages/:msgId — soft delete interno (não apaga no WhatsApp)
router.delete('/conversations/:convId/messages/:msgId', async (req, res) => {
  try {
    const convId = parseInt(req.params.convId, 10);
    const msgId = parseInt(req.params.msgId, 10);
    if (!Number.isNaN(convId) && !(await assertCanAccessConversation(req as AuthenticatedRequest, res, convId))) return;
    if (Number.isNaN(convId) || Number.isNaN(msgId)) {
      return res.status(400).json({ error: 'IDs inválidos.' });
    }
    const conv = await getConversationById(convId);
    if (!conv) return res.status(404).json({ error: 'Conversa não encontrada.' });

    const userId = (req as Request & { user?: { id: number } }).user?.id ?? 0;
    const deleted = await softDeleteMessage(msgId, convId, userId);
    if (!deleted) {
      return res.status(404).json({ error: 'Mensagem não encontrada ou já apagada.' });
    }
    return res.json({ success: true, messageId: String(msgId) });
  } catch (e) {
    console.error('[WhatsApp] DELETE message:', e);
    return res.status(500).json({ error: 'Erro ao apagar mensagem.' });
  }
});

export default router;

