import type pg from 'pg';
import { query } from '../db/pg.js';
import { toFirstName } from '../utils/phone.js';

export interface ContactRow {
  id: number;
  full_name: string | null;
  first_name: string | null;
  phone_e164: string;
  phone_display: string | null;
  email: string | null;
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
  const { rows } = await query<ContactRow>(`SELECT * FROM contacts WHERE id = $1 LIMIT 1`, [id]);
  return rows[0] ?? null;
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
      full_name, first_name, phone_e164, phone_display, email, enterprise_interest, notes, source,
      owner_user_id, owner_assigned_at, owner_assignment_source, owner_assigned_by_user_id, updated_at
    )
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
    RETURNING *`,
    [
      fullName,
      toFirstName(fullName),
      data.phoneE164,
      data.phoneDisplay ?? null,
      data.email?.trim() || null,
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
  ownerUserId?: number;
  status?: 'assigned' | 'unassigned';
  limit?: number;
  offset?: number;
}): Promise<ContactRow[]> {
  const conds: string[] = ['archived_at IS NULL'];
  const vals: unknown[] = [];
  let idx = 1;
  if (params.search?.trim()) {
    conds.push(`(COALESCE(full_name,'') ILIKE $${idx} OR phone_e164 ILIKE $${idx})`);
    vals.push(`%${params.search.trim()}%`);
    idx++;
  }
  if (params.enterprise?.trim()) {
    conds.push(`COALESCE(enterprise_interest,'') ILIKE $${idx}`);
    vals.push(`%${params.enterprise.trim()}%`);
    idx++;
  }
  if (params.ownerUserId != null) {
    conds.push(`owner_user_id = $${idx}`);
    vals.push(params.ownerUserId);
    idx++;
  }
  if (params.status === 'assigned') conds.push('owner_user_id IS NOT NULL');
  if (params.status === 'unassigned') conds.push('owner_user_id IS NULL');
  const limit = Math.min(Math.max(params.limit ?? 100, 1), 500);
  const offset = Math.max(params.offset ?? 0, 0);
  vals.push(limit, offset);
  const { rows } = await query<ContactRow>(
    `SELECT * FROM contacts
     WHERE ${conds.join(' AND ')}
     ORDER BY COALESCE(last_contact_at, created_at) DESC, id DESC
     LIMIT $${idx} OFFSET $${idx + 1}`,
    vals
  );
  return rows;
}

export async function updateContactAdmin(
  id: number,
  patch: { fullName?: string | null; email?: string | null; enterpriseInterest?: string | null; notes?: string | null; source?: string | null }
): Promise<ContactRow | null> {
  const cur = await findContactById(id);
  if (!cur) return null;
  const fullName = patch.fullName !== undefined ? (patch.fullName || '').trim() || null : cur.full_name;
  const { rows } = await query<ContactRow>(
    `UPDATE contacts
     SET full_name = $2,
         first_name = $3,
         email = $4,
         enterprise_interest = $5,
         notes = $6,
         source = $7,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      fullName,
      toFirstName(fullName),
      patch.email !== undefined ? (patch.email || '').trim() || null : cur.email,
      patch.enterpriseInterest !== undefined ? (patch.enterpriseInterest || '').trim() || null : cur.enterprise_interest,
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

