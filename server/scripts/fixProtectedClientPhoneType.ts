import { query } from '../db/pg.js';
import { normalizePhoneDigits, PROTECTED_CLIENT_PHONE_CANONICAL } from '../utils/protectedClientPhone.js';

function normalizeForMatch(value: string | null | undefined): string {
  const digits = normalizePhoneDigits(value);
  if (!digits) return '';
  if (digits.startsWith('55')) return digits;
  if (digits.length === 11) return `55${digits}`;
  return digits;
}

async function run(): Promise<void> {
  const target = PROTECTED_CLIENT_PHONE_CANONICAL;
  const targetLocal = target.slice(2);

  const beforeContacts = await query<{
    id: number;
    phone_e164: string | null;
    phone_display: string | null;
    contact_type: string | null;
  }>(
    `SELECT id, phone_e164, phone_display, contact_type
       FROM contacts
      WHERE regexp_replace(COALESCE(phone_e164, ''), '\\D', '', 'g') = $1
         OR regexp_replace(COALESCE(phone_display, ''), '\\D', '', 'g') = $1
         OR regexp_replace(COALESCE(phone_e164, ''), '\\D', '', 'g') = $2
         OR regexp_replace(COALESCE(phone_display, ''), '\\D', '', 'g') = $2`,
    [target, targetLocal]
  );

  const beforeConversations = await query<{
    id: number;
    contact_id: number | null;
    contact_phone: string | null;
    external_contact_id: string | null;
    conversation_type: string | null;
  }>(
    `SELECT id, contact_id, contact_phone, external_contact_id, conversation_type
       FROM conversations
      WHERE regexp_replace(COALESCE(contact_phone, ''), '\\D', '', 'g') = $1
         OR regexp_replace(COALESCE(external_contact_id, ''), '\\D', '', 'g') = $1
         OR regexp_replace(COALESCE(contact_phone, ''), '\\D', '', 'g') = $2
         OR regexp_replace(COALESCE(external_contact_id, ''), '\\D', '', 'g') = $2
         OR contact_id IN (
           SELECT id FROM contacts
            WHERE regexp_replace(COALESCE(phone_e164, ''), '\\D', '', 'g') = $1
               OR regexp_replace(COALESCE(phone_display, ''), '\\D', '', 'g') = $1
               OR regexp_replace(COALESCE(phone_e164, ''), '\\D', '', 'g') = $2
               OR regexp_replace(COALESCE(phone_display, ''), '\\D', '', 'g') = $2
         )`,
    [target, targetLocal]
  );

  console.log('[FIX_PROTECTED_CLIENT_PHONE_TYPE_BEFORE]', {
    target,
    contacts: beforeContacts.rows,
    conversations: beforeConversations.rows,
  });

  await query(
    `UPDATE contacts
        SET contact_type = 'CLIENT', updated_at = NOW()
      WHERE id = ANY($1::int[])`,
    [beforeContacts.rows.map((r) => r.id)]
  );

  await query(
    `UPDATE conversations
        SET conversation_type = 'CLIENT', updated_at = NOW()
      WHERE id = ANY($1::int[])`,
    [beforeConversations.rows.map((r) => r.id)]
  );

  const afterContacts = await query<{
    id: number;
    phone_e164: string | null;
    phone_display: string | null;
    contact_type: string | null;
  }>(`SELECT id, phone_e164, phone_display, contact_type FROM contacts WHERE id = ANY($1::int[])`, [beforeContacts.rows.map((r) => r.id)]);

  const afterConversations = await query<{
    id: number;
    contact_id: number | null;
    contact_phone: string | null;
    external_contact_id: string | null;
    conversation_type: string | null;
  }>(`SELECT id, contact_id, contact_phone, external_contact_id, conversation_type FROM conversations WHERE id = ANY($1::int[])`, [beforeConversations.rows.map((r) => r.id)]);

  console.log('[FIX_PROTECTED_CLIENT_PHONE_TYPE_AFTER]', {
    target,
    contacts: afterContacts.rows,
    conversations: afterConversations.rows,
  });

  const sanity = [...afterConversations.rows].every((row) => row.conversation_type === 'CLIENT') &&
    [...afterContacts.rows].every((row) => row.contact_type === 'CLIENT');

  console.log('[FIX_PROTECTED_CLIENT_PHONE_TYPE_DONE]', {
    targetCanonical: normalizeForMatch(target),
    updatedContacts: afterContacts.rows.length,
    updatedConversations: afterConversations.rows.length,
    ok: sanity,
  });
}

run().catch((error) => {
  console.error('[FIX_PROTECTED_CLIENT_PHONE_TYPE_ERROR]', error);
  process.exitCode = 1;
});
