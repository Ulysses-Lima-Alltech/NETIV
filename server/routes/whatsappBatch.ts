import { Router } from 'express';
import multer from 'multer';
import {
  buildBatchPreview,
  sendBatchTemplate,
  sendBatchTemplateTest,
  buildBatchSuggestions,
} from '../services/whatsappBatchTemplateService.js';
import { parseSpreadsheet } from '../services/spreadsheetParseService.js';
import { listBatchTemplatesFromMetaOrFallback } from '../services/whatsappTemplateCatalogSyncService.js';
import { BatchMappingDtoSchema, BatchSpreadsheetOperationSchema } from '../validators/whatsappBatch.js';
import { uploadWhatsAppMedia } from '../services/whatsappMetaService.js';
import {
  clearHeaderMedia,
  getMediaSetting,
  upsertHeaderImageUpload,
} from '../repositories/whatsappTemplateMediaSettingsRepository.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });
const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});
const ALLOWED_IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);

router.get('/templates', async (req, res) => {
  try {
    const forceRefresh = String(req.query.refresh ?? '') === '1';
    const { templates, fallbackUsed } = await listBatchTemplatesFromMetaOrFallback({ forceRefresh });
    console.log('[WHATSAPP_BATCH_TEMPLATES]', { count: templates.length, keys: templates.map((t) => t.key) });
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.json({
      templates,
      warning: fallbackUsed ? 'Não foi possível sincronizar com a Meta. Exibindo catálogo local.' : null,
      source: fallbackUsed ? 'local_fallback' : 'meta_sync',
    });
  } catch (e) {
    console.error('[WHATSAPP_BATCH_TEMPLATES_ERROR]', e);
    res.status(500).json({ error: 'Erro ao listar templates do WhatsApp.' });
  }
});

router.post('/templates/:templateName/header-image', imageUpload.single('file'), async (req, res) => {
  try {
    const templateName = String(req.params.templateName ?? '').trim();
    if (!templateName) {
      return res.status(400).json({ error: 'Template inválido.' });
    }
    const language = String(req.body?.language ?? 'pt_BR').trim() || 'pt_BR';
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo de imagem é obrigatório.' });
    }
    if (!ALLOWED_IMAGE_MIME_TYPES.has(req.file.mimetype)) {
      return res.status(400).json({ error: 'Formato inválido. Use PNG, JPG, JPEG ou WEBP.' });
    }
    if (req.file.size > 5 * 1024 * 1024) {
      return res.status(400).json({ error: 'Imagem excede 5MB.' });
    }

    const uploadResult = await uploadWhatsAppMedia({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype === 'image/jpg' ? 'image/jpeg' : req.file.mimetype,
    });
    if (!uploadResult.success || !uploadResult.mediaId) {
      return res.status(uploadResult.httpStatus ?? 502).json({
        error: uploadResult.error ?? 'Falha no upload da imagem para Meta.',
        metaErrorCode: uploadResult.metaErrorCode,
        metaErrorType: uploadResult.metaErrorType,
      });
    }

    await upsertHeaderImageUpload({
      templateName,
      language,
      fileBytes: req.file.buffer,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      headerMediaId: uploadResult.mediaId,
    });
    await listBatchTemplatesFromMetaOrFallback({ forceRefresh: true });

    return res.json({
      success: true,
      templateName,
      language,
      headerMediaId: uploadResult.mediaId,
      filename: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
    });
  } catch (e) {
    console.error('[WHATSAPP_BATCH_HEADER_IMAGE_UPLOAD_ERROR]', e);
    return res.status(500).json({ error: 'Erro ao anexar imagem do cabeçalho.' });
  }
});

router.delete('/templates/:templateName/header-image', async (req, res) => {
  try {
    const templateName = String(req.params.templateName ?? '').trim();
    if (!templateName) return res.status(400).json({ error: 'Template inválido.' });
    const language = String(req.query.language ?? 'pt_BR').trim() || 'pt_BR';
    await clearHeaderMedia(templateName, language);
    await listBatchTemplatesFromMetaOrFallback({ forceRefresh: true });
    const setting = await getMediaSetting(templateName, language);
    return res.json({
      success: true,
      templateName,
      language,
      hasConfiguredHeaderMedia: Boolean(setting?.headerMediaId || setting?.headerImageUrl),
    });
  } catch (e) {
    console.error('[WHATSAPP_BATCH_HEADER_IMAGE_DELETE_ERROR]', e);
    return res.status(500).json({ error: 'Erro ao remover imagem do cabeçalho.' });
  }
});

router.post('/suggestions', (req, res) => {
  const { headers } = req.body;
  if (!Array.isArray(headers)) {
    return res.status(400).json({ error: 'Headers devem ser um array' });
  }
  const suggestions = buildBatchSuggestions(headers);
  res.json({ suggestions });
});

/**
 * Upload multipart: apenas leitura da planilha + sugestões de colunas (sem mapping completo).
 */
router.post('/parse', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo é obrigatório' });
    }

    const spreadsheet = parseSpreadsheet(req.file.buffer, req.file.originalname, req.file.mimetype);
    const rawSuggestions = buildBatchSuggestions(spreadsheet.headers);
    const suggestions = {
      phoneColumn: rawSuggestions.phone[0] ?? '',
      ...(rawSuggestions.name[0] ? { customerNameColumn: rawSuggestions.name[0] } : {}),
      ...(rawSuggestions.enterprise[0] ? { enterpriseColumn: rawSuggestions.enterprise[0] } : {}),
    };

    res.json({
      spreadsheet: {
        headers: spreadsheet.headers,
        rowCount: spreadsheet.rowCount,
        sampleRows: spreadsheet.sampleRows,
        rows: spreadsheet.rows,
      },
      suggestions,
    });
  } catch (e) {
    console.error('[WHATSAPP_BATCH_PARSE_ERROR]', e);
    res.status(500).json({ error: 'Erro ao ler planilha' });
  }
});

/**
 * JSON: planilha já parseada (inclui rows) + mapping — gera preview sem reenviar o arquivo.
 */
router.post('/preview', async (req, res) => {
  try {
    const bodyResult = BatchSpreadsheetOperationSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({ error: 'Payload inválido', details: bodyResult.error.issues });
    }

    const { spreadsheet, mapping } = bodyResult.data;
    const preview = await buildBatchPreview({
      rows: spreadsheet.rows,
      mapping,
    });

    res.json(preview);
  } catch (e) {
    console.error('[WHATSAPP_BATCH_PREVIEW_ERROR]', e);
    res.status(500).json({ error: 'Erro ao processar preview' });
  }
});

router.post('/send', async (req, res) => {
  try {
    const bodyResult = BatchSpreadsheetOperationSchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).json({ error: 'Payload inválido', details: bodyResult.error.issues });
    }

    console.log('[WHATSAPP_BATCH_SEND_MODE]', {
      sendMode: bodyResult.data.sendMode,
      scheduledAt: bodyResult.data.scheduledAt ?? null,
    });

    const { spreadsheet, mapping } = bodyResult.data;
    const result = await sendBatchTemplate({
      rows: spreadsheet.rows,
      mapping,
      conversationType: bodyResult.data.conversationType,
      postSendMode: bodyResult.data.postSendMode,
      sendMode: bodyResult.data.sendMode,
      scheduledAt: bodyResult.data.scheduledAt ?? null,
      createdByUserId: (req as AuthenticatedRequest).user?.id ?? null,
    });

    res.json(result);
  } catch (e) {
    console.error('[WHATSAPP_BATCH_SEND_ERROR]', e);
    res.status(500).json({ error: 'Erro ao enviar batch' });
  }
});

router.post('/schedule', async (req, res) => {
  try {
    const bodyResult = BatchSpreadsheetOperationSchema.safeParse({
      ...req.body,
      sendMode: 'SCHEDULED',
    });
    if (!bodyResult.success) {
      return res.status(400).json({ error: 'Payload inválido', details: bodyResult.error.issues });
    }

    console.log('[WHATSAPP_BATCH_SEND_MODE]', {
      sendMode: 'SCHEDULED',
      scheduledAt: bodyResult.data.scheduledAt ?? null,
    });

    const { spreadsheet, mapping } = bodyResult.data;
    const result = await sendBatchTemplate({
      rows: spreadsheet.rows,
      mapping,
      conversationType: bodyResult.data.conversationType,
      postSendMode: bodyResult.data.postSendMode,
      sendMode: 'SCHEDULED',
      scheduledAt: bodyResult.data.scheduledAt ?? null,
      createdByUserId: (req as AuthenticatedRequest).user?.id ?? null,
    });
    res.json(result);
  } catch (e) {
    console.error('[WHATSAPP_BATCH_SCHEDULE_ERROR]', e);
    res.status(500).json({ error: 'Erro ao agendar batch' });
  }
});

router.post('/test', async (req, res) => {
  try {
    const { spreadsheet, mapping, testPhone, mode, sampleRowIndex, manualVariables } = req.body;

    const mappingResult = BatchMappingDtoSchema.safeParse(mapping);
    if (!mappingResult.success) {
      return res.status(400).json({ error: 'Mapping inválido', details: mappingResult.error.issues });
    }

    if (!testPhone || typeof testPhone !== 'string') {
      return res.status(400).json({ error: 'Telefone de teste é obrigatório' });
    }

    if (!['row', 'manual'].includes(mode)) {
      return res.status(400).json({ error: 'Mode deve ser "row" ou "manual"' });
    }

    if (mode === 'row' && (sampleRowIndex == null || typeof sampleRowIndex !== 'number')) {
      return res.status(400).json({ error: 'sampleRowIndex é obrigatório para modo "row"' });
    }

    if (mode === 'manual' && !manualVariables) {
      return res.status(400).json({ error: 'manualVariables é obrigatório para modo "manual"' });
    }

    const spreadsheetRows = Array.isArray(spreadsheet?.rows) ? spreadsheet.rows : null;
    if (!spreadsheetRows) {
      return res.status(400).json({ error: 'Spreadsheet inválida para envio de teste.' });
    }

    const result = await sendBatchTemplateTest({
      rows: spreadsheetRows,
      mapping: mappingResult.data,
      testPhone,
      mode,
      sampleRowIndex,
      manualVariables,
    });

    res.json(result);
  } catch (e) {
    console.error('[WHATSAPP_BATCH_TEST_ERROR]', e);
    res.status(500).json({ error: 'Erro ao enviar teste' });
  }
});

export default router;
