import { Router } from 'express';
import multer from 'multer';
import { query } from '../db/pg.js';
import {
  countContacts,
  findContactById,
  listContacts,
  listContactOrigins,
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

/** Express usa o nome do parâmetro `id` em runtime; tipos do pacote podem expor `id(\\d+)`. */
function contactIdParam(req: { params: Record<string, string | undefined> }): string | undefined {
  return req.params.id ?? req.params['id(\\d+)'];
}

function parseOptionalInt(value: unknown): number | undefined {
  if (value == null || value === '') return undefined;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) return undefined;
  const parsed = parseInt(raw, 10);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function parseOptionalBool(value: unknown): boolean | undefined {
  if (value == null || value === '') return undefined;
  const raw = String(value).trim().toLowerCase();
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

function parseDateStart(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const raw = value.trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

function parseDateExclusiveEnd(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined;
  const raw = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const dt = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(dt.getTime())) return undefined;
    dt.setUTCDate(dt.getUTCDate() + 1);
    return dt;
  }
  const dt = new Date(raw);
  return Number.isNaN(dt.getTime()) ? undefined : dt;
}

function parseContactFilters(req: { query: Record<string, unknown> }) {
  const statusRaw = typeof req.query.status === 'string' ? req.query.status : '';
  const status: 'assigned' | 'unassigned' | undefined =
    statusRaw === 'assigned' || statusRaw === 'unassigned' ? statusRaw : undefined;
  const brokerId = parseOptionalInt(req.query.brokerId);
  return {
    search: typeof req.query.search === 'string' ? req.query.search : undefined,
    enterprise: typeof req.query.enterprise === 'string' ? req.query.enterprise : undefined,
    enterpriseId: parseOptionalInt(req.query.enterpriseId),
    ownerUserId: parseOptionalInt(req.query.ownerUserId),
    brokerId,
    status,
    origin: typeof req.query.origin === 'string' ? req.query.origin : undefined,
    createdFrom: parseDateStart(req.query.createdFrom),
    createdTo: parseDateExclusiveEnd(req.query.createdTo),
    lastContactFrom: parseDateStart(req.query.lastContactFrom),
    lastContactTo: parseDateExclusiveEnd(req.query.lastContactTo),
    withoutBroker: parseOptionalBool(req.query.withoutBroker),
    withoutEnterprise: parseOptionalBool(req.query.withoutEnterprise),
  };
}

router.get('/', async (req, res) => {
  try {
    console.debug('[ContactsRoute] GET /contacts query', req.query);
    const filters = parseContactFilters(req as { query: Record<string, unknown> });
    const page = Math.max(parseOptionalInt(req.query.page) ?? 1, 1);
    const pageSize = Math.min(Math.max(parseOptionalInt(req.query.pageSize) ?? parseOptionalInt(req.query.limit) ?? 100, 1), 500);
    const offset = parseOptionalInt(req.query.offset) ?? (page - 1) * pageSize;
    const rows = await listContacts({
      ...filters,
      limit: pageSize,
      offset: Math.max(offset, 0),
    });
    const total = await countContacts(filters);
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
      contacts: rows.map((r) => {
        const displayName = r.enterprise_display_name ?? r.enterprise_interest;
        return {
        id: r.id,
        fullName: r.full_name,
        firstName: r.first_name,
        phoneE164: r.phone_e164,
        phoneDisplay: r.phone_display,
        email: r.email,
        enterpriseId: r.enterprise_id ?? null,
        enterpriseInterest: displayName ?? null,
        notes: r.notes,
        source: r.source,
        ownerUserId: r.owner_user_id,
        ownerName: r.owner_user_id != null ? ownerMap.get(r.owner_user_id) ?? null : null,
        status: r.owner_user_id != null ? 'assigned' : 'unassigned',
        lastContactAt: r.last_contact_at?.toISOString() ?? null,
        createdAt: r.created_at.toISOString(),
        updatedAt: r.updated_at.toISOString(),
      };
      }),
      page,
      pageSize,
      total,
    });
  } catch (e) {
    console.error('[Contacts] GET /', e);
    res.status(500).json({ error: 'Erro ao listar contatos.' });
  }
});

router.get('/export', async (req, res) => {
  try {
    console.debug('[ContactsRoute] GET /contacts/export query', req.query);
    const filters = parseContactFilters(req as { query: Record<string, unknown> });

    // Exporta todos os resultados do filtro (sem paginação visual)
    const allRows: Awaited<ReturnType<typeof listContacts>> = [];
    const pageSize = 500;
    let offset = 0;
    for (;;) {
      const chunk = await listContacts({
        ...filters,
        limit: pageSize,
        offset,
      });
      allRows.push(...chunk);
      if (chunk.length < pageSize) break;
      offset += pageSize;
    }

    const contactIds = allRows.map((r) => r.id);
    const ownerIds = [...new Set(allRows.map((r) => r.owner_user_id).filter((x): x is number => x != null))];

    const ownerMap = new Map<number, string>();
    if (ownerIds.length > 0) {
      const { rows: brokers } = await query<{ id: number; full_name: string }>(
        `SELECT id, full_name FROM corretores WHERE id = ANY($1::int[])`,
        [ownerIds]
      );
      for (const b of brokers) ownerMap.set(b.id, b.full_name);
    }

    const convMetaMap = new Map<number, {
      whatsapp_display_name: string | null;
      lead_temperature: string | null;
      classification: string | null;
      handoff: boolean | null;
    }>();
    const convCountMap = new Map<number, number>();
    const msgMetaMap = new Map<number, {
      last_message: string | null;
      last_user_message: string | null;
      last_assistant_message: string | null;
      last_message_at: Date | null;
      last_user_message_at: Date | null;
      last_assistant_message_at: Date | null;
      message_count: number;
    }>();

    if (contactIds.length > 0) {
      const { rows: convRows } = await query<{
        contact_id: number;
        whatsapp_display_name: string | null;
        lead_temperature: string | null;
        classification: string | null;
        handoff: boolean | null;
      }>(
        `SELECT DISTINCT ON (c.contact_id)
           c.contact_id,
           c.whatsapp_display_name,
           c.lead_temperature,
           c.classification,
           c.handoff
         FROM conversations c
         WHERE c.contact_id = ANY($1::bigint[])
         ORDER BY c.contact_id, c.last_message_at DESC NULLS LAST, c.updated_at DESC, c.id DESC`,
        [contactIds]
      );
      for (const row of convRows) {
        convMetaMap.set(row.contact_id, {
          whatsapp_display_name: row.whatsapp_display_name,
          lead_temperature: row.lead_temperature,
          classification: row.classification,
          handoff: row.handoff,
        });
      }

      const { rows: convCountRows } = await query<{ contact_id: number; qty: string }>(
        `SELECT c.contact_id, COUNT(*)::text AS qty
         FROM conversations c
         WHERE c.contact_id = ANY($1::bigint[])
         GROUP BY c.contact_id`,
        [contactIds]
      );
      for (const row of convCountRows) convCountMap.set(row.contact_id, parseInt(row.qty, 10) || 0);

      const { rows: msgRows } = await query<{
        contact_id: number;
        last_message: string | null;
        last_user_message: string | null;
        last_assistant_message: string | null;
        last_message_at: Date | null;
        last_user_message_at: Date | null;
        last_assistant_message_at: Date | null;
        message_count: string;
      }>(
        `WITH msgs AS (
           SELECT
             conv.contact_id,
             m.id,
             m.role,
             m.content,
             m.created_at
           FROM messages m
           JOIN conversations conv ON conv.id = m.conversation_id
           WHERE conv.contact_id = ANY($1::bigint[])
         ),
         ranked AS (
           SELECT
             contact_id,
             role,
             content,
             created_at,
             ROW_NUMBER() OVER (PARTITION BY contact_id ORDER BY created_at DESC, id DESC) AS rn_all,
             ROW_NUMBER() OVER (PARTITION BY contact_id, role ORDER BY created_at DESC, id DESC) AS rn_role
           FROM msgs
         )
         SELECT
           contact_id,
           MAX(CASE WHEN rn_all = 1 THEN content END) AS last_message,
           MAX(CASE WHEN role = 'user' AND rn_role = 1 THEN content END) AS last_user_message,
           MAX(CASE WHEN role = 'assistant' AND rn_role = 1 THEN content END) AS last_assistant_message,
           MAX(CASE WHEN rn_all = 1 THEN created_at END) AS last_message_at,
           MAX(CASE WHEN role = 'user' AND rn_role = 1 THEN created_at END) AS last_user_message_at,
           MAX(CASE WHEN role = 'assistant' AND rn_role = 1 THEN created_at END) AS last_assistant_message_at,
           COUNT(*)::text AS message_count
         FROM ranked
         GROUP BY contact_id`,
        [contactIds]
      );
      for (const row of msgRows) {
        msgMetaMap.set(row.contact_id, {
          last_message: row.last_message,
          last_user_message: row.last_user_message,
          last_assistant_message: row.last_assistant_message,
          last_message_at: row.last_message_at,
          last_user_message_at: row.last_user_message_at,
          last_assistant_message_at: row.last_assistant_message_at,
          message_count: parseInt(row.message_count, 10) || 0,
        });
      }
    }

    const headers = [
      'id_contato',
      'nome',
      'nome_exibicao_whatsapp',
      'telefone',
      'telefone_e164',
      'empreendimento_interesse',
      'tipo_interesse',
      'temperatura_lead',
      'status_funil',
      'modo_atendimento',
      'corretor_responsavel',
      'origem',
      'cidade',
      'estado',
      'localizacao_livre',
      'idade',
      'estado_civil',
      'tem_filhos',
      'quantidade_filhos',
      'orcamento',
      'forma_pagamento',
      'observacoes',
      'ultima_mensagem',
      'ultima_mensagem_cliente',
      'ultima_mensagem_sistema',
      'data_ultima_mensagem',
      'data_ultima_mensagem_cliente',
      'data_ultima_resposta_ana',
      'data_criacao_contato',
      'data_ultima_interacao',
      'quantidade_conversas',
      'quantidade_mensagens',
    ];

    const escapeCsv = (value: unknown): string => {
      if (value == null) return '';
      const raw = String(value).replace(/\r?\n/g, ' ').trim();
      const escaped = raw.replace(/"/g, '""');
      if (/[;"\n\r]/.test(escaped)) return `"${escaped}"`;
      return escaped;
    };

    const fmtDate = (d: Date | string | null | undefined): string => {
      if (!d) return '';
      const dt = d instanceof Date ? d : new Date(d);
      if (Number.isNaN(dt.getTime())) return '';
      return dt.toISOString();
    };

    const lines: string[] = [];
    lines.push(headers.join(';'));
    for (const r of allRows) {
      const convMeta = convMetaMap.get(r.id);
      const msgMeta = msgMetaMap.get(r.id);
      const displayEnterprise = r.enterprise_display_name ?? r.enterprise_interest ?? '';
      const ownerName = r.owner_user_id != null ? ownerMap.get(r.owner_user_id) ?? '' : '';
      const mode = convMeta?.handoff == null ? '' : convMeta.handoff ? 'handoff' : 'ana';
      const row = [
        r.id,
        r.full_name ?? '',
        convMeta?.whatsapp_display_name ?? '',
        r.phone_display ?? r.phone_e164,
        r.phone_e164,
        displayEnterprise,
        '', // tipo_interesse (não há campo estruturado confiável no módulo contatos)
        convMeta?.lead_temperature ?? '',
        convMeta?.classification ?? '',
        mode,
        ownerName,
        r.source ?? '',
        '', // cidade
        '', // estado
        '', // localizacao_livre
        '', // idade
        '', // estado_civil
        '', // tem_filhos
        '', // quantidade_filhos
        '', // orcamento
        '', // forma_pagamento
        r.notes ?? '',
        msgMeta?.last_message ?? '',
        msgMeta?.last_user_message ?? '',
        msgMeta?.last_assistant_message ?? '',
        fmtDate(msgMeta?.last_message_at),
        fmtDate(msgMeta?.last_user_message_at),
        fmtDate(msgMeta?.last_assistant_message_at),
        fmtDate(r.created_at),
        fmtDate(r.last_contact_at),
        convCountMap.get(r.id) ?? 0,
        msgMeta?.message_count ?? 0,
      ];
      lines.push(row.map(escapeCsv).join(';'));
    }

    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const hh = String(now.getHours()).padStart(2, '0');
    const mi = String(now.getMinutes()).padStart(2, '0');
    const filename = `leads_netiv_${yyyy}-${mm}-${dd}_${hh}-${mi}.csv`;

    const csvWithBom = `\uFEFF${lines.join('\r\n')}`;
    const buffer = Buffer.from(csvWithBom, 'utf8');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(buffer);
  } catch (e) {
    console.error('[Contacts] GET /export', e);
    return res.status(500).json({ error: 'Erro ao exportar contatos em CSV.' });
  }
});

router.get('/filter-options', async (_req, res) => {
  try {
    const origins = await listContactOrigins();
    res.json({ origins });
  } catch (e) {
    console.error('[Contacts] GET /filter-options', e);
    res.status(500).json({ error: 'Erro ao carregar filtros de contatos.' });
  }
});

router.get('/:id(\\d+)', async (req, res) => {
  try {
    const id = parseInt(String(contactIdParam(req)), 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const c = await findContactById(id);
    if (!c) return res.status(404).json({ error: 'Contato não encontrado.' });
    const row = c as typeof c & { enterprise_display_name?: string | null };
    const displayEnterprise = row.enterprise_display_name ?? row.enterprise_interest;
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
      enterpriseId: row.enterprise_id ?? null,
      enterpriseInterest: displayEnterprise ?? null,
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
    const id = parseInt(String(contactIdParam(req)), 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });
    const body = req.body ?? {};
    const patch: Parameters<typeof updateContactAdmin>[1] = {
      fullName: typeof body.fullName === 'string' ? body.fullName : undefined,
      email: typeof body.email === 'string' ? body.email : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      source: typeof body.source === 'string' ? body.source : undefined,
    };
    if ('enterpriseId' in body) {
      const v = body.enterpriseId;
      if (v === null || v === '') patch.enterpriseId = null;
      else if (typeof v === 'number' && Number.isFinite(v)) patch.enterpriseId = Math.round(v);
      else if (typeof v === 'string' && v.trim() !== '') {
        const n = parseInt(v.trim(), 10);
        if (!Number.isNaN(n)) patch.enterpriseId = n;
      }
    } else if (typeof body.enterpriseInterest === 'string') {
      patch.enterpriseInterest = body.enterpriseInterest;
    }
    const c = await updateContactAdmin(id, patch);
    if (!c) return res.status(404).json({ error: 'Contato não encontrado.' });
    res.json({ success: true });
  } catch (e) {
    console.error('[Contacts] PATCH /:id', e);
    res.status(500).json({ error: 'Erro ao atualizar contato.' });
  }
});

router.patch('/:id(\\d+)/owner', async (req, res) => {
  try {
    const id = parseInt(String(contactIdParam(req)), 10);
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
