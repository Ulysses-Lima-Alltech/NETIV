import { query } from '../db/pg.js';
import { getActiveEnterpriseById } from './enterpriseRepository.js';
import type { LeadOriginInput } from '../services/leadOriginResolver.js';
import { resolveEnterpriseFromLeadSource } from '../services/leadOriginResolver.js';

export type { LeadOriginInput } from '../services/leadOriginResolver.js';

export interface ConversationRow {
  id: number;
  channel: string;
  external_contact_id: string;
  contact_phone: string | null;
  customer_name: string | null;
  enterprise_id: number | null;
  /** Empreendimento da campanha/origem (imutável após primeiro preenchimento). */
  enterprise_origin_id?: number | null;
  /** Snapshot bruto (ex.: referral Meta) — imutável após primeiro preenchimento. */
  lead_source_raw?: unknown | null;
  classification: string;
  classification_before_handoff?: string | null;
  lead_temperature: string | null;
  handoff: boolean;
  meta_phone_number_id: string | null;
  last_message_at: Date | null;
  created_at: Date;
  updated_at: Date;
  reserve_reason?: string | null;
  reserve_desired_city?: string | null;
  reserve_price_min?: string | number | null;
  reserve_price_max?: string | number | null;
  reserve_property_type?: string | null;
  reserve_bedrooms?: number | null;
  reserve_interest_type?: string | null;
  reserve_follow_up_moment?: string | null;
  reserve_commercial_notes?: string | null;
}

export interface ReserveSegmentationPatch {
  reason?: string | null;
  desiredCity?: string | null;
  desiredPriceMin?: number | null;
  desiredPriceMax?: number | null;
  propertyType?: string | null;
  bedrooms?: number | null;
  interestType?: string | null;
  followUpMoment?: string | null;
  commercialNotes?: string | null;
}

function numOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? Math.round(v) : Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
}

function rowReserveToPatch(row: ConversationRow): Required<ReserveSegmentationPatch> {
  return {
    reason: row.reserve_reason ?? null,
    desiredCity: row.reserve_desired_city ?? null,
    desiredPriceMin: numOrNull(row.reserve_price_min),
    desiredPriceMax: numOrNull(row.reserve_price_max),
    propertyType: row.reserve_property_type ?? null,
    bedrooms: intOrNull(row.reserve_bedrooms),
    interestType: row.reserve_interest_type ?? null,
    followUpMoment: row.reserve_follow_up_moment ?? null,
    commercialNotes: row.reserve_commercial_notes ?? null,
  };
}

function mergeReservePatch(cur: ReturnType<typeof rowReserveToPatch>, patch: ReserveSegmentationPatch): ReturnType<typeof rowReserveToPatch> {
  return {
    reason: patch.reason !== undefined ? patch.reason : cur.reason,
    desiredCity: patch.desiredCity !== undefined ? patch.desiredCity : cur.desiredCity,
    desiredPriceMin: patch.desiredPriceMin !== undefined ? patch.desiredPriceMin : cur.desiredPriceMin,
    desiredPriceMax: patch.desiredPriceMax !== undefined ? patch.desiredPriceMax : cur.desiredPriceMax,
    propertyType: patch.propertyType !== undefined ? patch.propertyType : cur.propertyType,
    bedrooms: patch.bedrooms !== undefined ? patch.bedrooms : cur.bedrooms,
    interestType: patch.interestType !== undefined ? patch.interestType : cur.interestType,
    followUpMoment: patch.followUpMoment !== undefined ? patch.followUpMoment : cur.followUpMoment,
    commercialNotes: patch.commercialNotes !== undefined ? patch.commercialNotes : cur.commercialNotes,
  };
}

/** JSON público (camelCase) para listagens e PATCH — preparado para filtros/campanhas futuras. */
export function conversationReserveToPublic(row: ConversationRow): {
  reserveReason: string | null;
  reserveDesiredCity: string | null;
  reservePriceMin: number | null;
  reservePriceMax: number | null;
  reservePropertyType: string | null;
  reserveBedrooms: number | null;
  reserveInterestType: string | null;
  reserveFollowUpMoment: string | null;
  reserveCommercialNotes: string | null;
} {
  const m = rowReserveToPatch(row);
  return {
    reserveReason: m.reason,
    reserveDesiredCity: m.desiredCity,
    reservePriceMin: m.desiredPriceMin,
    reservePriceMax: m.desiredPriceMax,
    reservePropertyType: m.propertyType,
    reserveBedrooms: m.bedrooms,
    reserveInterestType: m.interestType,
    reserveFollowUpMoment: m.followUpMoment,
    reserveCommercialNotes: m.commercialNotes,
  };
}

export async function findOrCreateConversation(
  channel: string,
  externalId: string,
  contactPhone: string | null,
  contactName: string | null,
  metaPhoneNumberId: string | null,
  leadOrigin?: LeadOriginInput | null
): Promise<ConversationRow> {
  const { enterpriseId: resolvedEnterpriseId } = await resolveEnterpriseFromLeadSource(leadOrigin ?? null);
  const rawSnapshot = leadOrigin?.rawSnapshot;
  const leadSourceJson =
    rawSnapshot && typeof rawSnapshot === 'object' && !Array.isArray(rawSnapshot) && Object.keys(rawSnapshot).length > 0
      ? rawSnapshot
      : null;

  const { rows } = await query<ConversationRow>(
    `INSERT INTO conversations (
       channel, external_contact_id, contact_phone, customer_name, meta_phone_number_id, last_message_at,
       enterprise_id, enterprise_origin_id, lead_source_raw
     )
     VALUES ($1, $2, $3, $4, $5, NOW(), $6, $7, $8::jsonb)
     ON CONFLICT (channel, external_contact_id) DO UPDATE SET
       contact_phone = COALESCE(EXCLUDED.contact_phone, conversations.contact_phone),
       customer_name = COALESCE(EXCLUDED.customer_name, conversations.customer_name),
       meta_phone_number_id = COALESCE(EXCLUDED.meta_phone_number_id, conversations.meta_phone_number_id),
       last_message_at = NOW(),
       updated_at = NOW(),
       enterprise_origin_id = COALESCE(conversations.enterprise_origin_id, EXCLUDED.enterprise_origin_id),
       lead_source_raw = COALESCE(conversations.lead_source_raw, EXCLUDED.lead_source_raw),
       enterprise_id = COALESCE(conversations.enterprise_id, EXCLUDED.enterprise_id)
     RETURNING *`,
    [
      channel,
      externalId,
      contactPhone,
      contactName,
      metaPhoneNumberId,
      resolvedEnterpriseId,
      resolvedEnterpriseId,
      leadSourceJson != null ? JSON.stringify(leadSourceJson) : null,
    ]
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

const DEFINED_LEAD_TEMPS = new Set(['frio', 'morno', 'quente']);

function isLeadTemperatureDefined(raw: string | null | undefined): boolean {
  return DEFINED_LEAD_TEMPS.has((raw || '').trim().toLowerCase());
}

function normalizeLeadTemperatureInput(raw: string | null | undefined): 'quente' | 'morno' | 'frio' | null {
  const t = (raw || '').trim().toLowerCase();
  if (t === 'quente' || t === 'morno' || t === 'frio') return t;
  return null;
}

/**
 * Funil: Novo → Qualificado quando há empreendimento e temperatura definidos.
 * Handoff e Reserva não são alterados; com handoff ativo mantém Handoff.
 */
function applyFunnelQualificationRule(args: {
  classification: string;
  enterpriseId: number | null;
  leadTemperature: string | null;
  handoff: boolean;
}): string {
  if (args.handoff) return 'Handoff';
  const c = toValidClassification(args.classification);
  if (c === 'Handoff' || c === 'Reserva') return c;
  if (c !== 'Novo') return c;
  if (args.enterpriseId == null || !isLeadTemperatureDefined(args.leadTemperature)) return c;
  return 'Qualificado';
}

export interface ConversationWithPreview extends ConversationRow {
  last_message_preview: string | null;
  enterprise_name: string | null;
}

export interface ListConversationsFilters {
  mode?: 'all' | 'ANA' | 'handoff';
  status?: string;
  enterpriseId?: number;
  search?: string;
}

export async function listConversationsWithPreview(
  channel: string = 'whatsapp',
  limit: number = 100,
  filters?: ListConversationsFilters
): Promise<ConversationWithPreview[]> {
  const conditions: string[] = ['c.channel = $1'];
  const params: unknown[] = [channel];
  let paramIndex = 2;

  if (filters?.mode === 'ANA') {
    conditions.push('(c.handoff = false OR c.handoff IS NULL)');
  } else if (filters?.mode === 'handoff') {
    conditions.push('c.handoff = true');
  }

  if (filters?.status && filters.status !== 'all' && filters.status !== '') {
    conditions.push(`c.classification = $${paramIndex}`);
    params.push(filters.status);
    paramIndex += 1;
  }

  if (filters?.enterpriseId != null) {
    conditions.push(`c.enterprise_id = $${paramIndex}`);
    params.push(filters.enterpriseId);
    paramIndex += 1;
  }

  if (filters?.search && filters.search.trim() !== '') {
    const searchTerm = `%${filters.search.trim().replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
    conditions.push(
      `(c.customer_name ILIKE $${paramIndex} OR c.contact_phone ILIKE $${paramIndex} OR EXISTS (
        SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content ILIKE $${paramIndex}
      ))`
    );
    params.push(searchTerm);
    paramIndex += 1;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const { rows } = await query<ConversationWithPreview>(
    `SELECT c.*,
      (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_preview,
      e.name AS enterprise_name
     FROM conversations c
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     ${whereClause}
     ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
     LIMIT $${paramIndex}`,
    params
  );
  return rows;
}

export async function updateClassification(
  conversationId: number,
  u: {
    enterprise_id?: number | null;
    classification?: string;
    handoff?: boolean;
    reserve?: ReserveSegmentationPatch;
    /** Só frio/morno/quente; ausente = não alterar. null no payload é ignorado (temperatura não pode voltar a NULL após definida). */
    lead_temperature?: 'quente' | 'morno' | 'frio';
  }
): Promise<ConversationRow | null> {
  const cur = await getConversationById(conversationId);
  if (!cur) return null;
  let enterprise_id = u.enterprise_id !== undefined ? u.enterprise_id : cur.enterprise_id;
  if (enterprise_id != null) {
    const ok = await getActiveEnterpriseById(enterprise_id);
    if (!ok) enterprise_id = cur.enterprise_id;
  }
  let lead_temperature = cur.lead_temperature;
  if (u.lead_temperature !== undefined && u.lead_temperature !== null) {
    const norm = normalizeLeadTemperatureInput(u.lead_temperature);
    if (norm) lead_temperature = norm;
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
  const classFinal = toValidClassification(classification);
  const classAfterFunnel = applyFunnelQualificationRule({
    classification: classFinal,
    enterpriseId: enterprise_id,
    leadTemperature: lead_temperature,
    handoff,
  });

  if (u.reserve === undefined) {
    const { rows } = await query<ConversationRow>(
      `UPDATE conversations SET enterprise_id = $1, classification = $2, handoff = $3,
       lead_temperature = $6,
       classification_before_handoff = CASE WHEN $3 = false THEN NULL ELSE COALESCE($5::text, classification_before_handoff) END,
       updated_at = NOW() WHERE id = $4 RETURNING *`,
      [enterprise_id, classAfterFunnel, handoff, conversationId, savedForHandoff, lead_temperature]
    );
    return rows[0] ?? null;
  }

  const mergedReserve = mergeReservePatch(rowReserveToPatch(cur), u.reserve);

  const { rows } = await query<ConversationRow>(
    `UPDATE conversations SET enterprise_id = $1, classification = $2, handoff = $3,
     lead_temperature = $15,
     classification_before_handoff = CASE WHEN $3 = false THEN NULL ELSE COALESCE($5::text, classification_before_handoff) END,
     reserve_reason = $6,
     reserve_desired_city = $7,
     reserve_price_min = $8,
     reserve_price_max = $9,
     reserve_property_type = $10,
     reserve_bedrooms = $11,
     reserve_interest_type = $12,
     reserve_follow_up_moment = $13,
     reserve_commercial_notes = $14,
     updated_at = NOW() WHERE id = $4 RETURNING *`,
    [
      enterprise_id,
      classAfterFunnel,
      handoff,
      conversationId,
      savedForHandoff,
      mergedReserve.reason,
      mergedReserve.desiredCity,
      mergedReserve.desiredPriceMin,
      mergedReserve.desiredPriceMax,
      mergedReserve.propertyType,
      mergedReserve.bedrooms,
      mergedReserve.interestType,
      mergedReserve.followUpMoment,
      mergedReserve.commercialNotes,
      lead_temperature,
    ]
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
  const row = rows[0];
  if (!row) return null;
  const promoted = applyFunnelQualificationRule({
    classification: row.classification,
    enterpriseId: row.enterprise_id,
    leadTemperature: row.lead_temperature,
    handoff: row.handoff ?? false,
  });
  if (promoted === toValidClassification(row.classification)) return row;
  const { rows: r2 } = await query<ConversationRow>(
    `UPDATE conversations SET classification = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
    [toValidClassification(promoted), conversationId]
  );
  return r2[0] ?? row;
}

export async function applyAnaConversationUpdate(
  conversationId: number,
  meta: {
    classification?: string;
    /** Só atualiza a coluna quando string válida; null/omitido mantém o valor atual. */
    lead_temperature?: string | null;
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
  if (typeof meta.lead_temperature === 'string') {
    const t = meta.lead_temperature.trim().toLowerCase();
    if (t === 'quente') lead_temperature = 'quente';
    else if (t === 'morno') lead_temperature = 'morno';
    else if (t === 'frio') lead_temperature = 'frio';
  }
  classification = applyFunnelQualificationRule({
    classification,
    enterpriseId: conv.enterprise_id,
    leadTemperature: lead_temperature,
    handoff,
  });
  const cn = meta.customer_name?.trim();
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
