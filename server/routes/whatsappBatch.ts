import { Router } from 'express';
import multer from 'multer';
import {
  buildBatchPreview,
  sendBatchTemplate,
  sendBatchTemplateTest,
  buildBatchSuggestions,
} from '../services/whatsappBatchTemplateService.js';
import { parseSpreadsheet } from '../services/spreadsheetParseService.js';
import { listWhatsAppTemplatesCatalog } from '../catalogs/whatsappTemplates.js';
import { BatchMappingDtoSchema, BatchSpreadsheetOperationSchema } from '../validators/whatsappBatch.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

router.get('/templates', (_req, res) => {
  const templates = listWhatsAppTemplatesCatalog();
  console.log('[WHATSAPP_BATCH_TEMPLATES]', { count: templates.length, keys: templates.map((t) => t.key) });
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({ templates });
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

    const { spreadsheet, mapping } = bodyResult.data;
    const result = await sendBatchTemplate({
      rows: spreadsheet.rows,
      mapping,
    });

    res.json(result);
  } catch (e) {
    console.error('[WHATSAPP_BATCH_SEND_ERROR]', e);
    res.status(500).json({ error: 'Erro ao enviar batch' });
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
      return res.status(400).json({ error: 'Spreadsheet inv?lida para envio de teste.' });
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
