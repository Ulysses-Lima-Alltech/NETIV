import { query } from '../db/pg.js';
import type { MobileAuthUser } from './mobileAuthService.js';

type MobileConversationStatus = 'ANA' | 'HUMAN';

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

type ConversationRow = {
  id: number;
  client_name: string | null;
  enterprise_name: string | null;
  last_message: string | null;
  status: MobileConversationStatus;
  needs_human: boolean;
  assigned_broker_name: string | null;
};

function normalizeDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

async function resolveCorretorIdFromMobileUser(user: MobileAuthUser): Promise<number | null> {
  const phoneDigits = normalizeDigits(user.phone);
  if (!phoneDigits) return null;

  const result = await query<{ id: number }>(
    `SELECT id
     FROM corretores
     WHERE active = true
       AND regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = $1
     ORDER BY id ASC`,
    [phoneDigits]
  );

  if (result.rows.length !== 1) {
    if (result.rows.length > 1) {
      console.warn('[mobile-conversations] corretor mapping ambíguo por telefone', {
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

async function listConversationsByScope(conditionSql: string, values: unknown[]): Promise<MobileConversationItem[]> {
  const result = await query<ConversationRow>(
    `SELECT
       c.id,
       COALESCE(
         NULLIF(BTRIM(c.customer_name), ''),
         NULLIF(BTRIM(ct.first_name), ''),
         NULLIF(BTRIM(ct.full_name), ''),
         NULLIF(BTRIM(c.whatsapp_display_name), ''),
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
     ORDER BY c.last_message_at DESC NULLS LAST, c.updated_at DESC
     LIMIT 200`,
    values
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    clientName: row.client_name ?? 'Cliente',
    enterpriseName: row.enterprise_name ?? 'Sem empreendimento',
    lastMessage: row.last_message ?? 'Sem mensagens recentes',
    status: row.status,
    needsHuman: row.needs_human === true,
    unread: false,
    assignedBrokerName: row.assigned_broker_name ?? null,
  }));
}

export async function getMobileConversations(user: MobileAuthUser): Promise<MobileConversationsResponse> {
  if (user.role === 'CORRETOR') {
    const corretorId = await resolveCorretorIdFromMobileUser(user);
    if (!corretorId) {
      console.warn('[mobile-conversations] corretor sem vínculo confiável, retorno vazio', {
        mobileUserId: user.id,
      });
      return { conversations: [] };
    }

    const conversations = await listConversationsByScope('c.assigned_broker_id = $1', [corretorId]);
    return { conversations };
  }

  if (user.role === 'GESTOR') {
    const enterpriseIds = await getManagedEnterpriseIds(user.id);
    if (enterpriseIds.length === 0) {
      return { conversations: [] };
    }

    const conversations = await listConversationsByScope('c.enterprise_id = ANY($1::int[])', [enterpriseIds]);
    return { conversations };
  }

  const conversations = await listConversationsByScope('TRUE', []);
  return { conversations };
}
