import type pg from 'pg';
import { parse } from 'csv-parse/sync';
import { getPool, query } from '../db/pg.js';
import {
  createContact,
  findContactByPhoneE164,
  type ContactRow,
} from '../repositories/contactsRepository.js';
import { normalizePhoneE164, toFirstName } from '../utils/phone.js';

type ImportAction =
  | 'create'
  | 'update'
  | 'claim_unassigned'
  | 'skip_owned'
  | 'invalid'
  | 'duplicate_in_file';

interface ParsedLine {
  rowNumber: number;
  raw: Record<string, unknown>;
  name: string | null;
  phone: string | null;
  email: string | null;
  enterpriseInterest: string | null;
  notes: string | null;
}

export interface ContactImportPreviewResult {
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  createdContacts: number;
  updatedContacts: number;
  claimedUnassignedContacts: number;
  skippedOwnedContacts: number;
  rows: Array<{
    rowNumber: number;
    action: ImportAction;
    normalizedPhoneE164: string | null;
    errorMessage: string | null;
  }>;
}

function normalizeHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '_');
}

function pickValue(rec: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = rec[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return null;
}

function parseCsvRows(fileBuffer: Buffer): ParsedLine[] {
  const text = fileBuffer.toString('utf-8').replace(/^\uFEFF/, '');
  const records = parse(text, {
    columns: (headers: string[]) => headers.map((h) => normalizeHeader(String(h))),
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  }) as Record<string, unknown>[];

  return records.map((r, i) => ({
    rowNumber: i + 2,
    raw: r,
    name: pickValue(r, ['nome', 'name', 'full_name']),
    phone: pickValue(r, ['telefone', 'telefone_1', 'phone', 'celular', 'whatsapp', 'numero']),
    email: pickValue(r, ['email', 'e_mail']),
    enterpriseInterest: pickValue(r, ['empreendimento_interesse', 'empreendimento', 'interesse', 'enterprise_interest']),
    notes: pickValue(r, ['observacoes', 'obs', 'notes']),
  }));
}

async function classifyPreviewRow(
  line: ParsedLine,
  ownerUserId: number | null
): Promise<{ action: ImportAction; normalizedPhoneE164: string | null; errorMessage: string | null }> {
  const normalizedPhone = normalizePhoneE164(line.phone);
  if (!normalizedPhone) {
    return { action: 'invalid', normalizedPhoneE164: null, errorMessage: 'Telefone inválido ou ausente.' };
  }
  const contact = await findContactByPhoneE164(normalizedPhone);
  if (!contact) {
    return { action: 'create', normalizedPhoneE164: normalizedPhone, errorMessage: null };
  }
  if (contact.owner_user_id == null && ownerUserId != null) {
    return { action: 'claim_unassigned', normalizedPhoneE164: normalizedPhone, errorMessage: null };
  }
  if (contact.owner_user_id != null && ownerUserId != null && contact.owner_user_id !== ownerUserId) {
    return { action: 'skip_owned', normalizedPhoneE164: normalizedPhone, errorMessage: 'Contato já possui owner diferente.' };
  }
  return { action: 'update', normalizedPhoneE164: normalizedPhone, errorMessage: null };
}

export async function previewImportFromCsv(params: {
  fileBuffer: Buffer;
  ownerUserId: number | null;
}): Promise<ContactImportPreviewResult> {
  const rows = parseCsvRows(params.fileBuffer);
  const seen = new Set<string>();
  const out: ContactImportPreviewResult = {
    totalRows: rows.length,
    validRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    createdContacts: 0,
    updatedContacts: 0,
    claimedUnassignedContacts: 0,
    skippedOwnedContacts: 0,
    rows: [],
  };

  for (const line of rows) {
    const normalizedPhone = normalizePhoneE164(line.phone);
    if (!normalizedPhone) {
      out.invalidRows++;
      out.rows.push({ rowNumber: line.rowNumber, action: 'invalid', normalizedPhoneE164: null, errorMessage: 'Telefone inválido ou ausente.' });
      continue;
    }
    if (seen.has(normalizedPhone)) {
      out.duplicateRows++;
      out.rows.push({ rowNumber: line.rowNumber, action: 'duplicate_in_file', normalizedPhoneE164: normalizedPhone, errorMessage: 'Telefone duplicado no arquivo.' });
      continue;
    }
    seen.add(normalizedPhone);
    const cls = await classifyPreviewRow(line, params.ownerUserId);
    if (cls.action === 'invalid') out.invalidRows++;
    else {
      out.validRows++;
      if (cls.action === 'create') out.createdContacts++;
      else if (cls.action === 'update') out.updatedContacts++;
      else if (cls.action === 'claim_unassigned') out.claimedUnassignedContacts++;
      else if (cls.action === 'skip_owned') out.skippedOwnedContacts++;
    }
    out.rows.push({ rowNumber: line.rowNumber, ...cls });
  }
  return out;
}

async function ensureBatch(
  client: pg.PoolClient,
  params: { uploadedByUserId: number; ownerUserId: number | null; fileName: string }
): Promise<number> {
  const { rows } = await client.query<{ id: number }>(
    `INSERT INTO contact_import_batches (uploaded_by_user_id, owner_user_id, file_name, status)
     VALUES ($1,$2,$3,'processing')
     RETURNING id`,
    [params.uploadedByUserId, params.ownerUserId, params.fileName]
  );
  return rows[0].id;
}

async function insertImportRow(
  client: pg.PoolClient,
  params: {
    batchId: number;
    rowNumber: number;
    raw: Record<string, unknown>;
    normalizedPhoneE164: string | null;
    contactId: number | null;
    action: ImportAction;
    errorMessage: string | null;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO contact_import_rows
     (batch_id, row_number, raw_payload_json, normalized_phone_e164, contact_id, action, error_message)
     VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7)`,
    [
      params.batchId,
      params.rowNumber,
      JSON.stringify(params.raw || {}),
      params.normalizedPhoneE164,
      params.contactId,
      params.action,
      params.errorMessage,
    ]
  );
}

function applyContactFieldUpdates(contact: ContactRow, line: ParsedLine): {
  fullName: string | null;
  firstName: string | null;
  email: string | null;
  enterpriseInterest: string | null;
  notes: string | null;
  changed: boolean;
} {
  const incomingName = line.name?.trim() || null;
  const incomingEmail = line.email?.trim() || null;
  const incomingInterest = line.enterpriseInterest?.trim() || null;
  const incomingNotes = line.notes?.trim() || null;
  const fullName = incomingName ?? contact.full_name;
  const firstName = toFirstName(fullName);
  const email = incomingEmail ?? contact.email;
  const enterpriseInterest = incomingInterest ?? contact.enterprise_interest;
  const notes = incomingNotes ?? contact.notes;
  const changed =
    fullName !== contact.full_name ||
    firstName !== contact.first_name ||
    email !== contact.email ||
    enterpriseInterest !== contact.enterprise_interest ||
    notes !== contact.notes;
  return { fullName, firstName, email, enterpriseInterest, notes, changed };
}

export async function commitImportFromCsv(params: {
  fileBuffer: Buffer;
  fileName: string;
  uploadedByUserId: number;
  ownerUserId: number | null;
}): Promise<{ batchId: number; summary: ContactImportPreviewResult }> {
  const parsed = parseCsvRows(params.fileBuffer);
  const seen = new Set<string>();
  const summary: ContactImportPreviewResult = {
    totalRows: parsed.length,
    validRows: 0,
    invalidRows: 0,
    duplicateRows: 0,
    createdContacts: 0,
    updatedContacts: 0,
    claimedUnassignedContacts: 0,
    skippedOwnedContacts: 0,
    rows: [],
  };

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const batchId = await ensureBatch(client, {
      uploadedByUserId: params.uploadedByUserId,
      ownerUserId: params.ownerUserId,
      fileName: params.fileName,
    });

    for (const line of parsed) {
      const normalizedPhone = normalizePhoneE164(line.phone);
      if (!normalizedPhone) {
        summary.invalidRows++;
        summary.rows.push({ rowNumber: line.rowNumber, action: 'invalid', normalizedPhoneE164: null, errorMessage: 'Telefone inválido ou ausente.' });
        await insertImportRow(client, {
          batchId,
          rowNumber: line.rowNumber,
          raw: line.raw,
          normalizedPhoneE164: null,
          contactId: null,
          action: 'invalid',
          errorMessage: 'Telefone inválido ou ausente.',
        });
        continue;
      }
      if (seen.has(normalizedPhone)) {
        summary.duplicateRows++;
        summary.rows.push({ rowNumber: line.rowNumber, action: 'duplicate_in_file', normalizedPhoneE164: normalizedPhone, errorMessage: 'Telefone duplicado no arquivo.' });
        await insertImportRow(client, {
          batchId,
          rowNumber: line.rowNumber,
          raw: line.raw,
          normalizedPhoneE164: normalizedPhone,
          contactId: null,
          action: 'duplicate_in_file',
          errorMessage: 'Telefone duplicado no arquivo.',
        });
        continue;
      }
      seen.add(normalizedPhone);
      summary.validRows++;

      const inserted = await client.query<ContactRow>(
        `INSERT INTO contacts (
          full_name, first_name, phone_e164, phone_display, email, enterprise_id, enterprise_interest, notes, source,
          owner_user_id, owner_assigned_at, owner_assignment_source, owner_assigned_by_user_id, updated_at
        )
        VALUES ($1,$2,$3,$4,$5,NULL,$6,$7,'csv_import',$8,CASE WHEN $8 IS NULL THEN NULL ELSE NOW() END,
                CASE WHEN $8 IS NULL THEN NULL ELSE 'first_import' END,$9,NOW())
        ON CONFLICT (phone_e164) DO NOTHING
        RETURNING *`,
        [
          line.name?.trim() || null,
          toFirstName(line.name),
          normalizedPhone,
          line.phone?.trim() || null,
          line.email?.trim() || null,
          line.enterpriseInterest?.trim() || null,
          line.notes?.trim() || null,
          params.ownerUserId,
          params.uploadedByUserId,
        ]
      );
      if (inserted.rows[0]) {
        const c = inserted.rows[0];
        summary.createdContacts++;
        summary.rows.push({ rowNumber: line.rowNumber, action: 'create', normalizedPhoneE164: normalizedPhone, errorMessage: null });
        await insertImportRow(client, {
          batchId,
          rowNumber: line.rowNumber,
          raw: line.raw,
          normalizedPhoneE164: normalizedPhone,
          contactId: c.id,
          action: 'create',
          errorMessage: null,
        });
        continue;
      }

      const existing = await findContactByPhoneE164(normalizedPhone, client);
      if (!existing) {
        summary.invalidRows++;
        summary.rows.push({ rowNumber: line.rowNumber, action: 'invalid', normalizedPhoneE164: normalizedPhone, errorMessage: 'Contato não encontrado após conflito.' });
        await insertImportRow(client, {
          batchId,
          rowNumber: line.rowNumber,
          raw: line.raw,
          normalizedPhoneE164: normalizedPhone,
          contactId: null,
          action: 'invalid',
          errorMessage: 'Contato não encontrado após conflito.',
        });
        continue;
      }

      const updates = applyContactFieldUpdates(existing, line);
      let action: ImportAction = 'update';
      if (existing.owner_user_id == null && params.ownerUserId != null) {
        const claim = await client.query<ContactRow>(
          `UPDATE contacts
           SET owner_user_id = $2,
               owner_assigned_at = NOW(),
               owner_assignment_source = 'csv_claim',
               owner_assigned_by_user_id = $3,
               full_name = $4,
               first_name = $5,
               email = $6,
               enterprise_interest = $7,
               notes = $8,
               updated_at = NOW()
           WHERE id = $1 AND owner_user_id IS NULL
           RETURNING *`,
          [
            existing.id,
            params.ownerUserId,
            params.uploadedByUserId,
            updates.fullName,
            updates.firstName,
            updates.email,
            updates.enterpriseInterest,
            updates.notes,
          ]
        );
        if (claim.rowCount === 1) {
          summary.claimedUnassignedContacts++;
          action = 'claim_unassigned';
        } else {
          summary.skippedOwnedContacts++;
          action = 'skip_owned';
          if (updates.changed) {
            await client.query(
              `UPDATE contacts
               SET full_name = $2,
                   first_name = $3,
                   email = $4,
                   enterprise_interest = $5,
                   notes = $6,
                   updated_at = NOW()
               WHERE id = $1`,
              [existing.id, updates.fullName, updates.firstName, updates.email, updates.enterpriseInterest, updates.notes]
            );
            summary.updatedContacts++;
          }
        }
      } else {
        if (existing.owner_user_id != null && params.ownerUserId != null && existing.owner_user_id !== params.ownerUserId) {
          action = 'skip_owned';
          summary.skippedOwnedContacts++;
        } else {
          if (updates.changed) summary.updatedContacts++;
        }
        if (updates.changed) {
          await client.query(
            `UPDATE contacts
             SET full_name = $2,
                 first_name = $3,
                 email = $4,
                 enterprise_interest = $5,
                 notes = $6,
                 updated_at = NOW()
             WHERE id = $1`,
            [existing.id, updates.fullName, updates.firstName, updates.email, updates.enterpriseInterest, updates.notes]
          );
        }
      }

      summary.rows.push({ rowNumber: line.rowNumber, action, normalizedPhoneE164: normalizedPhone, errorMessage: action === 'skip_owned' ? 'Contato já possui owner.' : null });
      await insertImportRow(client, {
        batchId,
        rowNumber: line.rowNumber,
        raw: line.raw,
        normalizedPhoneE164: normalizedPhone,
        contactId: existing.id,
        action,
        errorMessage: action === 'skip_owned' ? 'Contato já possui owner.' : null,
      });
    }

    await client.query(
      `UPDATE contact_import_batches
       SET status = 'finished',
           total_rows = $2,
           valid_rows = $3,
           invalid_rows = $4,
           created_contacts = $5,
           updated_contacts = $6,
           claimed_unassigned_contacts = $7,
           skipped_owned_contacts = $8,
           duplicate_rows = $9,
           finished_at = NOW()
       WHERE id = $1`,
      [
        batchId,
        summary.totalRows,
        summary.validRows,
        summary.invalidRows,
        summary.createdContacts,
        summary.updatedContacts,
        summary.claimedUnassignedContacts,
        summary.skippedOwnedContacts,
        summary.duplicateRows,
      ]
    );

    await client.query('COMMIT');
    return { batchId, summary };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function listImportBatches(limit = 50): Promise<Array<Record<string, unknown>>> {
  const { rows } = await query(
    `SELECT b.*,
            u.name AS uploaded_by_name,
            c.full_name AS owner_broker_name
     FROM contact_import_batches b
     LEFT JOIN app_users u ON u.id = b.uploaded_by_user_id
     LEFT JOIN corretores c ON c.id = b.owner_user_id
     ORDER BY b.created_at DESC
     LIMIT $1`,
    [Math.min(Math.max(limit, 1), 200)]
  );
  return rows;
}

export async function listEligibleContactsByBatch(batchId: number, ownerUserId: number): Promise<{
  eligible: ContactRow[];
  blockedCount: number;
}> {
  const { rows: contacts } = await query<ContactRow>(
    `SELECT c.*
     FROM contact_import_rows r
     JOIN contacts c ON c.id = r.contact_id
     WHERE r.batch_id = $1
       AND r.action IN ('create', 'update', 'claim_unassigned', 'skip_owned')
       AND c.owner_user_id = $2
     GROUP BY c.id
     ORDER BY COALESCE(c.last_contact_at, c.created_at) DESC`,
    [batchId, ownerUserId]
  );
  const { rows: blocked } = await query<{ n: string }>(
    `SELECT COUNT(DISTINCT c.id)::text AS n
     FROM contact_import_rows r
     JOIN contacts c ON c.id = r.contact_id
     WHERE r.batch_id = $1
       AND r.action IN ('create', 'update', 'claim_unassigned', 'skip_owned')
       AND COALESCE(c.owner_user_id, -1) <> $2`,
    [batchId, ownerUserId]
  );
  return { eligible: contacts, blockedCount: parseInt(blocked[0]?.n || '0', 10) || 0 };
}

