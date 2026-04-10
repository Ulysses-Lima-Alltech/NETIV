import { Router } from 'express';
import multer from 'multer';
import {
  buildBatchPreview,
  sendBatchTemplate,
  sendBatchTemplateTest,
  buildBatchSuggestions,
} from '../services/whatsappBatchTemplateService.js';
import { parseSpreadsheet } from '../services/spreadsheetParseService.js';
import { BatchMappingDtoSchema } from '../validators/whatsappBatch.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

/** GET /templates está em `routes/index.ts` (mock, antes do auth). Este router cobre preview/send/test. */

router.post('/suggestions', (req, res) => {
  const { headers } = req.body;
  if (!Array.isArray(headers)) {
    return res.status(400).json({ error: 'Headers devem ser um array' });
  }
  const suggestions = buildBatchSuggestions(headers);
  res.json({ suggestions });
});

router.post('/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo é obrigatório' });
    }

    const mappingResult = BatchMappingDtoSchema.safeParse(req.body);
    if (!mappingResult.success) {
      return res.status(400).json({ error: 'Mapping inválido', details: mappingResult.error.issues });
    }

    const spreadsheet = parseSpreadsheet(req.file.buffer, req.file.originalname, req.file.mimetype);
    const preview = await buildBatchPreview({
      rows: spreadsheet.rows,
      mapping: mappingResult.data,
    });

    res.json({
      spreadsheet: {
        headers: spreadsheet.headers,
        rowCount: spreadsheet.rowCount,
        sampleRows: spreadsheet.sampleRows,
      },
      preview,
    });
  } catch (e) {
    console.error('[WHATSAPP_BATCH_PREVIEW_ERROR]', e);
    res.status(500).json({ error: 'Erro ao processar preview' });
  }
});

router.post('/send', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'Arquivo é obrigatório' });
    }

    const mappingResult = BatchMappingDtoSchema.safeParse(req.body);
    if (!mappingResult.success) {
      return res.status(400).json({ error: 'Mapping inválido', details: mappingResult.error.issues });
    }

    const spreadsheet = parseSpreadsheet(req.file.buffer, req.file.originalname, req.file.mimetype);
    const result = await sendBatchTemplate({
      rows: spreadsheet.rows,
      mapping: mappingResult.data,
    });

    res.json(result);
  } catch (e) {
    console.error('[WHATSAPP_BATCH_SEND_ERROR]', e);
    res.status(500).json({ error: 'Erro ao enviar batch' });
  }
});

router.post('/test', async (req, res) => {
  try {
    const { mapping, testPhone, mode, sampleRowIndex, manualVariables } = req.body;

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

    const result = await sendBatchTemplateTest({
      rows: [], // Empty for test mode
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
