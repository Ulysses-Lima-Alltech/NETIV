import { query } from '../db/pg.js';
import { getActiveEnterpriseById } from './enterpriseRepository.js';
import { getCorretorById } from './corretorRepository.js';
import { assignBrokerForHandoffConversation } from '../services/handoffQueueService.js';
import type { LeadOriginInput } from '../services/leadOriginResolver.js';
import { resolveEnterpriseFromLeadSource } from '../services/leadOriginResolver.js';
import type { CommercialFlowState } from '../utils/commercialFlowState.js';

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
  assigned_broker_id?: number | null;
  /** Quantidade aproximada de menções ao nome do cliente nas respostas da Ana (incremento por mensagem). */
  ana_customer_name_mentions?: number;
  /** Quando preenchido, handoff será aplicado após esse instante (pós-agendamento). */
  handoff_deferred_until?: Date | null;
  handoff_deferred_broker_id?: number | null;
  /** JSON: etapa comercial, última listagem, inferência de foco (continuidade em mensagens curtas). */
  commercial_flow_state?: unknown;
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

/**
 * Exclui TODAS as conversas de um número de telefone (contact_phone ou external_contact_id).
 * Mensagens e logs são removidos via CASCADE.
 * Retorna a quantidade de conversas removidas.
 */
export async function deleteAllConversationsByPhone(phone: string): Promise<number> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return 0;
  const result = await query(
    `DELETE FROM conversations
     WHERE contact_phone = $1
        OR external_contact_id = $1
        OR contact_phone = $2
        OR external_contact_id = $2`,
    [phone.trim(), digits]
  );
  return result.rowCount ?? 0;
}

const VALID_CLASSIFICATIONS = new Set(['Novo', 'Qualificado', 'Carteira', 'Handoff']);

function toValidClassification(s: string | null | undefined): string {
  const t = (s || '').trim();
  if (t === 'Interessado' || t === 'Qualificando') return 'Qualificado';
  if (t === 'Reserva') return 'Carteira';
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

const LEAD_TEMP_RANK: Record<'frio' | 'morno' | 'quente', number> = { frio: 0, morno: 1, quente: 2 };

/**
 * Retorna a maior temperatura entre os valores válidos (frio < morno < quente).
 * Usado na atualização via ANA: nunca rebaixa quente→morno por resposta inconsistente do modelo.
 */
export function maxLeadTemperature(
  ...vals: (string | null | undefined)[]
): 'quente' | 'morno' | 'frio' | null {
  let best: 'quente' | 'morno' | 'frio' | null = null;
  let bestR = -1;
  for (const v of vals) {
    const t = normalizeLeadTemperatureInput(v == null ? undefined : String(v));
    if (!t) continue;
    const r = LEAD_TEMP_RANK[t];
    if (r > bestR) {
      bestR = r;
      best = t;
    }
  }
  return best;
}

/**
 * Funil: Novo → Qualificado quando há empreendimento e temperatura definidos.
 * Handoff e Carteira não são alterados; com handoff ativo mantém Handoff.
 */
function applyFunnelQualificationRule(args: {
  classification: string;
  enterpriseId: number | null;
  leadTemperature: string | null;
  handoff: boolean;
}): string {
  if (args.handoff) return 'Handoff';
  const c = toValidClassification(args.classification);
  if (c === 'Handoff' || c === 'Carteira') return c;
  if (c !== 'Novo') return c;
  if (args.enterpriseId == null || !isLeadTemperatureDefined(args.leadTemperature)) return c;
  return 'Qualificado';
}

export interface ConversationWithPreview extends ConversationRow {
  last_message_preview: string | null;
  enterprise_name: string | null;
  assigned_broker_name?: string | null;
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
      e.name AS enterprise_name,
      br.full_name AS assigned_broker_name
     FROM conversations c
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     LEFT JOIN corretores br ON br.id = c.assigned_broker_id
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
    /** Corretor fixo da conversa; null limpa. Só aplica se o id existir. */
    assigned_broker_id?: number | null;
  }
): Promise<ConversationRow | null> {
  const cur = await getConversationById(conversationId);
  if (!cur) return null;
  const wasHandoff = cur.handoff === true;
  let assigned_broker_id = cur.assigned_broker_id ?? null;
  if (u.assigned_broker_id !== undefined) {
    if (u.assigned_broker_id === null) {
      assigned_broker_id = null;
    } else {
      const br = await getCorretorById(u.assigned_broker_id);
      if (br) assigned_broker_id = u.assigned_broker_id;
    }
  }
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
       assigned_broker_id = $7,
       updated_at = NOW() WHERE id = $4 RETURNING *`,
      [enterprise_id, classAfterFunnel, handoff, conversationId, savedForHandoff, lead_temperature, assigned_broker_id]
    );
    const row = rows[0] ?? null;
    if (row) {
      if (handoff) await assignBrokerForHandoffConversation(conversationId);
    }
    return row;
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
     assigned_broker_id = $16,
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
      assigned_broker_id,
    ]
  );
  const row = rows[0] ?? null;
  if (row) {
    if (handoff) await assignBrokerForHandoffConversation(conversationId);
  }
  return row;
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
    const incoming = normalizeLeadTemperatureInput(meta.lead_temperature);
    if (incoming) {
      lead_temperature = maxLeadTemperature(conv.lead_temperature, incoming) ?? incoming;
    }
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
  if (handoff) await assignBrokerForHandoffConversation(conversationId);
}

/** Persiste o JSON de estado comercial (objeto completo vindo de `computeNextCommercialFlowState`). */
export async function mergeConversationCommercialFlowState(
  conversationId: number,
  nextState: CommercialFlowState
): Promise<void> {
  await query(`UPDATE conversations SET commercial_flow_state = $1::jsonb, updated_at = NOW() WHERE id = $2`, [
    JSON.stringify(nextState),
    conversationId,
  ]);
}

/**
 * Após confirmação de agendamento: agenda handoff para 5 minutos (permite reagendar sem ir para humano na hora).
 */
export async function scheduleDeferredHandoffAfterAppointment(
  conversationId: number,
  brokerId: number | null
): Promise<void> {
  await query(
    `UPDATE conversations SET
       handoff_deferred_until = NOW() + INTERVAL '5 minutes',
       handoff_deferred_broker_id = $1,
       assigned_broker_id = CASE WHEN $1 IS NOT NULL AND $1 > 0 THEN COALESCE(assigned_broker_id, $1) ELSE assigned_broker_id END,
       updated_at = NOW()
     WHERE id = $2`,
    [brokerId, conversationId]
  );
}

/** Processa conversas com handoff diferido vencido (chamado periodicamente no servidor). */
export async function processDueDeferredHandoffs(): Promise<number> {
  const { rows } = await query<{ id: number; handoff_deferred_broker_id: number | null }>(
    `SELECT id, handoff_deferred_broker_id FROM conversations
     WHERE handoff_deferred_until IS NOT NULL
       AND handoff_deferred_until <= NOW()
       AND handoff = false`
  );
  for (const r of rows) {
    await applyHandoffAfterAppointmentConfirmation(r.id, r.handoff_deferred_broker_id);
  }
  return rows.length;
}

/**
 * Modo handoff real + corretor alinhado ao agendamento (sem redistribuir se já definido).
 * Limpa colunas de handoff diferido.
 */
export async function applyHandoffAfterAppointmentConfirmation(
  conversationId: number,
  brokerId: number | null
): Promise<void> {
  const conv = await getConversationById(conversationId);
  if (!conv) return;
  const saveBeforeHandoff = conv.classification !== 'Handoff' ? toValidClassification(conv.classification) : null;
  await query(
    `UPDATE conversations SET classification = 'Handoff', lead_temperature = $1, handoff = true,
     classification_before_handoff = CASE WHEN $2::text IS NOT NULL THEN $2::text ELSE classification_before_handoff END,
     handoff_deferred_until = NULL,
     handoff_deferred_broker_id = NULL,
     updated_at = NOW() WHERE id = $3`,
    [conv.lead_temperature, saveBeforeHandoff, conversationId]
  );
  if (brokerId != null && brokerId > 0) {
    await query(`UPDATE conversations SET assigned_broker_id = $1, updated_at = NOW() WHERE id = $2`, [
      brokerId,
      conversationId,
    ]);
    await query(`UPDATE corretores SET last_assigned_at = NOW(), updated_at = NOW() WHERE id = $1`, [brokerId]);
  } else {
    await assignBrokerForHandoffConversation(conversationId);
  }
}

export async function incrementAnaCustomerNameMentions(conversationId: number, delta: number): Promise<void> {
  if (delta <= 0) return;
  await query(
    `UPDATE conversations SET ana_customer_name_mentions = ana_customer_name_mentions + $1, updated_at = NOW() WHERE id = $2`,
    [delta, conversationId]
  );
}
