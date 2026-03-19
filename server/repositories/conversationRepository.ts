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
  classification_before_handoff?: string | null;
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

/** Exclui a conversa e suas mensagens (CASCADE). Retorna true se excluiu. */
export async function deleteConversation(id: number): Promise<boolean> {
  const result = await query(`DELETE FROM conversations WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

const VALID_CLASSIFICATIONS = new Set(['Novo', 'Qualificado', 'Reserva', 'Handoff']);

function toValidClassification(s: string | null | undefined): string {
  const t = (s || '').trim();
  if (t === 'Interessado' || t === 'Qualificando') return 'Qualificado';
  return VALID_CLASSIFICATIONS.has(t) ? t : 'Novo';
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
     ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
     LIMIT $2`,
    [channel, limit]
  );
  return rows;
}

export async function updateClassification(
  conversationId: number,
  u: { enterprise_id?: number | null; classification?: string; handoff?: boolean }
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
  let handoff: boolean;
  let classificationBeforeHandoff: string | null = null;
  const curRow = cur as ConversationRow & { classification_before_handoff?: string | null };
  if (u.handoff !== undefined) {
    handoff = Boolean(u.handoff);
    if (handoff) {
      if (classification !== 'Handoff') classificationBeforeHandoff = toValidClassification(classification);
      classification = 'Handoff';
    } else {
      // Modo ANA: garantir limpeza total. handoff=false → classification NUNCA pode ser Handoff.
      const restored = curRow.classification_before_handoff?.trim();
      const candidate = toValidClassification(restored || 'Novo');
      classification = candidate === 'Handoff' ? 'Novo' : candidate;
      classificationBeforeHandoff = null;
    }
  } else {
    handoff = classification === 'Handoff';
  }
  // Garantia final: se handoff=false, classification não pode ser Handoff
  if (!handoff && classification === 'Handoff') classification = 'Novo';
  const savedForHandoff = handoff ? (classificationBeforeHandoff ?? null) : null;
  const { rows } = await query<ConversationRow>(
    `UPDATE conversations SET enterprise_id = $1, classification = $2, handoff = $3,
     classification_before_handoff = CASE WHEN $3 = false THEN NULL ELSE COALESCE($5::text, classification_before_handoff) END,
     updated_at = NOW() WHERE id = $4 RETURNING *`,
    [enterprise_id, toValidClassification(classification), handoff, conversationId, savedForHandoff]
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

const CLASSIFICATIONS = new Set(['Novo', 'Qualificado', 'Reserva', 'Handoff']);

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
  let classification = toValidClassification(meta.classification?.trim() || conv.classification);
  const handoff = !!meta.handoff;
  if (handoff) {
    classification = 'Handoff';
  }
  let lead_temperature = conv.lead_temperature;
  const t = (meta.lead_temperature || '').toLowerCase();
  if (t === 'quente') lead_temperature = 'quente';
  else if (t === 'morno') lead_temperature = 'morno';
  else if (t === 'frio') lead_temperature = 'frio';
  const cn = meta.customer_name?.trim();
  const curRow = conv as ConversationRow & { classification_before_handoff?: string | null };
  const saveBeforeHandoff =
    handoff && conv.classification !== 'Handoff'
      ? toValidClassification(conv.classification)
      : null;
  await query(
    `UPDATE conversations SET classification = $1, lead_temperature = $2, handoff = $3,
     customer_name = CASE WHEN $4::text IS NOT NULL AND length(trim($4)) > 0 THEN trim($4) ELSE customer_name END,
     classification_before_handoff = CASE WHEN $3 = true AND ($6::text) IS NOT NULL THEN $6::text ELSE
       (CASE WHEN $3 = false THEN NULL ELSE classification_before_handoff END) END,
     updated_at = NOW() WHERE id = $5`,
    [classification, lead_temperature, handoff, cn ?? null, conversationId, saveBeforeHandoff ?? null]
  );
}
