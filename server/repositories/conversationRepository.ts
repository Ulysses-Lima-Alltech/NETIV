import { getPool, query } from '../db/pg.js';
import { getActiveEnterpriseById } from './enterpriseRepository.js';
import { getCorretorById } from './corretorRepository.js';
import { assignConversationToNextBroker } from '../services/brokerAssignmentService.js';
import { notifyDjango, buildLeadPayload } from '../services/djangoWebhook.js';
import { logAutoHandoffBlocked } from '../utils/autoHandoffPolicy.js';
import type { LeadOriginInput } from '../services/leadOriginResolver.js';
import { resolveEnterpriseFromLeadSource } from '../services/leadOriginResolver.js';
import { parseCommercialFlowState, type CommercialFlowState } from '../utils/commercialFlowState.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import {
  assignContactToConversation,
  findContactById,
  findOrCreateContactByPhone,
  trySyncContactEnterpriseFromLinkedConversations,
} from './contactsRepository.js';
import {
  publishConversationCreated,
  publishConversationUpdated,
} from '../realtime/realtimePublisher.js';

export type { LeadOriginInput } from '../services/leadOriginResolver.js';

export interface ConversationRow {
  id: number;
  conversation_type?: 'CLIENT' | 'CORRETOR' | 'ADMIN' | string | null;
  channel: string;
  external_contact_id: string;
  contact_phone: string | null;
  customer_name: string | null;
  /** Nome de perfil do WhatsApp — só para listagem interna; não usar como nome confirmado. */
  whatsapp_display_name?: string | null;
  /** Se a Ana já fez a pergunta inicial pelo nome confirmado (evita repetir a mesma abordagem). */
  ana_asked_customer_name?: boolean;
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
  contact_id?: number | null;
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
  assigned_broker_at?: Date | null;
  handoff_reason?: string | null;
  handoff_requested_at?: Date | null;
  broker_notified_at?: Date | null;
  broker_notification_status?: string | null;
  broker_notification_error?: string | null;
  broker_notification_template?: string | null;
  broker_push_notified_at?: Date | null;
  broker_push_notification_status?: string | null;
  broker_push_notification_error?: string | null;
  /** Quantidade aproximada de menções ao nome do cliente nas respostas da Ana (incremento por mensagem). */
  ana_customer_name_mentions?: number;
  /** Quando preenchido, handoff será aplicado após esse instante (pós-agendamento). */
  handoff_deferred_until?: Date | null;
  handoff_deferred_broker_id?: number | null;
  /** JSON: etapa comercial, última listagem, inferência de foco (continuidade em mensagens curtas). */
  commercial_flow_state?: unknown;
  /** Campos de reengajamento manual e automático */
  manual_closed_at?: Date | null;
  manual_closed_by_user_id?: number | null;
  manual_closed_reason?: string | null;
  reengagement_sent_at?: Date | null;
  reengagement_for_user_message_id?: number | null;
  reengagement_count?: number;
  pending_resolution_choice?: boolean;
  pending_resolution_reason?: string | null;
  pending_resolution_intent?: string | null;
  pending_resolution_created_at?: Date | null;
  pending_resolution_payload?: unknown;
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
  metaPhoneNumberId: string | null,
  leadOrigin?: LeadOriginInput | null,
  opts?: { whatsappDisplayName?: string | null } | null
): Promise<ConversationRow> {
  let effectiveExternalId = externalId;
  let effectiveContactPhone = contactPhone;
  if (channel === 'whatsapp') {
    const canon = normalizePhoneE164(contactPhone ?? externalId) ?? String(externalId ?? '').replace(/\D/g, '');
    if (canon) {
      effectiveExternalId = canon;
      effectiveContactPhone = canon;
    }
  }
  const existingBefore = await query<{ id: number }>(
    `SELECT id FROM conversations WHERE channel = $1 AND external_contact_id = $2 LIMIT 1`,
    [channel, effectiveExternalId]
  );
  const createdNow = !existingBefore.rows[0];
  const normalizedPhone = normalizePhoneE164(effectiveContactPhone ?? effectiveExternalId);
  const contact =
    normalizedPhone != null
      ? await findOrCreateContactByPhone({
          phoneE164: normalizedPhone,
          phoneDisplay: effectiveContactPhone ?? effectiveExternalId,
          fullName: opts?.whatsappDisplayName ?? null,
          source: 'whatsapp',
        })
      : null;
  const { enterpriseId: resolvedEnterpriseId } = await resolveEnterpriseFromLeadSource(leadOrigin ?? null);
  const rawSnapshot = leadOrigin?.rawSnapshot;
  const leadSourceJson =
    rawSnapshot && typeof rawSnapshot === 'object' && !Array.isArray(rawSnapshot) && Object.keys(rawSnapshot).length > 0
      ? rawSnapshot
      : null;

  const waName = (opts?.whatsappDisplayName ?? '').trim() || null;

  const { rows } = await query<ConversationRow>(
    `INSERT INTO conversations (
       channel, external_contact_id, contact_phone, customer_name, whatsapp_display_name, meta_phone_number_id, contact_id, last_message_at,
       enterprise_id, enterprise_origin_id, lead_source_raw, lead_temperature
     )
     VALUES ($1, $2, $3, NULL, $4, $5, $6, NOW(), $7, $8, $9::jsonb, 'frio')
     ON CONFLICT (channel, external_contact_id) DO UPDATE SET
       contact_phone = COALESCE(EXCLUDED.contact_phone, conversations.contact_phone),
       whatsapp_display_name = CASE
         WHEN EXCLUDED.whatsapp_display_name IS NOT NULL AND length(trim(EXCLUDED.whatsapp_display_name)) > 0
         THEN trim(EXCLUDED.whatsapp_display_name)
         ELSE conversations.whatsapp_display_name
       END,
       meta_phone_number_id = COALESCE(EXCLUDED.meta_phone_number_id, conversations.meta_phone_number_id),
       contact_id = COALESCE(conversations.contact_id, EXCLUDED.contact_id),
       last_message_at = NOW(),
       updated_at = NOW(),
       enterprise_origin_id = COALESCE(conversations.enterprise_origin_id, EXCLUDED.enterprise_origin_id),
       lead_source_raw = COALESCE(conversations.lead_source_raw, EXCLUDED.lead_source_raw),
       enterprise_id = COALESCE(conversations.enterprise_id, EXCLUDED.enterprise_id)
     RETURNING *`,
    [
      channel,
      effectiveExternalId,
      effectiveContactPhone,
      waName,
      metaPhoneNumberId,
      contact?.id ?? null,
      resolvedEnterpriseId,
      resolvedEnterpriseId,
      leadSourceJson != null ? JSON.stringify(leadSourceJson) : null,
    ]
  );
  const conv = rows[0];
  if (contact?.id && conv.id) {
    await assignContactToConversation(conv.id, contact.id);
  }
  if (conv?.id) {
    if (createdNow) void publishConversationCreated(conv.id);
    else void publishConversationUpdated(conv.id);
  }
  return conv;
}

async function clearNonHandoffAssignedBroker(conversationId: number): Promise<void> {
  const { rows } = await query<{
    conversation_id: number;
    contact_id: number | null;
    previous_assigned_broker_id: number;
    contact_owner_user_id: number | null;
  }>(
    `WITH target AS (
       SELECT
         conv.id AS conversation_id,
         conv.contact_id,
         conv.assigned_broker_id AS previous_assigned_broker_id,
         ct.owner_user_id AS contact_owner_user_id
       FROM conversations conv
       LEFT JOIN contacts ct ON ct.id = conv.contact_id
       WHERE conv.id = $1
         AND conv.assigned_broker_id IS NOT NULL
         AND COALESCE(conv.handoff, false) = false
         AND COALESCE(conv.classification, '') <> 'Handoff'
       FOR UPDATE
     )
     UPDATE conversations conv
     SET assigned_broker_id = NULL,
         assigned_broker_at = NULL,
         broker_notified_at = NULL,
         broker_notification_status = NULL,
         broker_notification_error = NULL,
         broker_notification_template = NULL,
         broker_push_notified_at = NULL,
         broker_push_notification_status = NULL,
         broker_push_notification_error = NULL,
         updated_at = NOW()
     FROM target t
     WHERE conv.id = t.conversation_id
     RETURNING
       t.conversation_id,
       t.contact_id,
       t.previous_assigned_broker_id,
       t.contact_owner_user_id`,
    [conversationId]
  );

  for (const row of rows) {
    if (
      row.contact_id != null &&
      row.contact_owner_user_id != null &&
      row.previous_assigned_broker_id === row.contact_owner_user_id
    ) {
      console.log('[CONTACT_OWNER_NOT_COPIED_TO_CONVERSATION_ASSIGNED_BROKER]', {
        conversationId: row.conversation_id,
        contactId: row.contact_id,
        contactOwnerUserId: row.contact_owner_user_id,
      });
    }
  }
}

export async function getConversationById(id: number): Promise<ConversationRow | null> {
  await clearNonHandoffAssignedBroker(id);
  const { rows } = await query<ConversationRow>(`SELECT * FROM conversations WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function findLatestWhatsAppConversationByPhoneDigits(phoneDigits: string): Promise<ConversationRow | null> {
  const digits = (phoneDigits || '').replace(/\D/g, '');
  if (!digits) return null;
  const { rows } = await query<ConversationRow>(
    `SELECT *
     FROM conversations
     WHERE channel = 'whatsapp'
       AND (
         regexp_replace(COALESCE(contact_phone, ''), '\D', '', 'g') = $1
         OR regexp_replace(COALESCE(external_contact_id, ''), '\D', '', 'g') = $1
       )
     ORDER BY updated_at DESC
     LIMIT 1`,
    [digits]
  );
  return rows[0] ?? null;
}

type ConversationDeleteClient = {
  query: <T = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<{ rows: T[]; rowCount: number | null }>;
};

interface ConversationDeleteSnapshot {
  id: number;
  contact_id: number | null;
  enterprise_id: number | null;
  enterprise_origin_id?: number | null;
  lead_source_raw?: unknown | null;
}

interface ContactDeleteSnapshot {
  id: number;
  enterprise_id: number | null;
  enterprise_interest: string | null;
}

interface ConversationDeleteAudit {
  conversationId: number;
  contactId: number | null;
  previousConversationEnterpriseId: number | null;
  previousConversationEnterpriseOriginId: number | null;
  previousConversationLeadSourceRaw: unknown | null;
  previousContactEnterpriseId: number | null;
  previousContactEnterpriseInterest: string | null;
  contactUnlinked: boolean;
  strategy: 'delete' | 'hard_reset';
  deletedRows: Record<string, number>;
}

async function hardResetConversationForDelete(
  client: ConversationDeleteClient,
  conversationId: number
): Promise<Record<string, number>> {
  const deletedRows: Record<string, number> = {};

  deletedRows.information_gap_tickets =
    (await client.query(`DELETE FROM information_gap_tickets WHERE conversation_id = $1`, [conversationId])).rowCount ?? 0;
  deletedRows.ana_turn_audit =
    (await client.query(`DELETE FROM ana_turn_audit WHERE conversation_id = $1`, [conversationId])).rowCount ?? 0;
  deletedRows.conversation_state =
    (await client.query(`DELETE FROM conversation_state WHERE conversation_id = $1`, [conversationId])).rowCount ?? 0;
  deletedRows.sent_files_log =
    (await client.query(`DELETE FROM sent_files_log WHERE conversation_id = $1`, [conversationId])).rowCount ?? 0;
  deletedRows.messages =
    (await client.query(`DELETE FROM messages WHERE conversation_id = $1`, [conversationId])).rowCount ?? 0;
  deletedRows.appointments_unlinked =
    (await client.query(`UPDATE appointments SET conversation_id = NULL, updated_at = NOW() WHERE conversation_id = $1`, [
      conversationId,
    ])).rowCount ?? 0;

  return deletedRows;
}

async function resetConversationCommercialStateForDelete(
  client: ConversationDeleteClient,
  conversationId: number
): Promise<boolean> {
  const result = await client.query(
    `UPDATE conversations SET
       customer_name = NULL,
       ana_asked_customer_name = false,
       enterprise_id = NULL,
       enterprise_origin_id = NULL,
       lead_source_raw = NULL,
       classification = 'Novo',
       classification_before_handoff = NULL,
       lead_temperature = NULL,
       handoff = false,
       reserve_reason = NULL,
       reserve_desired_city = NULL,
       reserve_price_min = NULL,
       reserve_price_max = NULL,
       reserve_property_type = NULL,
       reserve_bedrooms = NULL,
       reserve_interest_type = NULL,
       reserve_follow_up_moment = NULL,
       reserve_commercial_notes = NULL,
       assigned_broker_id = NULL,
       assigned_broker_at = NULL,
       handoff_reason = NULL,
       handoff_requested_at = NULL,
       broker_notified_at = NULL,
       broker_notification_status = NULL,
       broker_notification_error = NULL,
       broker_notification_template = NULL,
       broker_push_notified_at = NULL,
       broker_push_notification_status = NULL,
       broker_push_notification_error = NULL,
       ana_customer_name_mentions = 0,
       handoff_deferred_until = NULL,
       handoff_deferred_broker_id = NULL,
       commercial_flow_state = '{}'::jsonb,
       manual_closed_at = NULL,
       manual_closed_by_user_id = NULL,
       manual_closed_reason = NULL,
       reengagement_sent_at = NULL,
       reengagement_for_user_message_id = NULL,
       reengagement_count = 0,
       updated_at = NOW()
     WHERE id = $1`,
    [conversationId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteConversationInTransaction(
  client: ConversationDeleteClient,
  id: number
): Promise<ConversationDeleteAudit | null> {
  const { rows } = await client.query<ConversationDeleteSnapshot>(
    `SELECT id, contact_id, enterprise_id, enterprise_origin_id, lead_source_raw
     FROM conversations
     WHERE id = $1
     FOR UPDATE`,
    [id]
  );
  const conversation = rows[0] ?? null;
  if (!conversation) return null;

  let contact: ContactDeleteSnapshot | null = null;
  if (conversation.contact_id != null) {
    const contactResult = await client.query<ContactDeleteSnapshot>(
      `SELECT id, enterprise_id, enterprise_interest
       FROM contacts
       WHERE id = $1
       FOR UPDATE`,
      [conversation.contact_id]
    );
    contact = contactResult.rows[0] ?? null;
  }

  const deletedRows = await hardResetConversationForDelete(client, id);

  let strategy: ConversationDeleteAudit['strategy'] = 'delete';
  await client.query('SAVEPOINT delete_conversation_row');
  try {
    const deleteResult = await client.query(`DELETE FROM conversations WHERE id = $1`, [id]);
    deletedRows.conversations = deleteResult.rowCount ?? 0;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT delete_conversation_row');
    strategy = 'hard_reset';
    deletedRows.conversations = 0;
    const reset = await resetConversationCommercialStateForDelete(client, id);
    deletedRows.conversations_reset = reset ? 1 : 0;
  } finally {
    await client.query('RELEASE SAVEPOINT delete_conversation_row');
  }

  let contactUnlinked = false;
  if (contact != null) {
    const contactUpdate = await client.query(
      `UPDATE contacts
       SET enterprise_id = NULL,
           enterprise_interest = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [contact.id]
    );
    contactUnlinked = (contactUpdate.rowCount ?? 0) > 0;
  }

  return {
    conversationId: conversation.id,
    contactId: conversation.contact_id ?? null,
    previousConversationEnterpriseId: conversation.enterprise_id ?? null,
    previousConversationEnterpriseOriginId: conversation.enterprise_origin_id ?? null,
    previousConversationLeadSourceRaw: conversation.lead_source_raw ?? null,
    previousContactEnterpriseId: contact?.enterprise_id ?? null,
    previousContactEnterpriseInterest: contact?.enterprise_interest ?? null,
    contactUnlinked,
    strategy,
    deletedRows,
  };
}

export interface ConversationManualClassificationOverrides {
  temperature: boolean;
  enterprise: boolean;
}

export function getConversationManualClassificationOverrides(
  rawState: unknown
): ConversationManualClassificationOverrides {
  const state = parseCommercialFlowState(rawState);
  const record = state && typeof state === 'object' ? (state as Record<string, unknown>) : null;
  return {
    temperature: record?.manualTemperatureOverride === true,
    enterprise: record?.manualEnterpriseOverride === true,
  };
}

async function markConversationManualClassificationOverrides(
  conversationId: number,
  opts: { temperature?: boolean; enterprise?: boolean }
): Promise<void> {
  let expr = `COALESCE(commercial_flow_state, '{}'::jsonb)`;
  if (opts.temperature) {
    expr = `jsonb_set(${expr}, '{manualTemperatureOverride}', 'true'::jsonb, true)`;
  }
  if (opts.enterprise) {
    expr = `jsonb_set(${expr}, '{manualEnterpriseOverride}', 'true'::jsonb, true)`;
  }
  if (!opts.temperature && !opts.enterprise) return;
  await query(
    `UPDATE conversations
       SET commercial_flow_state = ${expr},
           updated_at = NOW()
     WHERE id = $1`,
    [conversationId]
  );
}

/** Exclui a conversa e limpa o vínculo comercial do contato relacionado. Retorna true se excluiu/resetou. */
export async function deleteConversation(id: number): Promise<boolean> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const audit = await deleteConversationInTransaction(client, id);
    if (!audit) {
      await client.query('ROLLBACK');
      return false;
    }
    await client.query('COMMIT');
    console.log('[WhatsApp] DELETE conversation hard cleanup:', audit);
    return true;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Exclui TODAS as conversas de um número de telefone (contact_phone ou external_contact_id).
 * Mensagens e logs são removidos via CASCADE.
 * Retorna a quantidade de conversas removidas.
 */
/**
 * Zera apenas dados operacionais/comerciais da conversa; mantém mensagens, anexos e identidade do canal.
 * `commercial_flow_state` volta ao objeto vazio (coluna NOT NULL no banco).
 */
export async function resetConversationState(id: number): Promise<boolean> {
  const result = await query(
    `UPDATE conversations SET
       customer_name = NULL,
       ana_asked_customer_name = false,
       enterprise_id = NULL,
       classification = 'Novo',
       classification_before_handoff = NULL,
       lead_temperature = NULL,
       handoff = false,
       reserve_reason = NULL,
       reserve_desired_city = NULL,
       reserve_price_min = NULL,
       reserve_price_max = NULL,
       reserve_property_type = NULL,
       reserve_bedrooms = NULL,
       reserve_interest_type = NULL,
       reserve_follow_up_moment = NULL,
       reserve_commercial_notes = NULL,
       assigned_broker_id = NULL,
       assigned_broker_at = NULL,
       handoff_reason = NULL,
       handoff_requested_at = NULL,
       broker_notified_at = NULL,
       broker_notification_status = NULL,
       broker_notification_error = NULL,
       broker_notification_template = NULL,
       broker_push_notified_at = NULL,
       broker_push_notification_status = NULL,
       broker_push_notification_error = NULL,
       ana_customer_name_mentions = 0,
       handoff_deferred_until = NULL,
       handoff_deferred_broker_id = NULL,
       commercial_flow_state = '{}'::jsonb,
       manual_closed_at = NULL,
       manual_closed_by_user_id = NULL,
       manual_closed_reason = NULL,
       reengagement_sent_at = NULL,
       reengagement_for_user_message_id = NULL,
       reengagement_count = 0,
       updated_at = NOW()
     WHERE id = $1`,
    [id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function deleteAllConversationsByPhone(phone: string): Promise<number> {
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 8) return 0;
  const trimmed = phone.trim();
  const { rows: toRemove } = await query<{
    id: number;
    commercial_flow_state: unknown;
    before_messages_count: string;
  }>(
    `SELECT c.id, c.commercial_flow_state,
            (SELECT COUNT(*)::text FROM messages m WHERE m.conversation_id = c.id) AS before_messages_count
     FROM conversations c
     WHERE c.contact_phone = $1
        OR c.external_contact_id = $1
        OR c.contact_phone = $2
        OR c.external_contact_id = $2`,
    [trimmed, digits]
  );
  for (const r of toRemove) {
    const st = parseCommercialFlowState(r.commercial_flow_state) ?? {};
    console.log('[CLEAR_HISTORY]', {
      conversationId: r.id,
      beforeMessagesCount: parseInt(r.before_messages_count, 10) || 0,
      oldStage: st.stage ?? null,
      oldProductTypeHint: st.productTypeHint ?? null,
      oldLastCatalogOfferedNames: st.lastCatalogOfferedNames ?? null,
      oldLastSingleCatalogEnterpriseId: st.lastSingleCatalogEnterpriseId ?? null,
    });
  }
  const result = await query(
    `DELETE FROM conversations
     WHERE contact_phone = $1
        OR external_contact_id = $1
        OR contact_phone = $2
        OR external_contact_id = $2`,
    [trimmed, digits]
  );
  const deletedCount = result.rowCount ?? 0;
  console.log('[CLEAR_HISTORY_AFTER]', {
    removedConversationIds: toRemove.map((x) => x.id),
    deletedCount,
    newConversationIdNote: 'created_on_next_whatsapp_inbound_if_deleted',
  });
  return deletedCount;
}

const VALID_CLASSIFICATIONS = new Set([
  'Novo',
  'Qualificado',
  'Em atendimento',
  'Agendado',
  'Perdido',
  'Carteira',
  'Handoff',
]);

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

export function resolveClassificationAndHandoffTransition(args: {
  currentClassification: string | null | undefined;
  currentClassificationBeforeHandoff: string | null | undefined;
  requestedClassification: string | null | undefined;
  requestedHandoff: boolean | undefined;
}): {
  classification: string;
  handoff: boolean;
  classificationBeforeHandoff: string | null;
} {
  let classification = toValidClassification(args.requestedClassification ?? args.currentClassification ?? 'Novo');
  let handoff: boolean;
  let classificationBeforeHandoff: string | null = null;
  if (args.requestedHandoff !== undefined) {
    handoff = Boolean(args.requestedHandoff);
    if (handoff) {
      if (classification !== 'Handoff') classificationBeforeHandoff = toValidClassification(classification);
      classification = 'Handoff';
    } else {
      const restored = (args.currentClassificationBeforeHandoff ?? '').trim();
      const candidate = toValidClassification(restored || 'Novo');
      classification = candidate === 'Handoff' ? 'Novo' : candidate;
      classificationBeforeHandoff = null;
    }
  } else {
    handoff = classification === 'Handoff';
  }
  if (!handoff && classification === 'Handoff') classification = 'Novo';
  return { classification, handoff, classificationBeforeHandoff };
}

export interface ConversationWithPreview extends ConversationRow {
  last_message_preview: string | null;
  enterprise_name: string | null;
  assigned_broker_name?: string | null;
  broker_notification_status?: string | null;
  broker_push_notification_status?: string | null;
  conversation_type?: 'CLIENT' | 'CORRETOR' | 'ADMIN' | string | null;
}

export interface ListConversationsFilters {
  mode?: 'all' | 'ANA' | 'handoff';
  status?: string;
  enterpriseId?: number;
  search?: string;
  brokerId?: number;  // NOVO — filtra por assigned_broker_id
  conversationTypeFilter?: 'CLIENT' | 'INTERNO';
  scopeConvIds?: number[];  // NOVO — filtra por whitelist de IDs de conversa (broker scope)
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
      `(c.customer_name ILIKE $${paramIndex} OR c.whatsapp_display_name ILIKE $${paramIndex} OR c.contact_phone ILIKE $${paramIndex} OR EXISTS (
        SELECT 1 FROM messages m WHERE m.conversation_id = c.id AND m.content ILIKE $${paramIndex}
      ))`
    );
    params.push(searchTerm);
    paramIndex += 1;
  }

  if (filters?.brokerId != null) {
    conditions.push(`c.assigned_broker_id = $${paramIndex}`);
    params.push(filters.brokerId);
    paramIndex += 1;
  }

  if (filters?.conversationTypeFilter === 'CLIENT') {
    conditions.push(`COALESCE(c.conversation_type, 'CLIENT') = $${paramIndex}`);
    params.push('CLIENT');
    paramIndex += 1;
  } else if (filters?.conversationTypeFilter === 'INTERNO') {
    conditions.push(`COALESCE(c.conversation_type, 'CLIENT') IN ('ADMIN', 'CORRETOR')`);
  }

  // ── Scope filtering (broker portfolio) ──
  if (filters?.scopeConvIds && filters.scopeConvIds.length > 0) {
    conditions.push(`c.id = ANY($${paramIndex})`);
    params.push(filters.scopeConvIds);
    paramIndex += 1;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit);

  const { rows } = await query<ConversationWithPreview>(
    `SELECT c.*,
      (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_preview,
      e.name AS enterprise_name,
      br.full_name AS assigned_broker_name,
      c.conversation_type AS conversation_type
     FROM conversations c
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     LEFT JOIN corretores br ON br.id = c.assigned_broker_id
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     ${whereClause}
     ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
     LIMIT $${paramIndex}`,
    params
  );
  return rows;
}

/** Uma linha no mesmo formato da listagem (preview + JOINs), por id. */
export async function getConversationWithPreviewById(id: number): Promise<ConversationWithPreview | null> {
  await clearNonHandoffAssignedBroker(id);
  const { rows } = await query<ConversationWithPreview>(
    `SELECT c.*,
      (SELECT m.content FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) AS last_message_preview,
      e.name AS enterprise_name,
      br.full_name AS assigned_broker_name,
      c.conversation_type AS conversation_type
     FROM conversations c
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     LEFT JOIN corretores br ON br.id = c.assigned_broker_id
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.id = $1
     LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
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
  const manualTemperatureOverrideRequested = u.lead_temperature !== undefined;
  const manualEnterpriseOverrideRequested = u.enterprise_id !== undefined;
  const wasHandoff = cur.handoff === true;
  void wasHandoff;
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
  const curRow = cur as ConversationRow & { classification_before_handoff?: string | null };
  const transition = resolveClassificationAndHandoffTransition({
    currentClassification: cur.classification,
    currentClassificationBeforeHandoff: curRow.classification_before_handoff ?? null,
    requestedClassification: classification,
    requestedHandoff: u.handoff,
  });
  let handoff = transition.handoff;
  let classificationBeforeHandoff: string | null = transition.classificationBeforeHandoff;
  classification = transition.classification;
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
  const shouldClearHandoffState = u.handoff === false;
  const assignedBrokerFinal = shouldClearHandoffState ? null : assigned_broker_id;
  const manualClosedAtFinal = shouldClearHandoffState ? null : cur.manual_closed_at ?? null;
  const manualClosedByUserIdFinal = shouldClearHandoffState ? null : cur.manual_closed_by_user_id ?? null;
  const manualClosedReasonFinal = shouldClearHandoffState ? null : cur.manual_closed_reason ?? null;
  const assignedBrokerAtFinal = shouldClearHandoffState ? null : cur.assigned_broker_at ?? null;
  const handoffReasonFinal = shouldClearHandoffState ? null : cur.handoff_reason ?? null;
  const handoffRequestedAtFinal = shouldClearHandoffState ? null : cur.handoff_requested_at ?? null;
  const brokerNotifiedAtFinal = shouldClearHandoffState ? null : cur.broker_notified_at ?? null;
  const brokerNotificationStatusFinal = shouldClearHandoffState ? null : cur.broker_notification_status ?? null;
  const brokerNotificationErrorFinal = shouldClearHandoffState ? null : cur.broker_notification_error ?? null;
  const brokerNotificationTemplateFinal = shouldClearHandoffState ? null : cur.broker_notification_template ?? null;
  const brokerPushNotifiedAtFinal = shouldClearHandoffState ? null : cur.broker_push_notified_at ?? null;
  const brokerPushNotificationStatusFinal = shouldClearHandoffState
    ? null
    : cur.broker_push_notification_status ?? null;
  const brokerPushNotificationErrorFinal = shouldClearHandoffState
    ? null
    : cur.broker_push_notification_error ?? null;
  const handoffDeferredUntilFinal = shouldClearHandoffState ? null : cur.handoff_deferred_until ?? null;
  const handoffDeferredBrokerIdFinal = shouldClearHandoffState ? null : cur.handoff_deferred_broker_id ?? null;

  if (u.reserve === undefined) {
    const { rows } = await query<ConversationRow>(
      `UPDATE conversations SET enterprise_id = $1, classification = $2, handoff = $3,
       lead_temperature = $6,
       classification_before_handoff = CASE WHEN $3 = false THEN NULL ELSE COALESCE($5::text, classification_before_handoff) END,
       assigned_broker_id = $7,
       assigned_broker_at = $8,
       handoff_reason = $9,
       handoff_requested_at = $10,
       broker_notified_at = $11,
       broker_notification_status = $12,
       broker_notification_error = $13,
       broker_notification_template = $14,
       broker_push_notified_at = $15,
       broker_push_notification_status = $16,
       broker_push_notification_error = $17,
       pending_resolution_choice = CASE WHEN $3 = false THEN false ELSE pending_resolution_choice END,
       pending_resolution_reason = CASE WHEN $3 = false THEN NULL ELSE pending_resolution_reason END,
       pending_resolution_intent = CASE WHEN $3 = false THEN NULL ELSE pending_resolution_intent END,
       pending_resolution_created_at = CASE WHEN $3 = false THEN NULL ELSE pending_resolution_created_at END,
       pending_resolution_payload = CASE WHEN $3 = false THEN NULL ELSE pending_resolution_payload END,
       handoff_deferred_until = $18,
       handoff_deferred_broker_id = $19,
       manual_closed_at = $20,
       manual_closed_by_user_id = $21,
       manual_closed_reason = $22,
       updated_at = NOW() WHERE id = $4 RETURNING *`,
      [
        enterprise_id,
        classAfterFunnel,
        handoff,
        conversationId,
        savedForHandoff,
        lead_temperature,
        assignedBrokerFinal,
        assignedBrokerAtFinal,
        handoffReasonFinal,
        handoffRequestedAtFinal,
        brokerNotifiedAtFinal,
        brokerNotificationStatusFinal,
        brokerNotificationErrorFinal,
        brokerNotificationTemplateFinal,
        brokerPushNotifiedAtFinal,
        brokerPushNotificationStatusFinal,
        brokerPushNotificationErrorFinal,
        handoffDeferredUntilFinal,
        handoffDeferredBrokerIdFinal,
        manualClosedAtFinal,
        manualClosedByUserIdFinal,
        manualClosedReasonFinal,
      ]
    );
    const row = rows[0] ?? null;
    if (row) {
      await markConversationManualClassificationOverrides(conversationId, {
        temperature: manualTemperatureOverrideRequested,
        enterprise: manualEnterpriseOverrideRequested,
      });
      if (handoff) {
        const contact = row.contact_id != null ? await findContactById(row.contact_id) : null;
        notifyDjango('api/webhook/netiv-lead/', buildLeadPayload(row, {
          whatsappDisplayName: row.whatsapp_display_name ?? null,
          contactFullName: contact?.full_name ?? null,
          contactFirstName: contact?.first_name ?? null,
        }));
        await assignConversationToNextBroker({
          conversationId,
          reason: 'manual_classification_handoff',
        });
      }
      if (row.contact_id != null) await trySyncContactEnterpriseFromLinkedConversations(row.contact_id);
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
     assigned_broker_at = $17,
     handoff_reason = $18,
     handoff_requested_at = $19,
     broker_notified_at = $20,
     broker_notification_status = $21,
     broker_notification_error = $22,
     broker_notification_template = $23,
     broker_push_notified_at = $24,
     broker_push_notification_status = $25,
     broker_push_notification_error = $26,
     pending_resolution_choice = CASE WHEN $3 = false THEN false ELSE pending_resolution_choice END,
     pending_resolution_reason = CASE WHEN $3 = false THEN NULL ELSE pending_resolution_reason END,
     pending_resolution_intent = CASE WHEN $3 = false THEN NULL ELSE pending_resolution_intent END,
     pending_resolution_created_at = CASE WHEN $3 = false THEN NULL ELSE pending_resolution_created_at END,
     pending_resolution_payload = CASE WHEN $3 = false THEN NULL ELSE pending_resolution_payload END,
     handoff_deferred_until = $27,
     handoff_deferred_broker_id = $28,
     manual_closed_at = $29,
     manual_closed_by_user_id = $30,
     manual_closed_reason = $31,
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
      assignedBrokerFinal,
      assignedBrokerAtFinal,
      handoffReasonFinal,
      handoffRequestedAtFinal,
      brokerNotifiedAtFinal,
      brokerNotificationStatusFinal,
      brokerNotificationErrorFinal,
      brokerNotificationTemplateFinal,
      brokerPushNotifiedAtFinal,
      brokerPushNotificationStatusFinal,
      brokerPushNotificationErrorFinal,
      handoffDeferredUntilFinal,
      handoffDeferredBrokerIdFinal,
      manualClosedAtFinal,
      manualClosedByUserIdFinal,
      manualClosedReasonFinal,
    ]
  );
  const row = rows[0] ?? null;
  if (row) {
    await markConversationManualClassificationOverrides(conversationId, {
      temperature: manualTemperatureOverrideRequested,
      enterprise: manualEnterpriseOverrideRequested,
    });
    if (handoff) {
      const contact = row.contact_id != null ? await findContactById(row.contact_id) : null;
      notifyDjango('api/webhook/netiv-lead/', buildLeadPayload(row, {
        whatsappDisplayName: row.whatsapp_display_name ?? null,
        contactFullName: contact?.full_name ?? null,
        contactFirstName: contact?.first_name ?? null,
      }));
      await assignConversationToNextBroker({
        conversationId,
        reason: 'manual_classification_handoff',
      });
    }
    if (row.contact_id != null) await trySyncContactEnterpriseFromLinkedConversations(row.contact_id);
  }
  return row;
}

export async function setConversationEnterpriseId(
  conversationId: number,
  enterpriseId: number | null
): Promise<ConversationRow | null> {
  const current = await getConversationById(conversationId);
  if (!current) return null;
  const manualOverrides = getConversationManualClassificationOverrides(current.commercial_flow_state);
  if (manualOverrides.enterprise && current.enterprise_id !== enterpriseId) {
    return current;
  }
  if (enterpriseId != null) {
    const ok = await getActiveEnterpriseById(enterpriseId);
    if (!ok) return null;
  }
  const { rows } = await query<ConversationRow>(
    `UPDATE conversations
      SET enterprise_id = $1,
          synced_to_django_at = CASE
            WHEN enterprise_id IS DISTINCT FROM $1 THEN NULL
            ELSE synced_to_django_at
          END,
          updated_at = NOW()
    WHERE id = $2
    RETURNING *`,
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
  const afterClass =
    promoted === toValidClassification(row.classification)
      ? row
      : (await query<ConversationRow>(
          `UPDATE conversations SET classification = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
          [toValidClassification(promoted), conversationId]
        )).rows[0] ?? row;
  if (afterClass.contact_id != null) await trySyncContactEnterpriseFromLinkedConversations(afterClass.contact_id);
  return afterClass;
}

export async function setConversationLeadTemperature(
  conversationId: number,
  leadTemperature: 'quente' | 'morno' | 'frio'
): Promise<ConversationRow | null> {
  const conv = await getConversationById(conversationId);
  if (!conv) return null;
  const manualOverrides = getConversationManualClassificationOverrides(conv.commercial_flow_state);
  if (manualOverrides.temperature) return conv;
  const normalized = normalizeLeadTemperatureInput(leadTemperature);
  if (!normalized) return conv;
  if (normalizeLeadTemperatureInput(conv.lead_temperature) === normalized) return conv;
  const { rows } = await query<ConversationRow>(
    `UPDATE conversations
        SET lead_temperature = $1,
            updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [normalized, conversationId]
  );
  return rows[0] ?? conv;
}

export async function setConversationFunnelStatusAutomatic(
  conversationId: number,
  nextClassification: string
): Promise<ConversationRow | null> {
  const conv = await getConversationById(conversationId);
  if (!conv) return null;
  const normalizedNext = toValidClassification(nextClassification);
  const normalizedCurrent = toValidClassification(conv.classification);
  if (normalizedNext === normalizedCurrent) return conv;
  if (normalizedCurrent === 'Handoff' || normalizedCurrent === 'Carteira') return conv;
  if (normalizedNext === 'Handoff' || normalizedNext === 'Carteira') return conv;
  const { rows } = await query<ConversationRow>(
    `UPDATE conversations
        SET classification = $1,
            updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [normalizedNext, conversationId]
  );
  return rows[0] ?? conv;
}

export interface LeadClassificationAuditPayload {
  oldTemperature: string | null;
  newTemperature: string | null;
  oldEnterpriseId: number | null;
  newEnterpriseId: number | null;
  oldFunnelStatus: string | null;
  newFunnelStatus: string | null;
  confidence: {
    temperature: number;
    enterprise: number;
    funnel: number;
  };
  reason: {
    temperature: string;
    enterprise: string;
    ignored: string[];
  };
  applied: {
    temperature: boolean;
    enterprise: boolean;
    funnel: boolean;
  };
  ignoredReason: string | null;
  mainIntent: string;
  classifierSource: 'ai' | 'fallback';
}

export async function saveLeadClassificationAudit(
  conversationId: number,
  payload: LeadClassificationAuditPayload
): Promise<void> {
  await query(
    `UPDATE conversations
        SET commercial_flow_state = jsonb_set(
          COALESCE(commercial_flow_state, '{}'::jsonb),
          '{lastLeadClassificationAudit}',
          $1::jsonb,
          true
        ),
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify({ ...payload, at: new Date().toISOString() }), conversationId]
  );
}

export async function updateConversationType(
  conversationId: number,
  type: 'CLIENT' | 'CORRETOR' | 'ADMIN' | string
): Promise<void> {
  await query(
    `UPDATE conversations SET conversation_type = $1, updated_at = NOW() WHERE id = $2`,
    [type, conversationId]
  );
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
  const handoffAlreadyActive = conv.handoff === true || toValidClassification(conv.classification) === 'Handoff';
  const requestedAutoHandoff = !!meta.handoff || classification === 'Handoff';
  if (requestedAutoHandoff && !handoffAlreadyActive) {
    logAutoHandoffBlocked({
      origin: 'applyAnaConversationUpdate',
      conversationId,
      reason: 'ana_automatic_handoff_removed',
      requestedClassification: meta.classification ?? null,
      requestedHandoff: meta.handoff ?? null,
    });
  }
  // Regra definitiva: updates automáticos da Ana nunca podem ativar handoff.
  // Se a conversa já estiver em handoff, preserva o estado humano.
  const handoff = handoffAlreadyActive;
  if (handoff) {
    classification = 'Handoff';
  } else if (classification === 'Handoff') {
    const restored = toValidClassification(conv.classification);
    classification = restored === 'Handoff' ? 'Novo' : restored;
  }

  const manualOverrides = getConversationManualClassificationOverrides(conv.commercial_flow_state);
  let lead_temperature: 'quente' | 'morno' | 'frio' =
    normalizeLeadTemperatureInput(conv.lead_temperature) ?? 'frio';
  if (!manualOverrides.temperature && typeof meta.lead_temperature === 'string') {
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
     customer_name = CASE
       WHEN $4::text IS NOT NULL AND length(trim($4)) > 0
         AND (customer_name IS NULL OR trim(customer_name) = '')
       THEN trim($4)
       ELSE customer_name
     END,
     classification_before_handoff = CASE WHEN $3 = true AND ($6::text) IS NOT NULL THEN $6::text ELSE
       (CASE WHEN $3 = false THEN NULL ELSE classification_before_handoff END) END,
     updated_at = NOW() WHERE id = $5`,
    [classification, lead_temperature, handoff, cn ?? null, conversationId, saveBeforeHandoff ?? null]
  );
  // Sem ações automáticas de handoff neste fluxo.
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
  logAutoHandoffBlocked({
    origin: 'scheduleDeferredHandoffAfterAppointment',
    conversationId,
    reason: 'appointment_deferred_handoff_disabled',
    requestedHandoff: true,
  });
  return;
}

/** Processa conversas com handoff diferido vencido (chamado periodicamente no servidor). */
export async function processDueDeferredHandoffs(): Promise<number> {
  logAutoHandoffBlocked({
    origin: 'processDueDeferredHandoffs',
    reason: 'deferred_handoff_worker_disabled',
    requestedHandoff: true,
  });
  return 0;
}

/**
 * Modo handoff real + corretor alinhado ao agendamento (sem redistribuir se já definido).
 * Limpa colunas de handoff diferido.
 */
export async function applyHandoffAfterAppointmentConfirmation(
  conversationId: number,
  brokerId: number | null
): Promise<void> {
  logAutoHandoffBlocked({
    origin: 'applyHandoffAfterAppointmentConfirmation',
    conversationId,
    reason: 'appointment_confirmation_auto_handoff_disabled',
    requestedHandoff: true,
  });
  void brokerId;
  return;
}

export async function incrementAnaCustomerNameMentions(conversationId: number, delta: number): Promise<void> {
  if (delta <= 0) return;
  await query(
    `UPDATE conversations SET ana_customer_name_mentions = ana_customer_name_mentions + $1, updated_at = NOW() WHERE id = $2`,
    [delta, conversationId]
  );
}

/**
 * Define (ou limpa) o nome do cliente na conversa.
 * Diferente de mergeConfirmedCustomerNameIfEmpty: SEMPRE sobrescreve o valor existente.
 * Usado pelo operador via edição manual na UI.
 * Passar null ou string vazia limpa o nome (sem nome definido).
 */
export async function setConversationCustomerName(
  conversationId: number,
  name: string | null,
): Promise<boolean> {
  const trimmed = name != null ? name.trim().slice(0, 80) : null;
  const value = trimmed && trimmed.length >= 1 ? trimmed : null;
  const result = await query(
    `UPDATE conversations SET customer_name = $1, updated_at = NOW() WHERE id = $2 RETURNING id`,
    [value, conversationId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Grava nome confirmado pelo cliente (texto da conversa); não sobrescreve se já houver nome. */
export async function mergeConfirmedCustomerNameIfEmpty(conversationId: number, name: string): Promise<boolean> {
  const trimmed = name.trim();
  if (trimmed.length < 2) return false;
  const result = await query(
    `UPDATE conversations SET customer_name = $1, updated_at = NOW()
     WHERE id = $2 AND (customer_name IS NULL OR trim(customer_name) = '')
     RETURNING id`,
    [trimmed, conversationId]
  );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Marca que a Ana já endereçou a coleta do nome (evita repetir a mesma pergunta obrigatória literalmente).
 * Só aplica enquanto não há customer_name confirmado.
 */
export async function markAnaAskedForCustomerName(conversationId: number): Promise<void> {
  await query(
    `UPDATE conversations SET ana_asked_customer_name = true, updated_at = NOW()
     WHERE id = $1 AND (customer_name IS NULL OR trim(customer_name) = '')`,
    [conversationId]
  );
}

/**
 * Novo inbound do cliente: reabre conversa encerrada manualmente e inicia novo ciclo de reengajamento.
 */
export async function applyInboundUserMessageResets(conversationId: number): Promise<void> {
  await query(
    `UPDATE conversations SET
       manual_closed_at = NULL,
       manual_closed_by_user_id = NULL,
       manual_closed_reason = NULL,
       reengagement_sent_at = NULL,
       reengagement_for_user_message_id = NULL,
       updated_at = NOW()
     WHERE id = $1`,
    [conversationId]
  );
}

export async function setConversationPendingResolutionState(
  conversationId: number,
  input: {
    reason: string;
    intent?: string | null;
    payload?: Record<string, unknown> | null;
  }
): Promise<void> {
  await query(
    `UPDATE conversations
        SET pending_resolution_choice = true,
            pending_resolution_reason = $1,
            pending_resolution_intent = $2,
            pending_resolution_created_at = NOW(),
            pending_resolution_payload = $3::jsonb,
            updated_at = NOW()
      WHERE id = $4`,
    [input.reason, input.intent ?? null, JSON.stringify(input.payload ?? {}), conversationId]
  );
}

export async function clearConversationPendingResolutionState(conversationId: number): Promise<void> {
  await query(
    `UPDATE conversations
        SET pending_resolution_choice = false,
            pending_resolution_reason = NULL,
            pending_resolution_intent = NULL,
            pending_resolution_created_at = NULL,
            pending_resolution_payload = NULL,
            updated_at = NOW()
      WHERE id = $1`,
    [conversationId]
  );
}

export async function closeConversationManual(
  conversationId: number,
  byUserId: number,
  reason: string | null
): Promise<ConversationRow | null> {
  const reasonTrim = reason != null && reason.trim() ? reason.trim().slice(0, 500) : null;
  const { rows } = await query<ConversationRow>(
    `UPDATE conversations SET
       manual_closed_at = NOW(),
       manual_closed_by_user_id = $1,
       manual_closed_reason = $2,
       updated_at = NOW()
     WHERE id = $3 AND manual_closed_at IS NULL
     RETURNING *`,
    [byUserId, reasonTrim, conversationId]
  );
  return rows[0] ?? null;
}

export async function reopenConversationManual(conversationId: number): Promise<ConversationRow | null> {
  const { rows } = await query<ConversationRow>(
    `UPDATE conversations SET
       manual_closed_at = NULL,
       manual_closed_by_user_id = NULL,
       manual_closed_reason = NULL,
       updated_at = NOW()
     WHERE id = $1 AND manual_closed_at IS NOT NULL
     RETURNING *`,
    [conversationId]
  );
  return rows[0] ?? null;
}


