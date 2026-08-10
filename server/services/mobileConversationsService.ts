import { query } from '../db/pg.js';
import type { MobileAuthUser } from './mobileAuthService.js';
import { insertMessage } from '../repositories/messageRepository.js';
import { getConversationById } from '../repositories/conversationRepository.js';
import { getConversationWhatsAppWindowStatus } from './whatsappWindowService.js';
import { isMetaWindowClosedError, sendTextMessage } from './whatsappMetaService.js';
import {
  withAnaVisitFollowupConversationLock,
} from '../repositories/anaVisitFollowupJobRepository.js';
import { cancelAnaPendingAutomationForHandoff } from '../repositories/anaHandoffAutomationRepository.js';

type MobileConversationStatus = 'ANA' | 'HUMAN';
type MobileConversationFilterType = 'CLIENT' | 'INTERNO';

export type MobileConversationItem = {
  id: string;
  clientName: string;
  enterpriseName: string;
  lastMessage: string;
  status: MobileConversationStatus;
  needsHuman: boolean;
  unread: boolean;
  assignedBrokerName: string | null;
};

export type MobileConversationsResponse = {
  conversations: MobileConversationItem[];
};

export type MobileConversationDetailMessage = {
  id: string;
  from: 'client' | 'ana' | 'me' | 'system';
  direction: 'INBOUND' | 'OUTBOUND' | 'SYSTEM';
  text: string;
  createdAt: string | null;
};

export type MobileConversationDetailResponse = {
  conversation: MobileConversationItem;
  commercialDetails: {
    leadTemperature: string;
    enterpriseName: string;
    brokerName: string | null;
    visitInfo: string | null;
    statusLabel: string;
  };
  messages: MobileConversationDetailMessage[];
};

export type MobileConversationHandoffResponse = {
  conversation: {
    id: string;
    status: 'HUMAN' | 'ANA';
    needsHuman: boolean;
    assignedBrokerName: string | null;
  };
};

export type MobileConversationSendMessageResponse = {
  message: {
    id: string;
    from: 'me';
    direction: 'OUTBOUND';
    text: string;
    createdAt: string;
  };
};

export type MobileConversationSendMessageResult =
  | { ok: true; payload: MobileConversationSendMessageResponse }
  | {
      ok: false;
      code: 'NOT_FOUND' | 'WINDOW_CLOSED' | 'SEND_FAILED';
      status: number;
      message: string;
    };

type ConversationRow = {
  id: number;
  client_name: string | null;
  enterprise_name: string | null;
  last_message: string | null;
  status: MobileConversationStatus;
  needs_human: boolean;
  assigned_broker_name: string | null;
};

type ConversationDetailRow = ConversationRow & {
  lead_temperature: string | null;
};

type ConversationMessageRow = {
  id: number;
  role: string;
  content: string | null;
  created_at: Date;
};

type ScopedConversationAccessRow = {
  id: number;
  assigned_broker_name: string | null;
};

function normalizeDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

async function resolveCorretorIdFromMobileUser(user: MobileAuthUser): Promise<number | null> {
  const mappedResult = await query<{ corretor_id: number | null }>(
    `SELECT corretor_id
     FROM mobile_users
     WHERE id = $1
     LIMIT 1`,
    [user.id]
  );
  const mappedCorretorId = mappedResult.rows[0]?.corretor_id ?? null;
  if (mappedCorretorId != null) {
    const activeResult = await query<{ id: number }>(
      `SELECT id
       FROM corretores
       WHERE id = $1
         AND active = true
       LIMIT 1`,
      [mappedCorretorId]
    );
    if (activeResult.rows[0]?.id != null) {
      return activeResult.rows[0].id;
    }
  }

  const phoneDigits = normalizeDigits(user.phone);
  if (!phoneDigits) return null;

  const result = await query<{ id: number }>(
    `SELECT id
     FROM corretores
     WHERE active = true
       AND regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $1
     ORDER BY id ASC`,
    [phoneDigits]
  );

  if (result.rows.length !== 1) {
    if (result.rows.length > 1) {
      console.warn('[mobile-conversations] corretor mapping ambiguo por telefone', {
        mobileUserId: user.id,
        phoneSuffix: phoneDigits.slice(-4),
        matches: result.rows.length,
      });
    }
    return null;
  }

  return result.rows[0]?.id ?? null;
}

async function getManagedEnterpriseIds(mobileUserId: number): Promise<number[]> {
  const result = await query<{ enterprise_id: number }>(
    `SELECT enterprise_id
     FROM mobile_user_enterprises
     WHERE user_id = $1
       AND can_manage = true`,
    [mobileUserId]
  );
  return result.rows.map((row) => row.enterprise_id);
}

type ScopeFilter =
  | { ok: true; conditionSql: string; values: unknown[] }
  | { ok: false };

async function resolveScopeFilter(user: MobileAuthUser): Promise<ScopeFilter> {
  if (user.role === 'CORRETOR') {
    const corretorId = await resolveCorretorIdFromMobileUser(user);
    if (!corretorId) {
      console.warn('[mobile-conversations] corretor sem vinculo confiavel', {
        mobileUserId: user.id,
      });
      return { ok: false };
    }
    return { ok: true, conditionSql: 'c.assigned_broker_id = $1', values: [corretorId] };
  }

  if (user.role === 'GESTOR') {
    const enterpriseIds = await getManagedEnterpriseIds(user.id);
    if (enterpriseIds.length === 0) {
      return { ok: false };
    }
    return { ok: true, conditionSql: 'c.enterprise_id = ANY($1::int[])', values: [enterpriseIds] };
  }

  return { ok: true, conditionSql: 'TRUE', values: [] };
}

function mapConversationRow(row: ConversationRow): MobileConversationItem {
  return {
    id: String(row.id),
    clientName: row.client_name ?? 'Cliente',
    enterpriseName: row.enterprise_name ?? 'Sem empreendimento',
    lastMessage: row.last_message ?? 'Sem mensagens recentes',
    status: row.status,
    needsHuman: row.needs_human === true,
    unread: false,
    assignedBrokerName: row.assigned_broker_name ?? null,
  };
}

async function listConversationsByScope(
  conditionSql: string,
  values: unknown[],
  type: MobileConversationFilterType
): Promise<MobileConversationItem[]> {
  const typeConditionSql =
    type === 'INTERNO'
      ? `COALESCE(c.conversation_type, 'CLIENT') IN ('ADMIN', 'CORRETOR')`
      : `COALESCE(c.conversation_type, 'CLIENT') = 'CLIENT'`;

  const result = await query<ConversationRow>(
    `SELECT
       c.id,
       COALESCE(
         NULLIF(BTRIM(c.whatsapp_display_name), ''),
         NULLIF(BTRIM(c.customer_name), ''),
         NULLIF(BTRIM(ct.full_name), ''),
         NULLIF(BTRIM(ct.first_name), ''),
         NULLIF(BTRIM(c.contact_phone), ''),
         NULLIF(BTRIM(c.external_contact_id), '')
       ) AS client_name,
       COALESCE(NULLIF(BTRIM(e.name), ''), 'Sem empreendimento') AS enterprise_name,
       COALESCE(
         (
           SELECT m.content
           FROM messages m
           WHERE m.conversation_id = c.id
             AND m.deleted_at IS NULL
             AND NULLIF(BTRIM(m.content), '') IS NOT NULL
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 1
         ),
         'Sem mensagens recentes'
       ) AS last_message,
       CASE
         WHEN c.handoff = true OR c.classification = 'Handoff' THEN 'HUMAN'
         ELSE 'ANA'
       END AS status,
       CASE
         WHEN c.handoff = true OR c.classification = 'Handoff' THEN true
         ELSE false
       END AS needs_human,
       br.full_name AS assigned_broker_name
     FROM conversations c
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     LEFT JOIN corretores br ON br.id = c.assigned_broker_id
     WHERE ${conditionSql}
       AND ${typeConditionSql}
     ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
     LIMIT 200`,
    values
  );

  return result.rows.map(mapConversationRow);
}

export async function getMobileConversations(
  user: MobileAuthUser,
  type: MobileConversationFilterType
): Promise<MobileConversationsResponse> {
  const scope = await resolveScopeFilter(user);
  if (!scope.ok) return { conversations: [] };

  const conversations = await listConversationsByScope(scope.conditionSql, scope.values, type);
  return { conversations };
}

export async function getMobileConversationDetail(
  user: MobileAuthUser,
  conversationId: number
): Promise<MobileConversationDetailResponse | null> {
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return null;
  }

  const scope = await resolveScopeFilter(user);
  if (!scope.ok) return null;

  const scopedCondition = `${scope.conditionSql} AND c.id = $${scope.values.length + 1}`;
  const scopedValues = [...scope.values, conversationId];

  const conversationResult = await query<ConversationDetailRow>(
    `SELECT
       c.id,
       COALESCE(
         NULLIF(BTRIM(c.whatsapp_display_name), ''),
         NULLIF(BTRIM(c.customer_name), ''),
         NULLIF(BTRIM(ct.full_name), ''),
         NULLIF(BTRIM(ct.first_name), ''),
         NULLIF(BTRIM(c.contact_phone), ''),
         NULLIF(BTRIM(c.external_contact_id), '')
       ) AS client_name,
       COALESCE(NULLIF(BTRIM(e.name), ''), 'Sem empreendimento') AS enterprise_name,
       COALESCE(
         (
           SELECT m.content
           FROM messages m
           WHERE m.conversation_id = c.id
             AND m.deleted_at IS NULL
             AND NULLIF(BTRIM(m.content), '') IS NOT NULL
           ORDER BY m.created_at DESC, m.id DESC
           LIMIT 1
         ),
         'Sem mensagens recentes'
       ) AS last_message,
       CASE
         WHEN c.handoff = true OR c.classification = 'Handoff' THEN 'HUMAN'
         ELSE 'ANA'
       END AS status,
       CASE
         WHEN c.handoff = true OR c.classification = 'Handoff' THEN true
         ELSE false
       END AS needs_human,
       br.full_name AS assigned_broker_name,
       c.lead_temperature
     FROM conversations c
     LEFT JOIN contacts ct ON ct.id = c.contact_id
     LEFT JOIN enterprises e ON e.id = c.enterprise_id
     LEFT JOIN corretores br ON br.id = c.assigned_broker_id
     WHERE ${scopedCondition}
     LIMIT 1`,
    scopedValues
  );

  const row = conversationResult.rows[0];
  if (!row) return null;

  const messagesResult = await query<ConversationMessageRow>(
    `SELECT id, role, content, created_at
     FROM messages
     WHERE conversation_id = $1
       AND deleted_at IS NULL
     ORDER BY created_at ASC, id ASC`,
    [conversationId]
  );

  const statusLabel = row.status === 'HUMAN' ? 'Atendimento Humano' : 'Atendimento Autonomo';
  const messages: MobileConversationDetailMessage[] = messagesResult.rows.map((message) => {
    const normalizedRole = String(message.role ?? '').toLowerCase();
    if (normalizedRole === 'user') {
      return {
        id: String(message.id),
        from: 'client',
        direction: 'INBOUND',
        text: (message.content ?? '').trim(),
        createdAt: message.created_at ? message.created_at.toISOString() : null,
      };
    }

    if (normalizedRole === 'assistant') {
      return {
        id: String(message.id),
        from: 'me',
        direction: 'OUTBOUND',
        text: (message.content ?? '').trim(),
        createdAt: message.created_at ? message.created_at.toISOString() : null,
      };
    }

    return {
      id: String(message.id),
      from: 'system',
      direction: 'SYSTEM',
      text: (message.content ?? '').trim(),
      createdAt: message.created_at ? message.created_at.toISOString() : null,
    };
  });

  return {
    conversation: mapConversationRow(row),
    commercialDetails: {
      leadTemperature: row.lead_temperature ?? 'Em analise',
      enterpriseName: row.enterprise_name ?? 'Sem empreendimento',
      brokerName: row.assigned_broker_name ?? null,
      visitInfo: null,
      statusLabel,
    },
    messages,
  };
}

async function findScopedConversationAccess(
  user: MobileAuthUser,
  conversationId: number
): Promise<ScopedConversationAccessRow | null> {
  const scope = await resolveScopeFilter(user);
  if (!scope.ok) return null;

  const scopedCondition = `${scope.conditionSql} AND c.id = $${scope.values.length + 1}`;
  const scopedValues = [...scope.values, conversationId];

  const result = await query<ScopedConversationAccessRow>(
    `SELECT c.id, br.full_name AS assigned_broker_name
     FROM conversations c
     LEFT JOIN corretores br ON br.id = c.assigned_broker_id
     WHERE ${scopedCondition}
     LIMIT 1`,
    scopedValues
  );

  return result.rows[0] ?? null;
}

export async function setMobileConversationHandoff(
  user: MobileAuthUser,
  conversationId: number,
  handoff: boolean
): Promise<MobileConversationHandoffResponse | null> {
  if (!Number.isFinite(conversationId) || conversationId <= 0) return null;

  const scopedConversation = await findScopedConversationAccess(user, conversationId);
  if (!scopedConversation) return null;

  const row = await withAnaVisitFollowupConversationLock(conversationId, async () => {
    const updateResult = await query<{ id: number; handoff: boolean; assigned_broker_name: string | null }>(
      `UPDATE conversations c
       SET handoff = $1,
           classification = CASE
             WHEN $1 = true THEN 'Handoff'
             WHEN c.classification = 'Handoff' THEN 'Novo'
             ELSE c.classification
           END,
           updated_at = NOW()
       FROM conversations c2
       LEFT JOIN corretores br ON br.id = c2.assigned_broker_id
       WHERE c.id = c2.id
         AND c.id = $2
       RETURNING c.id, c.handoff, br.full_name AS assigned_broker_name`,
      [handoff, conversationId]
    );

    const updated = updateResult.rows[0] ?? null;
    if (updated?.handoff === true) {
      await cancelAnaPendingAutomationForHandoff({
        conversationId,
        source: 'setMobileConversationHandoff',
      });
    }
    return updated;
  });
  if (!row) return null;

  return {
    conversation: {
      id: String(row.id),
      status: row.handoff ? 'HUMAN' : 'ANA',
      needsHuman: row.handoff === true,
      assignedBrokerName: row.assigned_broker_name ?? null,
    },
  };
}

export async function createMobileConversationMessage(
  user: MobileAuthUser,
  conversationId: number,
  text: string
): Promise<MobileConversationSendMessageResult> {
  if (!Number.isFinite(conversationId) || conversationId <= 0) {
    return { ok: false, code: 'NOT_FOUND', status: 404, message: 'Conversa nao encontrada.' };
  }

  const scopedConversation = await findScopedConversationAccess(user, conversationId);
  if (!scopedConversation) {
    return { ok: false, code: 'NOT_FOUND', status: 404, message: 'Conversa nao encontrada.' };
  }

  const conversation = await getConversationById(conversationId);
  if (!conversation) {
    return { ok: false, code: 'NOT_FOUND', status: 404, message: 'Conversa nao encontrada.' };
  }

  const normalizedText = text.trim();
  const destinationPhone = String(conversation.contact_phone ?? conversation.external_contact_id ?? '').replace(/\D/g, '');
  if (!destinationPhone) {
    return {
      ok: false,
      code: 'SEND_FAILED',
      status: 400,
      message: 'Sem numero de telefone valido na conversa.',
    };
  }

  const windowStatus = await getConversationWhatsAppWindowStatus(conversationId);
  if (!windowStatus.isOpen) {
    return {
      ok: false,
      code: 'WINDOW_CLOSED',
      status: 409,
      message: 'Janela de atendimento encerrada. Envie uma mensagem padrao/template.',
    };
  }

  const sendResult = await sendTextMessage(destinationPhone, normalizedText);
  if (!sendResult.success || !sendResult.metaMessageId) {
    const failedByWindow = isMetaWindowClosedError({
      code: sendResult.code,
      message: sendResult.error,
    });

    if (failedByWindow) {
      return {
        ok: false,
        code: 'WINDOW_CLOSED',
        status: 409,
        message: 'Janela de atendimento encerrada. Envie uma mensagem padrao/template.',
      };
    }

    const status =
      typeof sendResult.code === 'number' && sendResult.code >= 400 && sendResult.code < 600
        ? sendResult.code
        : 502;
    return {
      ok: false,
      code: 'SEND_FAILED',
      status,
      message: sendResult.error || 'Falha ao enviar mensagem via WhatsApp.',
    };
  }

  const inserted = await insertMessage(conversationId, 'assistant', normalizedText, sendResult.metaMessageId);

  return {
    ok: true,
    payload: {
      message: {
        id: String(inserted.id),
        from: 'me',
        direction: 'OUTBOUND',
        text: normalizedText,
        createdAt: inserted.created_at.toISOString(),
      },
    },
  };
}
