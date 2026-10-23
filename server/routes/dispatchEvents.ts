import { createHash } from 'node:crypto';
import { Router } from 'express';
import multer from 'multer';
import { query } from '../db/pg.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { getEnterpriseById } from '../repositories/enterpriseRepository.js';
import {
  buildBatchPreview,
  DispatchEventConflictError,
  DispatchEventValidationError,
  sendBatchTemplate,
} from '../services/whatsappBatchTemplateService.js';
import { listBatchTemplatesFromMetaOrFallback } from '../services/whatsappTemplateCatalogSyncService.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import { DispatchEventSchema } from '../validators/dispatchEvents.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1, fieldSize: 2 * 1024 * 1024 },
});

function isSupportedImage(file: Express.Multer.File): boolean {
  const bytes = file.buffer;
  if (file.mimetype === 'image/jpeg') {
    return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  return file.mimetype === 'image/png'
    && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}

const eventSelect = `
  SELECT b.id::text AS id, b.event_name AS name,
         b.enterprise_id AS "enterpriseId", e.name AS "enterpriseName",
         b.template_key AS "templateKey", b.status,
         b.event_send_mode AS "sendMode", b.post_send_mode AS "postSendMode",
         b.scheduled_at AS "scheduledAt", b.created_at AS "createdAt",
         b.error_message AS error,
         (SELECT COUNT(*)::int FROM whatsapp_batch_scheduled_send_recipients r
          WHERE r.batch_id = b.id) AS total,
         (SELECT COUNT(*)::int FROM whatsapp_batch_scheduled_send_recipients r
          WHERE r.batch_id = b.id AND r.status = 'SENT') AS accepted,
         (SELECT COUNT(*)::int FROM whatsapp_batch_scheduled_send_recipients r
          WHERE r.batch_id = b.id AND r.status IN ('FAILED', 'CANCELED')) AS failed
  FROM whatsapp_batch_scheduled_sends b
  LEFT JOIN enterprises e ON e.id = b.enterprise_id
`;

router.get('/', async (_req, res) => {
  try {
    const result = await query(
      `${eventSelect}
       WHERE b.event_name IS NOT NULL
       ORDER BY b.scheduled_at DESC, b.id DESC
       LIMIT 200`
    );
    return res.json({ events: result.rows });
  } catch (error) {
    console.error('[DISPATCH_EVENTS_LIST]', error);
    return res.status(500).json({ error: 'Não foi possível carregar os eventos.' });
  }
});

router.get('/:id/art', async (req, res) => {
  if (!/^[1-9]\d*$/.test(req.params.id)) {
    return res.status(400).json({ error: 'Evento inválido.' });
  }
  try {
    const result = await query<{ event_art_bytes: Buffer; event_art_mime_type: string }>(
      `SELECT event_art_bytes, event_art_mime_type
       FROM whatsapp_batch_scheduled_sends
       WHERE id = $1 AND event_name IS NOT NULL`,
      [req.params.id]
    );
    const art = result.rows[0];
    if (!art?.event_art_bytes) return res.status(404).json({ error: 'Arte não encontrada.' });
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return res.type(art.event_art_mime_type).send(art.event_art_bytes);
  } catch (error) {
    console.error('[DISPATCH_EVENT_ART]', error);
    return res.status(500).json({ error: 'Não foi possível carregar a arte.' });
  }
});

router.post('/', (req, res) => {
  upload.single('art')(req, res, async (uploadError: unknown) => {
    if (uploadError) {
      return res.status(400).json({ error: 'Use uma imagem JPG/PNG de até 5 MB.' });
    }
    let raw: unknown;
    try {
      raw = JSON.parse(String(req.body?.payload ?? ''));
    } catch {
      return res.status(400).json({ error: 'Dados do evento inválidos.' });
    }
    const parsed = DispatchEventSchema.safeParse(raw);
    if (!parsed.success) {
      return res.status(400).json({
        error: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      });
    }
    if (!req.file || !isSupportedImage(req.file)) {
      return res.status(400).json({ error: 'Envie uma arte JPG ou PNG válida, de até 5 MB.' });
    }

    const input = parsed.data;
    const image = req.file;
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(input))
      .update(image.mimetype)
      .update(image.buffer)
      .digest('hex');

    try {
      const replay = await query<{ id: string; event_fingerprint: string }>(
        `SELECT id::text AS id, event_fingerprint
         FROM whatsapp_batch_scheduled_sends WHERE event_request_id = $1`,
        [input.requestId]
      );
      const existing = replay.rows[0];
      if (existing && existing.event_fingerprint !== fingerprint) {
        return res.status(409).json({ error: 'Esta chave já foi usada com outros dados. Inicie um novo evento.' });
      }

      let batchId: string;
      if (existing) {
        batchId = existing.id;
      } else {
        if (input.sendMode === 'SCHEDULED'
          && (!input.scheduledAt || Date.parse(input.scheduledAt) <= Date.now())) {
          return res.status(400).json({ error: 'Escolha uma data e hora futuras.' });
        }

        const enterprise = await getEnterpriseById(input.mapping.selectedEnterpriseId);
        if (!enterprise || enterprise.status !== 'ativo') {
          return res.status(400).json({ error: 'Selecione um empreendimento ativo.' });
        }

        const phones = input.rows.map((row) => normalizePhoneE164(row.TELEFONE));
        if (phones.some((phone) => !phone) || new Set(phones).size !== phones.length) {
          return res.status(400).json({ error: 'Há telefone inválido ou duplicado na planilha.' });
        }

        const catalog = await listBatchTemplatesFromMetaOrFallback({ forceRefresh: true });
        const template = catalog.templates.find((item) => item.key === input.mapping.templateKey);
        if (catalog.fallbackUsed || !template || String(template.status).toUpperCase() !== 'APPROVED') {
          return res.status(400).json({ error: 'Atualize os templates e selecione um aprovado na Meta.' });
        }
        if (template.hasHeaderVideo || template.hasHeaderDocument) {
          return res.status(400).json({ error: 'Selecione um template de texto ou de imagem.' });
        }
        if (template.requiresHeaderMedia && !template.hasHeaderImage) {
          return res.status(400).json({ error: 'O cabeçalho deste template não é compatível com imagem.' });
        }
        const unsupportedComponents = (template.components ?? []).some((component) => {
          const type = String(component.type).toUpperCase();
          return (type === 'HEADER'
            && String(component.format).toUpperCase() === 'TEXT'
            && /\{\{/.test(String(component.text ?? '')))
            || (type === 'BUTTONS' && JSON.stringify(component).includes('{{'));
        });
        if (unsupportedComponents) {
          return res.status(400).json({ error: 'Este template contém variáveis de cabeçalho/botão não suportadas.' });
        }

        const body = template.messageBodyTemplate ?? '';
        const placeholders = [...body.matchAll(/\{\{([^{}]+)\}\}/g)].map((match) => match[1].trim());
        const hasNamedParameters = placeholders.some((value) => !/^[1-9]\d*$/.test(value));
        const ids = [...new Set(placeholders.map(Number))].sort((a, b) => a - b);
        const variableIds = template.variables.map((variable) => variable.id).sort((a, b) => a - b);
        if (hasNamedParameters || (body && JSON.stringify(ids) !== JSON.stringify(variableIds))) {
          return res.status(400).json({ error: 'Este template usa parâmetros ainda não suportados.' });
        }

        const preview = await buildBatchPreview({
          rows: input.rows,
          mapping: input.mapping,
          hasEventArt: true,
        });
        if (preview.validCount !== input.rows.length) {
          const problems = preview.rows.filter((row) => !row.isValid);
          return res.status(400).json({
            error: problems.slice(0, 5)
              .map((row) => `Linha ${row.rowNumber}: ${row.error ?? 'Revise as variáveis.'}`)
              .join('; '),
          });
        }

        const result = await sendBatchTemplate({
          rows: input.rows,
          mapping: input.mapping,
          conversationType: 'CLIENT',
          postSendMode: input.postSendMode,
          sendMode: input.sendMode,
          scheduledAt: input.scheduledAt ?? null,
          createdByUserId: (req as AuthenticatedRequest).user?.id ?? null,
          dispatchEvent: {
            requestId: input.requestId,
            fingerprint,
            name: input.name,
            sendMode: input.sendMode,
            artBytes: image.buffer,
            artMimeType: image.mimetype,
            artFilename: image.originalname,
          },
        });
        if (!('scheduled' in result)) throw new Error('Evento não foi enfileirado.');
        batchId = String(result.batchId);
      }

      const saved = await query(
        `${eventSelect}
         WHERE b.id = $1 AND b.event_name IS NOT NULL`,
        [batchId]
      );
      return res.status(existing ? 200 : 202).json({ event: saved.rows[0] });
    } catch (error) {
      if (error instanceof DispatchEventConflictError) {
        return res.status(409).json({ error: error.message });
      }
      if (error instanceof DispatchEventValidationError) {
        return res.status(400).json({ error: error.message });
      }
      console.error('[DISPATCH_EVENT_CREATE]', error);
      return res.status(500).json({
        error: 'Não foi possível concluir. Tente novamente sem alterar os dados para verificar se já foi salvo.',
      });
    }
  });
});

export default router;
