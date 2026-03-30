import { Router } from 'express';
import multer from 'multer';
import { query } from '../db/pg.js';
import {
  findContactById,
  listContacts,
  setContactOwnerAdmin,
  updateContactAdmin,
} from '../repositories/contactsRepository.js';
import {
  commitImportFromCsv,
  listEligibleContactsByBatch,
  listImportBatches,
  previewImportFromCsv,
} from '../services/contactImportService.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

router.get('/', async (req, res) => {
  try {
    const ownerUserId = req.query.ownerUserId != null ? parseInt(String(req.query.ownerUserId), 10) : undefined;
    const status = req.query.status === 'assigned' || req.query.status === 'unassigned' ? req.query.status : undefined;
    const rows = await listContacts({
      search: typeof req.query.search === 'string' ? req.query.search : undefined,
      enterprise: typeof req.query.enterprise === 'string' ? req.query.enterprise : undefined,
      ownerUserId: ownerUserId != null && !Number.isNaN(ownerUserId) ? ownerUserId : undefined,
      status,
      limit: req.query.limit != null ? parseInt(String(req.query.limit), 10) : 100,
      offset: req.query.offset != null ? parseInt(String(req.query.offset), 10) : 0,
    });
    const ownerIds = [...new Set(rows.map((r) => r.owner_user_id).filter((x): x is number => x != null))];
    const ownerMap = new Map<number, string>();
    if (ownerIds.length > 0) {
      const { rows: brokers } = await query<{ id: number; full_name: string }>(
        `SELECT id, full_name FROM corretores WHERE id = ANY($1::int[])`,
        [ownerIds]
      );
      for (const b of brokers) ownerMap.set(b.id, b.full_name);
    }
    res.json({
      contacts: rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        firstName: r.first_name,
        phoneE164: r.phone_e164,
        phoneDisplay: r.phone_display,
        email: r.email,
        enterpriseInterest: r.enterprise_interest,
        notes: r.notes,
        source: r.source,
        ownerUserId: r.owner_user_id,
        ownerName: r.owner_user_id != null ? ownerMap.get(r.owner_user_id) ?? null : null,
        status: r.owner_user_id != null ? 'assigned' : 'unassigned',
        lastContactAt: r.last_contact_at?.toISOString() ?? null,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      })),
    });
  } catch (e) {
    console.error('[Contacts] GET /', e);
    res.status(500).json({ error: 'Erro ao listar contatos.' });
  }
});

router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params['id(\\d+)'], 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const c = await findContactById(id);
    if (!c) return res.status(404).json({ error: 'Contato não encontrado.' });
    const ownerName =
      c.owner_user_id != null
        ? (await query<{ full_name: string }>(`SELECT full_name FROM corretores WHERE id = $1`, [c.owner_user_id])).rows[0]
            ?.full_name ?? null
        : null;
    res.json({
      id: c.id,
      fullName: c.full_name,
      firstName: c.first_name,
      phoneE164: c.phone_e164,
      phoneDisplay: c.phone_display,
      email: c.email,
      enterpriseInterest: c.enterprise_interest,
      notes: c.notes,
      source: c.source,
      ownerUserId: c.owner_user_id,
      ownerName,
      ownerAssignedAt: c.owner_assigned_at?.toISOString() ?? null,
      ownerAssignmentSource: c.owner_assignment_source,
      lastContactAt: c.last_contact_at?.toISOString() ?? null,
      lastInboundAt: c.last_inbound_at?.toISOString() ?? null,
      lastOutboundAt: c.last_outbound_at?.toISOString() ?? null,
      createdAt: c.created_at.toISOString(),
      updatedAt: c.updated_at.toISOString(),
    });
  } catch (e) {
    console.error('[Contacts] GET /:id', e);
    res.status(500).json({ error: 'Erro ao carregar contato.' });
  }
});

router.patch('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(req.params['id(\\d+)'], 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const c = await updateContactAdmin(id, {
      fullName: typeof req.body?.fullName === 'string' ? req.body.fullName : undefined,
      email: typeof req.body?.email === 'string' ? req.body.email : undefined,
      enterpriseInterest: typeof req.body?.enterpriseInterest === 'string' ? req.body.enterpriseInterest : undefined,
      notes: typeof req.body?.notes === 'string' ? req.body.notes : undefined,
      source: typeof req.body?.source === 'string' ? req.body.source : undefined,
    });
    if (!c) return res.status(404).json({ error: 'Contato não encontrado.' });
    res.json({ success: true });
  } catch (e) {
    console.error('[Contacts] PATCH /:id', e);
    res.status(500).json({ error: 'Erro ao atualizar contato.' });
  }
});

router.patch('/:id(\\d+)/owner', async (req, res) => {
  try {
    const id = parseInt(req.params['id(\\d+)'], 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    if (!req.user?.id) return res.status(401).json({ error: 'Não autenticado.' });
    const ownerUserId =
      req.body?.ownerUserId == null || req.body.ownerUserId === ''
        ? null
        : Number.isFinite(Number(String(req.body.ownerUserId)))
          ? parseInt(String(req.body.ownerUserId), 10)
          : null;
    const row = await setContactOwnerAdmin({
      contactId: id,
      ownerUserId,
      source: ownerUserId == null ? 'admin_unassign' : 'admin_transfer',
      assignedByUserId: req.user.id,
    });
    if (!row) return res.status(404).json({ error: 'Contato não encontrado.' });
    res.json({ success: true });
  } catch (e) {
    console.error('[Contacts] PATCH /:id/owner', e);
    res.status(500).json({ error: 'Erro ao alterar owner.' });
  }
});

router.post('/import/preview', upload.single('file'), async (req, res) => {
  try {
    if (!req.file?.buffer) return res.status(400).json({ error: 'Arquivo CSV é obrigatório.' });
    const ownerUserId = req.body?.ownerUserId != null && req.body.ownerUserId !== '' ? parseInt(String(req.body.ownerUserId), 10) : null;
    const preview = await previewImportFromCsv({ fileBuffer: req.file.buffer, ownerUserId: Number.isNaN(ownerUserId ?? NaN) ? null : ownerUserId });
    res.json(preview);
  } catch (e) {
    console.error('[Contacts] POST /import/preview', e);
    res.status(500).json({ error: 'Erro ao gerar preview.' });
  }
});

router.post('/import/commit', upload.single('file'), async (req, res) => {
  try {
    if (!req.user?.id) return res.status(401).json({ error: 'Não autenticado.' });
    if (!req.file?.buffer) return res.status(400).json({ error: 'Arquivo CSV é obrigatório.' });
    const ownerUserId = req.body?.ownerUserId != null && req.body.ownerUserId !== '' ? parseInt(String(req.body.ownerUserId), 10) : null;
    const result = await commitImportFromCsv({
      fileBuffer: req.file.buffer,
      fileName: req.file.originalname || 'import.csv',
      uploadedByUserId: req.user.id,
      ownerUserId: Number.isNaN(ownerUserId ?? NaN) ? null : ownerUserId,
    });
    res.json(result);
  } catch (e) {
    console.error('[Contacts] POST /import/commit', e);
    res.status(500).json({ error: 'Erro ao confirmar importação.' });
  }
});

router.get('/import/batches', async (req, res) => {
  try {
    const limit = req.query.limit != null ? parseInt(String(req.query.limit), 10) : 50;
    const rows = await listImportBatches(Number.isNaN(limit) ? 50 : limit);
    res.json({ batches: rows });
  } catch (e) {
    console.error('[Contacts] GET /import/batches', e);
    res.status(500).json({ error: 'Erro ao listar lotes.' });
  }
});

router.get('/import/batches/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const { rows: batchRows } = await query(`SELECT * FROM contact_import_batches WHERE id = $1 LIMIT 1`, [id]);
    if (!batchRows[0]) return res.status(404).json({ error: 'Lote não encontrado.' });
    const { rows } = await query(
      `SELECT id, row_number, normalized_phone_e164, contact_id, action, error_message, created_at
       FROM contact_import_rows WHERE batch_id = $1 ORDER BY row_number ASC`,
      [id]
    );
    res.json({ batch: batchRows[0], rows });
  } catch (e) {
    console.error('[Contacts] GET /import/batches/:id', e);
    res.status(500).json({ error: 'Erro ao carregar lote.' });
  }
});

router.get('/import/batches/:id/eligible', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const ownerUserId = parseInt(String(req.query.ownerUserId), 10);
    if (Number.isNaN(id) || Number.isNaN(ownerUserId)) return res.status(400).json({ error: 'Parâmetros inválidos.' });
    const { rows: batch } = await query<{ owner_user_id: number | null }>(
      `SELECT owner_user_id FROM contact_import_batches WHERE id = $1 LIMIT 1`,
      [id]
    );
    if (!batch[0]) return res.status(404).json({ error: 'Lote não encontrado.' });
    if (batch[0].owner_user_id != null && batch[0].owner_user_id !== ownerUserId) {
      return res.status(409).json({
        error: 'Owner da campanha/base não corresponde ao owner do lote.',
        code: 'OWNER_MISMATCH',
      });
    }
    const result = await listEligibleContactsByBatch(id, ownerUserId);
    res.json({
      ownerUserId,
      blockedCount: result.blockedCount,
      contacts: result.eligible.map((c) => ({
        id: c.id,
        fullName: c.full_name,
        phoneE164: c.phone_e164,
        ownerUserId: c.owner_user_id,
      })),
    });
  } catch (e) {
    console.error('[Contacts] GET /import/batches/:id/eligible', e);
    res.status(500).json({ error: 'Erro ao listar elegíveis.' });
  }
});

export default router;
