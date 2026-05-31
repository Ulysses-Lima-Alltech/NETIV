import { query } from '../db/pg.js';
import type { MobileAuthUser } from './mobileAuthService.js';

export type MobileVisitItem = {
  id: string;
  time: string;
  clientName: string;
  enterpriseName: string;
  status: string;
  assignedBrokerName: string | null;
};

export type MobileVisitsResponse = {
  visits: MobileVisitItem[];
};

type AppointmentListRow = {
  id: number;
  start_at: Date;
  customer_name: string;
  enterprise_name: string | null;
  status: string;
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
      console.warn('[mobile-visits] corretor mapping ambiguo por telefone', {
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
      console.warn('[mobile-visits] corretor sem vinculo confiavel', {
        mobileUserId: user.id,
      });
      return { ok: false };
    }
    return { ok: true, conditionSql: 'a.broker_id = $1', values: [corretorId] };
  }

  if (user.role === 'GESTOR') {
    const enterpriseIds = await getManagedEnterpriseIds(user.id);
    if (enterpriseIds.length === 0) {
      return { ok: false };
    }
    return { ok: true, conditionSql: 'a.enterprise_id = ANY($1::int[])', values: [enterpriseIds] };
  }

  return { ok: true, conditionSql: 'TRUE', values: [] };
}

export async function getMobileVisits(user: MobileAuthUser): Promise<MobileVisitsResponse> {
  const scope = await resolveScopeFilter(user);
  if (!scope.ok) return { visits: [] };

  const result = await query<AppointmentListRow>(
    `SELECT
       a.id,
       a.start_at,
       a.customer_name,
       e.name AS enterprise_name,
       a.status,
       b.full_name AS assigned_broker_name
     FROM appointments a
     LEFT JOIN enterprises e ON e.id = a.enterprise_id
     LEFT JOIN corretores b ON b.id = a.broker_id
     WHERE ${scope.conditionSql}
     ORDER BY a.start_at DESC
     LIMIT 200`,
    scope.values
  );

  return {
    visits: result.rows.map((row) => ({
      id: String(row.id),
      time: row.start_at.toISOString(),
      clientName: (row.customer_name ?? '').trim() || 'Cliente',
      enterpriseName: (row.enterprise_name ?? '').trim() || 'Sem empreendimento',
      status: row.status,
      assignedBrokerName: row.assigned_broker_name ?? null,
    })),
  };
}
