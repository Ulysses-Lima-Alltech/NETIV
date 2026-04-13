import type pg from 'pg';
import { query } from '../db/pg.js';
import { getActiveEnterpriseById } from './enterpriseRepository.js';
import { toFirstName } from '../utils/phone.js';

export interface ContactRow {
  id: number;
  full_name: string | null;
  first_name: string | null;
  phone_e164: string;
  phone_display: string | null;
  email: string | null;
  enterprise_id: number | null;
  enterprise_interest: string | null;
  notes: string | null;
  source: string;
  owner_user_id: number | null;
  owner_assigned_at: Date | null;
  owner_assignment_source: string | null;
  owner_assigned_by_user_id: number | null;
  last_contact_at: Date | null;
  last_inbound_at: Date | null;
  last_outbound_at: Date | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

type Queryable = { query: <T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]) => Promise<pg.QueryResult<T>> };

function q(db?: Queryable): Queryable {
  return db ?? { query };
}

export async function findContactByPhoneE164(phoneE164: string, db?: Queryable): Promise<ContactRow | null> {
  const { rows } = await q(db).query<ContactRow>(`SELECT * FROM contacts WHERE phone_e164 = $1 LIMIT 1`, [phoneE164]);
  return rows[0] ?? null;
}

export async function findContactById(id: number): Promise<ContactRow | null> {
  const { rows } = await query<ContactRow & { enterprise_display_name?: string | null }>(
    `SELECT c.*, e.name AS enterprise_display_name
     FROM contacts c
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     WHERE c.id = $1
     LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

/**
 * Se o contato ainda não tem enterprise_id, copia da conversa vinculada mais recente (apenas empreendimento ativo).
 * Não sobrescreve contato que já tem empreendimento definido.
 */
export async function trySyncContactEnterpriseFromLinkedConversations(contactId: number): Promise<void> {
  await query(
    `UPDATE contacts c
     SET enterprise_id = pick.enterprise_id,
         enterprise_interest = e.name,
         updated_at = NOW()
     FROM (
       SELECT DISTINCT ON (conv.contact_id)
         conv.contact_id,
         conv.enterprise_id
       FROM conversations conv
       WHERE conv.contact_id = $1
         AND conv.enterprise_id IS NOT NULL
       ORDER BY
         conv.contact_id,
         conv.last_message_at DESC NULLS LAST,
         conv.updated_at DESC,
         conv.id DESC
     ) pick
     JOIN enterprises e ON e.id = pick.enterprise_id AND e.status = 'ativo'
     WHERE c.id = pick.contact_id
       AND c.id = $1
       AND c.enterprise_id IS NULL`,
    [contactId]
  );
}

export async function createContact(data: {
  fullName?: string | null;
  phoneE164: string;
  phoneDisplay?: string | null;
  email?: string | null;
  enterpriseInterest?: string | null;
  notes?: string | null;
  source?: string;
  ownerUserId?: number | null;
  ownerAssignmentSource?: string | null;
  ownerAssignedByUserId?: number | null;
}, db?: Queryable): Promise<ContactRow> {
  const nowOwner = data.ownerUserId != null ? new Date() : null;
  const fullName = (data.fullName || '').trim() || null;
  const { rows } = await q(db).query<ContactRow>(
    `INSERT INTO contacts (
      full_name, first_name, phone_e164, phone_display, email, enterprise_id, enterprise_interest, notes, source,
      owner_user_id, owner_assigned_at, owner_assignment_source, owner_assigned_by_user_id, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
    RETURNING *`,
    [
      fullName,
      toFirstName(fullName),
      data.phoneE164,
      data.phoneDisplay ?? null,
      data.email?.trim() || null,
      null,
      data.enterpriseInterest?.trim() || null,
      data.notes?.trim() || null,
      data.source || 'manual',
      data.ownerUserId ?? null,
      nowOwner,
      data.ownerAssignmentSource ?? (data.ownerUserId != null ? 'first_import' : null),
      data.ownerAssignedByUserId ?? null,
    ]
  );
  return rows[0];
}

export async function findOrCreateContactByPhone(data: {
  phoneE164: string;
  phoneDisplay?: string | null;
  fullName?: string | null;
  source?: string;
}): Promise<ContactRow> {
  const existing = await findContactByPhoneE164(data.phoneE164);
  if (existing) {
    if ((!existing.full_name || !existing.first_name) && data.fullName?.trim()) {
      const fullName = data.fullName.trim();
      const { rows } = await query<ContactRow>(
        `UPDATE contacts
         SET full_name = COALESCE(full_name, $2),
             first_name = COALESCE(first_name, $3),
             phone_display = COALESCE(phone_display, $4),
             updated_at = NOW()
         WHERE id = $1
         RETURNING *`,
        [existing.id, fullName, toFirstName(fullName), data.phoneDisplay ?? null]
      );
      return rows[0] ?? existing;
    }
    return existing;
  }
  return createContact({
    phoneE164: data.phoneE164,
    phoneDisplay: data.phoneDisplay ?? null,
    fullName: data.fullName ?? null,
    source: data.source ?? 'whatsapp',
  });
}

export async function assignContactToConversation(conversationId: number, contactId: number, db?: Queryable): Promise<void> {
  await q(db).query(
    `UPDATE conversations
     SET contact_id = $2,
         assigned_broker_id = (
           SELECT c.owner_user_id FROM contacts c WHERE c.id = $2
         ),
         updated_at = NOW()
     WHERE id = $1`,
    [conversationId, contactId]
  );
  if (!db) await trySyncContactEnterpriseFromLinkedConversations(contactId);
}

export async function syncConversationOwnerFromContact(conversationId: number): Promise<void> {
  await query(
    `UPDATE conversations conv
     SET assigned_broker_id = c.owner_user_id,
         updated_at = NOW()
     FROM contacts c
     WHERE conv.id = $1
       AND conv.contact_id = c.id
       AND conv.assigned_broker_id IS DISTINCT FROM c.owner_user_id`,
    [conversationId]
  );
}

/** Idempotente: alinha assigned_broker_id de todas as conversas com contact_id ao owner do contato. */
export async function syncAllConversationOwnersFromContacts(): Promise<number> {
  const result = await query(
    `UPDATE conversations conv
     SET assigned_broker_id = c.owner_user_id,
         updated_at = NOW()
     FROM contacts c
     WHERE conv.contact_id = c.id
       AND conv.assigned_broker_id IS DISTINCT FROM c.owner_user_id`
  );
  return result.rowCount ?? 0;
}

export async function touchContactInteractionByConversation(params: {
  conversationId: number;
  role: 'user' | 'assistant';
  at?: Date;
}): Promise<void> {
  const at = params.at ?? new Date();
  if (params.role === 'user') {
    await query(
      `UPDATE contacts c
       SET last_contact_at = GREATEST(COALESCE(c.last_contact_at, $2), $2),
           last_inbound_at = GREATEST(COALESCE(c.last_inbound_at, $2), $2),
           updated_at = NOW()
       FROM conversations conv
       WHERE conv.id = $1 AND conv.contact_id = c.id`,
      [params.conversationId, at]
    );
    return;
  }
  await query(
    `UPDATE contacts c
     SET last_contact_at = GREATEST(COALESCE(c.last_contact_at, $2), $2),
         last_outbound_at = GREATEST(COALESCE(c.last_outbound_at, $2), $2),
         updated_at = NOW()
     FROM conversations conv
     WHERE conv.id = $1 AND conv.contact_id = c.id`,
    [params.conversationId, at]
  );
}

export async function releaseContactOwnersByCorretor(corretorId: number): Promise<number> {
  const result = await query(
    `UPDATE contacts
     SET owner_user_id = NULL,
         owner_assigned_at = NULL,
         owner_assignment_source = 'broker_inactivated',
         updated_at = NOW()
     WHERE owner_user_id = $1`,
    [corretorId]
  );
  await query(
    `UPDATE conversations conv
     SET assigned_broker_id = NULL,
         updated_at = NOW()
     WHERE conv.contact_id IN (SELECT id FROM contacts WHERE owner_user_id IS NULL)
       AND conv.assigned_broker_id = $1`,
    [corretorId]
  );
  return result.rowCount ?? 0;
}

export async function listContacts(params: {
  search?: string;
  enterprise?: string;
  enterpriseId?: number;
  ownerUserId?: number;
  brokerId?: number;
  status?: 'assigned' | 'unassigned';
  origin?: string;
  createdFrom?: Date;
  createdTo?: Date;
  lastContactFrom?: Date;
  lastContactTo?: Date;
  withoutBroker?: boolean;
  withoutEnterprise?: boolean;
  limit?: number;
  offset?: number;
}): Promise<Array<ContactRow & { enterprise_display_name?: string | null }>> {
  const conds: string[] = ['archived_at IS NULL'];
  const vals: unknown[] = [];
  let idx = 1;
  if (params.search?.trim()) {
    conds.push(`(COALESCE(full_name,'') ILIKE $${idx} OR phone_e164 ILIKE $${idx})`);
    vals.push(`%${params.search.trim()}%`);
    idx++;
  }
  if (params.enterprise?.trim()) {
    conds.push(
      `(COALESCE(e.name,'') ILIKE $${idx} OR COALESCE(c.enterprise_interest,'') ILIKE $${idx})`
    );
    vals.push(`%${params.enterprise.trim()}%`);
    idx++;
  }
  if (params.enterpriseId != null) {
    conds.push(`c.enterprise_id = $${idx}`);
    vals.push(params.enterpriseId);
    idx++;
  }
  const brokerId = params.brokerId ?? params.ownerUserId;
  if (brokerId != null) {
    conds.push(`c.owner_user_id = $${idx}`);
    vals.push(brokerId);
    idx++;
  }
  if (params.status === 'assigned') conds.push('c.owner_user_id IS NOT NULL');
  if (params.status === 'unassigned') conds.push('c.owner_user_id IS NULL');
  if (params.origin?.trim()) {
    conds.push(`c.source = $${idx}`);
    vals.push(params.origin.trim());
    idx++;
  }
  if (params.createdFrom != null) {
    conds.push(`c.created_at >= $${idx}`);
    vals.push(params.createdFrom);
    idx++;
  }
  if (params.createdTo != null) {
    conds.push(`c.created_at < $${idx}`);
    vals.push(params.createdTo);
    idx++;
  }
  if (params.lastContactFrom != null) {
    conds.push(`c.last_contact_at >= $${idx}`);
    vals.push(params.lastContactFrom);
    idx++;
  }
  if (params.lastContactTo != null) {
    conds.push(`c.last_contact_at < $${idx}`);
    vals.push(params.lastContactTo);
    idx++;
  }
  if (params.withoutBroker === true) conds.push('c.owner_user_id IS NULL');
  if (params.withoutEnterprise === true) conds.push(`(c.enterprise_id IS NULL AND NULLIF(BTRIM(c.enterprise_interest), '') IS NULL)`);
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);
  console.debug('[ContactsRepository] listContacts filters', {
    search: params.search ?? null,
    enterprise: params.enterprise ?? null,
    enterpriseId: params.enterpriseId ?? null,
    ownerUserId: params.ownerUserId ?? null,
    brokerId: params.brokerId ?? null,
    status: params.status ?? null,
    origin: params.origin ?? null,
    createdFrom: params.createdFrom?.toISOString?.() ?? null,
    createdTo: params.createdTo?.toISOString?.() ?? null,
    lastContactFrom: params.lastContactFrom?.toISOString?.() ?? null,
    lastContactTo: params.lastContactTo?.toISOString?.() ?? null,
    withoutBroker: params.withoutBroker ?? null,
    withoutEnterprise: params.withoutEnterprise ?? null,
    limit,
    offset,
  });
  vals.push(limit, offset);
  const { rows } = await query<ContactRow & { enterprise_display_name?: string | null }>(
    `SELECT c.*, e.name AS enterprise_display_name
     FROM contacts c
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     WHERE ${conds.join(' AND ')}
     ORDER BY COALESCE(c.last_contact_at, c.created_at) DESC, c.id DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    vals
  );
  return rows;
}

export async function countContacts(params: {
  search?: string;
  enterprise?: string;
  enterpriseId?: number;
  ownerUserId?: number;
  brokerId?: number;
  status?: 'assigned' | 'unassigned';
  origin?: string;
  createdFrom?: Date;
  createdTo?: Date;
  lastContactFrom?: Date;
  lastContactTo?: Date;
  withoutBroker?: boolean;
  withoutEnterprise?: boolean;
}): Promise<number> {
  const conds: string[] = ['c.archived_at IS NULL'];
  const vals: unknown[] = [];
  let idx = 1;
  if (params.search?.trim()) {
    conds.push(`(COALESCE(c.full_name,'') ILIKE $${idx} OR c.phone_e164 ILIKE $${idx})`);
    vals.push(`%${params.search.trim()}%`);
    idx++;
  }
  if (params.enterprise?.trim()) {
    conds.push(`(COALESCE(e.name,'') ILIKE $${idx} OR COALESCE(c.enterprise_interest,'') ILIKE $${idx})`);
    vals.push(`%${params.enterprise.trim()}%`);
    idx++;
  }
  if (params.enterpriseId != null) {
    conds.push(`c.enterprise_id = $${idx}`);
    vals.push(params.enterpriseId);
    idx++;
  }
  const brokerId = params.brokerId ?? params.ownerUserId;
  if (brokerId != null) {
    conds.push(`c.owner_user_id = $${idx}`);
    vals.push(brokerId);
    idx++;
  }
  if (params.status === 'assigned') conds.push('c.owner_user_id IS NOT NULL');
  if (params.status === 'unassigned') conds.push('c.owner_user_id IS NULL');
  if (params.origin?.trim()) {
    conds.push(`c.source = $${idx}`);
    vals.push(params.origin.trim());
    idx++;
  }
  if (params.createdFrom != null) {
    conds.push(`c.created_at >= $${idx}`);
    vals.push(params.createdFrom);
    idx++;
  }
  if (params.createdTo != null) {
    conds.push(`c.created_at < $${idx}`);
    vals.push(params.createdTo);
    idx++;
  }
  if (params.lastContactFrom != null) {
    conds.push(`c.last_contact_at >= $${idx}`);
    vals.push(params.lastContactFrom);
    idx++;
  }
  if (params.lastContactTo != null) {
    conds.push(`c.last_contact_at < $${idx}`);
    vals.push(params.lastContactTo);
    idx++;
  }
  if (params.withoutBroker === true) conds.push('c.owner_user_id IS NULL');
  if (params.withoutEnterprise === true) conds.push(`(c.enterprise_id IS NULL AND NULLIF(BTRIM(c.enterprise_interest), '') IS NULL)`);
  const { rows } = await query<{ total: string }>(
    `SELECT COUNT(*)::text AS total
     FROM contacts c
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     WHERE ${conds.join(' AND ')}`,
    vals
  );
  return parseInt(rows[0]?.total ?? '0', 10) || 0;
}

export async function listContactOrigins(): Promise<string[]> {
  const { rows } = await query<{ source: string }>(
    `SELECT DISTINCT source
     FROM contacts
     WHERE archived_at IS NULL
       AND NULLIF(BTRIM(source), '') IS NOT NULL
     ORDER BY source ASC`
  );
  return rows.map((row) => row.source);
}

export async function updateContactAdmin(
  id: number,
  patch: {
    fullName?: string | null;
    email?: string | null;
    enterpriseId?: number | null;
    enterpriseInterest?: string | null;
    notes?: string | null;
    source?: string | null;
  }
): Promise<ContactRow | null> {
  const cur = await findContactById(id);
  if (!cur) return null;
  const fullName = patch.fullName !== undefined ? (patch.fullName || '').trim() || null : cur.full_name;

  let enterprise_id = cur.enterprise_id;
  let enterprise_interest = cur.enterprise_interest;
  if (patch.enterpriseId !== undefined) {
    if (patch.enterpriseId === null) {
      enterprise_id = null;
      enterprise_interest = null;
    } else {
      const ent = await getActiveEnterpriseById(patch.enterpriseId);
      if (ent) {
        enterprise_id = ent.id;
        enterprise_interest = ent.name;
      }
    }
  } else if (patch.enterpriseInterest !== undefined) {
    enterprise_interest = (patch.enterpriseInterest || '').trim() || null;
    enterprise_id = null;
  }

  const { rows } = await query<ContactRow>(
    `UPDATE contacts
     SET full_name = $2,
         first_name = $3,
         email = $4,
         enterprise_id = $5,
         enterprise_interest = $6,
         notes = $7,
         source = $8,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      fullName,
      toFirstName(fullName),
      patch.email !== undefined ? (patch.email || '').trim() || null : cur.email,
      enterprise_id,
      enterprise_interest,
      patch.notes !== undefined ? (patch.notes || '').trim() || null : cur.notes,
      patch.source !== undefined ? (patch.source || '').trim() || cur.source : cur.source,
    ]
  );
  return rows[0] ?? null;
}

export async function setContactOwnerAdmin(params: {
  contactId: number;
  ownerUserId: number | null;
  source: string;
  assignedByUserId: number | null;
}): Promise<ContactRow | null> {
  const { rows } = await query<ContactRow>(
    `UPDATE contacts
     SET owner_user_id = $2,
         owner_assigned_at = CASE WHEN $2 IS NULL THEN NULL ELSE NOW() END,
         owner_assignment_source = $3,
         owner_assigned_by_user_id = $4,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [params.contactId, params.ownerUserId, params.source, params.assignedByUserId]
  );
  const row = rows[0] ?? null;
  if (row) {
    await query(
      `UPDATE conversations SET assigned_broker_id = $2, updated_at = NOW() WHERE contact_id = $1`,
      [row.id, row.owner_user_id]
    );
  }
  return row;
}

