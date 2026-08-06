import { query } from '../db/pg.js';
import { getInboxGlobalRoom, getSocketServer } from './socketServer.js';
import { getSessionUser } from '../repositories/userRepository.js';
import { canAccessConversation } from '../services/authorizationService.js';

export interface RealtimeConversationPayload {
  id: string;
  channel: string;
  externalContactId: string;
  contactPhone: string | null;
  contactName: string | null;
  whatsappDisplayName: string | null;
  customerName: string | null;
  status: 'open';
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  projectId: number | null;
  projectName: string | null;
  enterpriseId: number | null;
  enterpriseName: string | null;
  classificationStatus: string;
  handoff: boolean;
  attendanceMode: 'ana' | 'handoff';
  leadStage: 'HOT' | 'WARM' | 'COLD' | null;
  createdAt: string;
  updatedAt: string;
  reserveReason: string | null;
  reserveDesiredCity: string | null;
  reservePriceMin: number | null;
  reservePriceMax: number | null;
  reservePropertyType: string | null;
  reserveBedrooms: number | null;
  reserveInterestType: string | null;
  reserveFollowUpMoment: string | null;
  reserveCommercialNotes: string | null;
  assignedBrokerId: number | null;
  assignedBrokerName: string | null;
  brokerNotificationStatus: string | null;
  brokerPushNotificationStatus: string | null;
  conversationType: string;
  manualClosedAt: string | null;
  manualClosedByUserId: number | null;
  manualClosedReason: string | null;
}

export interface RealtimeMessagePayload {
  id: string;
  conversationId: number;
  role: 'user' | 'assistant';
  content: string | null;
  metaMessageId: string | null;
  messageKind: 'text' | 'document' | 'image' | 'video';
  attachment: unknown | null;
  createdAt: string;
  deleted: boolean;
  deletedAt: string | null;
}

interface ConversationRealtimeRow {
  id: number;
  channel: string;
  external_contact_id: string;
  contact_phone: string | null;
  customer_name: string | null;
  whatsapp_display_name: string | null;
  enterprise_id: number | null;
  enterprise_name: string | null;
  classification: string | null;
  lead_temperature: string | null;
  handoff: boolean;
  created_at: Date;
  updated_at: Date;
  last_message_at: Date | null;
  last_message_preview: string | null;
  reserve_reason: string | null;
  reserve_desired_city: string | null;
  reserve_price_min: number | null;
  reserve_price_max: number | null;
  reserve_property_type: string | null;
  reserve_bedrooms: number | null;
  reserve_interest_type: string | null;
  reserve_follow_up_moment: string | null;
  reserve_commercial_notes: string | null;
  assigned_broker_id: number | null;
  assigned_broker_name: string | null;
  broker_notification_status: string | null;
  broker_push_notification_status: string | null;
  conversation_type: string | null;
  manual_closed_at: Date | null;
  manual_closed_by_user_id: number | null;
  manual_closed_reason: string | null;
}

function toLeadStage(value: string | null): 'HOT' | 'WARM' | 'COLD' | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (normalized === 'quente') return 'HOT';
  if (normalized === 'morno') return 'WARM';
  if (normalized === 'frio') return 'COLD';
  return null;
}

async function buildConversationPayload(conversationId: number): Promise<RealtimeConversationPayload | null> {
  const { rows } = await query<ConversationRealtimeRow>(
    `SELECT
       c.id,
       c.channel,
       c.external_contact_id,
       c.contact_phone,
       c.customer_name,
       c.whatsapp_display_name,
       c.enterprise_id,
       e.name AS enterprise_name,
       c.classification,
       c.lead_temperature,
       c.handoff,
       c.created_at,
       c.updated_at,
       c.last_message_at,
       (
         SELECT m.content
         FROM messages m
         WHERE m.conversation_id = c.id
         ORDER BY m.created_at DESC, m.id DESC
         LIMIT 1
       ) AS last_message_preview,
       c.reserve_reason,
       c.reserve_desired_city,
       c.reserve_price_min,
       c.reserve_price_max,
       c.reserve_property_type,
       c.reserve_bedrooms,
       c.reserve_interest_type,
       c.reserve_follow_up_moment,
       c.reserve_commercial_notes,
       c.assigned_broker_id,
       b.full_name AS assigned_broker_name,
       c.broker_notification_status,
       c.broker_push_notification_status,
       COALESCE(c.conversation_type, 'CLIENT') AS conversation_type,
       c.manual_closed_at,
       c.manual_closed_by_user_id,
       c.manual_closed_reason
     FROM conversations c
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     LEFT JOIN corretores b ON b.id = c.assigned_broker_id
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     WHERE c.id = $1
     LIMIT 1`,
    [conversationId]
  );
  const row = rows[0];
  if (!row) return null;
  const isHandoff = row.handoff === true || row.classification === 'Handoff';
  return {
    id: String(row.id),
    channel: row.channel,
    externalContactId: row.external_contact_id,
    contactPhone: row.contact_phone,
    contactName:
      row.whatsapp_display_name?.trim() ||
      row.customer_name?.trim() ||
      row.contact_phone ||
      row.external_contact_id,
    whatsappDisplayName: row.whatsapp_display_name ?? null,
    customerName: row.customer_name ?? null,
    status: 'open',
    lastMessageAt: row.last_message_at?.toISOString() ?? null,
    lastMessagePreview: row.last_message_preview ?? null,
    projectId: row.enterprise_id,
    projectName: row.enterprise_name,
    enterpriseId: row.enterprise_id,
    enterpriseName: row.enterprise_name,
    classificationStatus: isHandoff ? 'Handoff' : (row.classification ?? 'Novo'),
    handoff: isHandoff,
    attendanceMode: isHandoff ? 'handoff' : 'ana',
    leadStage: toLeadStage(row.lead_temperature),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    reserveReason: row.reserve_reason ?? null,
    reserveDesiredCity: row.reserve_desired_city ?? null,
    reservePriceMin: row.reserve_price_min ?? null,
    reservePriceMax: row.reserve_price_max ?? null,
    reservePropertyType: row.reserve_property_type ?? null,
    reserveBedrooms: row.reserve_bedrooms ?? null,
    reserveInterestType: row.reserve_interest_type ?? null,
    reserveFollowUpMoment: row.reserve_follow_up_moment ?? null,
    reserveCommercialNotes: row.reserve_commercial_notes ?? null,
    assignedBrokerId: row.assigned_broker_id ?? null,
    assignedBrokerName: row.assigned_broker_name ?? null,
    brokerNotificationStatus: row.broker_notification_status ?? null,
    brokerPushNotificationStatus: row.broker_push_notification_status ?? null,
    conversationType: row.conversation_type ?? 'CLIENT',
    manualClosedAt: row.manual_closed_at?.toISOString() ?? null,
    manualClosedByUserId: row.manual_closed_by_user_id ?? null,
    manualClosedReason: row.manual_closed_reason ?? null,
  };
}

export async function publishAccessControlledRealtimeEvent<T>(event: string, payload: T, conversationId?: number): Promise<void> {
  try {
    const io = getSocketServer();
    if (!io) return;

    const room = getInboxGlobalRoom();
    const sockets = io.sockets.adapter.rooms.get(room);
    if (!sockets) return;

    // ── Scope filtering para eventos de conversa ──
    if (conversationId != null) {
      for (const socketId of sockets) {
        const socket = io.sockets.sockets.get(socketId);
        if (!socket) continue;

        const token = typeof socket.data.sessionToken === 'string' ? socket.data.sessionToken : '';
        const user = token ? await getSessionUser(token) : null;
        if (!user || user.must_change_password) {
          socket.emit('auth.revoked', { reason: user ? 'password_change_required' : 'session_invalid' });
          socket.disconnect(true);
          continue;
        }
        if (!(await canAccessConversation(user, conversationId))) continue;

        const scope = socket.data.sessionScope;
        if (scope && scope.kind === 'broker_portfolio') {
          // Lista vazia → nunca recebe push de conversa nova
          if (!scope.convIds.includes(conversationId)) continue;
        }
        socket.emit(event, payload);
      }
    } else {
      // Sem recurso identificável: somente ADMIN recebe o evento.
      for (const socketId of sockets) {
        const socket = io.sockets.sockets.get(socketId);
        if (!socket) continue;
        const token = typeof socket.data.sessionToken === 'string' ? socket.data.sessionToken : '';
        const user = token ? await getSessionUser(token) : null;
        if (!user || user.must_change_password) {
          socket.emit('auth.revoked', { reason: user ? 'password_change_required' : 'session_invalid' });
          socket.disconnect(true);
          continue;
        }
        if (user.role === 'ADMIN') socket.emit(event, payload);
      }
    }
  } catch (error) {
    console.warn('[Realtime] publish_emit_failed', {
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function publishConversationCreated(conversationId: number): Promise<void> {
  try {
    const payload = await buildConversationPayload(conversationId);
    if (!payload) return;
    console.info('[Realtime] publish conversation.created', { conversationId });
    await publishAccessControlledRealtimeEvent('conversation.created', payload, conversationId);
  } catch (error) {
    console.warn('[Realtime] publishConversationCreated_failed', {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function publishConversationUpdated(conversationId: number): Promise<void> {
  try {
    const payload = await buildConversationPayload(conversationId);
    if (!payload) return;
    console.info('[Realtime] publish conversation.updated', { conversationId });
    await publishAccessControlledRealtimeEvent('conversation.updated', payload, conversationId);
  } catch (error) {
    console.warn('[Realtime] publishConversationUpdated_failed', {
      conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function publishMessageCreated(message: RealtimeMessagePayload): void {
  try {
    const direction = message.role === 'user' ? 'inbound' : 'outbound';
    console.info('[Realtime] publish message.created', {
      conversationId: message.conversationId,
      messageId: message.id,
      direction,
    });
    void publishAccessControlledRealtimeEvent('message.created', message, message.conversationId);
  } catch (error) {
    console.warn('[Realtime] publishMessageCreated_failed', {
      conversationId: message.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function publishMessageUpdated(payload: {
  id: string;
  conversationId: number;
  deleted?: boolean;
  deletedAt?: string | null;
}): void {
  try {
    void publishAccessControlledRealtimeEvent('message.updated', payload, payload.conversationId);
  } catch (error) {
    console.warn('[Realtime] publishMessageUpdated_failed', {
      conversationId: payload.conversationId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
