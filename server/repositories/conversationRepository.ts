import { query } from '../db/pg.js';
import { getActiveEnterpriseById } from './enterpriseRepository.js';

export interface ConversationRow {
  id: number;
  channel: string;
  external_contact_id: string;
  contact_phone: string | null;
  customer_name: string | null;
  enterprise_id: number | null;
  classification: string;
  lead_temperature: string;
  handoff: boolean;
  meta_phone_number_id: string | null;
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function findOrCreateConversation(
  channel: string,
  externalId: string,
  contactPhone: string | null,
  contactName: string | null,
  metaPhoneNumberId: string | null
): Promise<ConversationRow> {
  const { rows } = await query<ConversationRow>(
    `INSERT INTO conversations (channel, external_contact_id, contact_phone, customer_name, meta_phone_number_id, last_message_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (channel, external_contact_id) DO UPDATE SET
       contact_phone = COALESCE(EXCLUDED.contact_phone, conversations.contact_phone),
       customer_name = COALESCE(EXCLUDED.customer_name, conversations.customer_name),
       meta_phone_number_id = COALESCE(EXCLUDED.meta_phone_number_id, conversations.meta_phone_number_id),
       last_message_at = NOW(), updated_at = NOW()
     RETURNING *`,
    [channel, externalId, contactPhone, contactName, metaPhoneNumberId]
  );
  return rows[0];
}

export async function getConversationById(id: number): Promise<ConversationRow | null> {
  const { rows } = await query<ConversationRow>(`SELECT * FROM conversations WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export interface ConversationWithPreview extends ConversationRow {
  last_message_preview: string | null;
  enterprise_name: string | null;
}

export async function listConversationsWithPreview(
  channel: string = 'whatsapp',
  limit: number = 100
): Promise<ConversationWithPreview[]> {
  const { rows } = await query<ConversationWithPreview>(
    `SELECT c.*,
      (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_preview,
      e.name AS enterprise_name
     FROM conversations c
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     WHERE c.channel = $1
     ORDER BY COALESCE(c.handoff, false) DESC, c.last_message_at DESC NULLS LAST, c.updated_at DESC
     LIMIT $2`,
    [channel, limit]
  );
  return rows;
}

export async function updateClassification(
  conversationId: number,
  u: { enterprise_id?: number | null; classification?: string }
): Promise<ConversationRow | null> {
  const cur = await getConversationById(conversationId);
  if (!cur) return null;
  let enterprise_id = u.enterprise_id !== undefined ? u.enterprise_id : cur.enterprise_id;
  if (enterprise_id != null) {
    const ok = await getActiveEnterpriseById(enterprise_id);
    if (!ok) enterprise_id = cur.enterprise_id;
  }
  let classification = cur.classification;
  if (u.classification !== undefined && u.classification !== null && u.classification !== '') {
    classification = u.classification;
  }
  const handoff = classification === 'Handoff';
  const { rows } = await query<ConversationRow>(
    `UPDATE conversations SET enterprise_id = $1, classification = $2, handoff = $3, updated_at = NOW() WHERE id = $4 RETURNING *`,
    [enterprise_id, classification, handoff, conversationId]
  );
  return rows[0] ?? null;
}

export async function setConversationEnterpriseId(
  conversationId: number,
  enterpriseId: number | null
): Promise<ConversationRow | null> {
  if (enterpriseId != null) {
    const ok = await getActiveEnterpriseById(enterpriseId);
    if (!ok) return null;
  }
  const { rows } = await query<ConversationRow>(
    `UPDATE conversations SET enterprise_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [enterpriseId, conversationId]
  );
  return rows[0] ?? null;
}

const CLASSIFICATIONS = new Set(['Novo', 'Qualificando', 'Interessado', 'Handoff']);

export async function applyAnaConversationUpdate(
  conversationId: number,
  meta: {
    classification?: string;
    lead_temperature?: string;
    customer_name?: string;
    handoff?: boolean;
  }
): Promise<void> {
  const conv = await getConversationById(conversationId);
  if (!conv) return;
  let classification = meta.classification?.trim() || conv.classification;
  if (meta.handoff) classification = 'Handoff';
  if (!CLASSIFICATIONS.has(classification)) classification = conv.classification;
  let lead_temperature = conv.lead_temperature;
  const t = (meta.lead_temperature || '').toLowerCase();
  if (t === 'quente') lead_temperature = 'quente';
  else if (t === 'morno') lead_temperature = 'morno';
  else if (t === 'frio') lead_temperature = 'frio';
  const cn = meta.customer_name?.trim();
  await query(
    `UPDATE conversations SET classification = $1, lead_temperature = $2, handoff = $3,
     customer_name = CASE WHEN $4::text IS NOT NULL AND length(trim($4)) > 0 THEN trim($4) ELSE customer_name END,
     updated_at = NOW() WHERE id = $5`,
    [classification, lead_temperature, !!meta.handoff, cn ?? null, conversationId]
  );
}
