import { query } from '../db/pg.js';
import type { MobileAuthUser } from './mobileAuthService.js';

type TeamRole = 'CORRETOR' | 'GESTOR' | 'ADM';

export type MobileTeamEnterpriseLink = {
  enterpriseId: string;
  enterpriseName: string;
  manageable: boolean;
  label: string | null;
};

export type MobileTeamMember = {
  id: string;
  name: string;
  phone: string | null;
  role: TeamRole;
  active: boolean;
  enterprises: MobileTeamEnterpriseLink[];
};

export type MobileTeamResponse = {
  members: MobileTeamMember[];
};

type CorretorEnterpriseRow = {
  corretor_id: number;
  corretor_name: string;
  corretor_phone: string | null;
  corretor_active: boolean;
  enterprise_id: number | null;
  enterprise_name: string | null;
};

type MobileManagerEnterpriseRow = {
  mobile_user_id: number;
  mobile_user_name: string;
  mobile_user_phone: string | null;
  mobile_user_role: TeamRole;
  mobile_user_active: boolean;
  enterprise_id: number | null;
  enterprise_name: string | null;
};

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

function manageableLabel(manageable: boolean): string {
  return manageable ? 'Gerenciavel' : 'Somente visualizacao';
}

function pushEnterpriseLink(
  map: Map<string, MobileTeamMember>,
  memberKey: string,
  memberBase: Omit<MobileTeamMember, 'enterprises'>,
  enterpriseId: number | null,
  enterpriseName: string | null,
  manageable: boolean
): void {
  if (!map.has(memberKey)) {
    map.set(memberKey, { ...memberBase, enterprises: [] });
  }

  if (enterpriseId == null || !enterpriseName) return;

  const member = map.get(memberKey);
  if (!member) return;

  const linkId = String(enterpriseId);
  const alreadyAdded = member.enterprises.some((enterprise) => enterprise.enterpriseId === linkId);
  if (alreadyAdded) return;

  member.enterprises.push({
    enterpriseId: linkId,
    enterpriseName,
    manageable,
    label: manageableLabel(manageable),
  });
}

async function getGestorMembers(user: MobileAuthUser): Promise<MobileTeamMember[]> {
  const managedEnterpriseIds = await getManagedEnterpriseIds(user.id);
  if (managedEnterpriseIds.length === 0) return [];

  const rows = await query<CorretorEnterpriseRow>(
    `SELECT
       c.id AS corretor_id,
       c.full_name AS corretor_name,
       c.phone AS corretor_phone,
       c.active AS corretor_active,
       ce.enterprise_id,
       e.name AS enterprise_name
     FROM corretores c
     LEFT JOIN corretor_empreendimentos ce ON ce.corretor_id = c.id
     LEFT JOIN enterprises e ON e.id = ce.enterprise_id
     WHERE c.id = ANY(
       SELECT DISTINCT ce2.corretor_id
       FROM corretor_empreendimentos ce2
       WHERE ce2.enterprise_id = ANY($1::int[])
     )
     ORDER BY c.full_name ASC, e.name ASC`,
    [managedEnterpriseIds]
  );

  const managedSet = new Set<number>(managedEnterpriseIds);
  const members = new Map<string, MobileTeamMember>();

  for (const row of rows.rows) {
    const memberKey = `corretor:${row.corretor_id}`;
    pushEnterpriseLink(
      members,
      memberKey,
      {
        id: memberKey,
        name: row.corretor_name,
        phone: row.corretor_phone ?? null,
        role: 'CORRETOR',
        active: row.corretor_active === true,
      },
      row.enterprise_id,
      row.enterprise_name,
      row.enterprise_id != null ? managedSet.has(row.enterprise_id) : false
    );
  }

  return Array.from(members.values());
}

async function getAdmCorretorMembers(): Promise<MobileTeamMember[]> {
  const rows = await query<CorretorEnterpriseRow>(
    `SELECT
       c.id AS corretor_id,
       c.full_name AS corretor_name,
       c.phone AS corretor_phone,
       c.active AS corretor_active,
       ce.enterprise_id,
       e.name AS enterprise_name
     FROM corretores c
     LEFT JOIN corretor_empreendimentos ce ON ce.corretor_id = c.id
     LEFT JOIN enterprises e ON e.id = ce.enterprise_id
     ORDER BY c.full_name ASC, e.name ASC`
  );

  const members = new Map<string, MobileTeamMember>();

  for (const row of rows.rows) {
    const memberKey = `corretor:${row.corretor_id}`;
    pushEnterpriseLink(
      members,
      memberKey,
      {
        id: memberKey,
        name: row.corretor_name,
        phone: row.corretor_phone ?? null,
        role: 'CORRETOR',
        active: row.corretor_active === true,
      },
      row.enterprise_id,
      row.enterprise_name,
      true
    );
  }

  return Array.from(members.values());
}

async function getAdmMobileManagerMembers(): Promise<MobileTeamMember[]> {
  const rows = await query<MobileManagerEnterpriseRow>(
    `SELECT
       mu.id AS mobile_user_id,
       mu.name AS mobile_user_name,
       mu.phone AS mobile_user_phone,
       mu.role AS mobile_user_role,
       mu.is_active AS mobile_user_active,
       mue.enterprise_id,
       e.name AS enterprise_name
     FROM mobile_users mu
     LEFT JOIN mobile_user_enterprises mue ON mue.user_id = mu.id
     LEFT JOIN enterprises e ON e.id = mue.enterprise_id
     WHERE mu.role IN ('GESTOR', 'ADM')
     ORDER BY mu.name ASC, e.name ASC`
  );

  const members = new Map<string, MobileTeamMember>();

  for (const row of rows.rows) {
    const role = row.mobile_user_role === 'GESTOR' ? 'GESTOR' : 'ADM';
    const memberKey = `mobile:${row.mobile_user_id}`;
    pushEnterpriseLink(
      members,
      memberKey,
      {
        id: memberKey,
        name: row.mobile_user_name,
        phone: row.mobile_user_phone ?? null,
        role,
        active: row.mobile_user_active === true,
      },
      row.enterprise_id,
      row.enterprise_name,
      true
    );
  }

  return Array.from(members.values());
}

export async function getMobileTeam(user: MobileAuthUser): Promise<MobileTeamResponse> {
  if (user.role === 'CORRETOR') {
    return { members: [] };
  }

  if (user.role === 'GESTOR') {
    const members = await getGestorMembers(user);
    return { members };
  }

  const [corretorMembers, managerMembers] = await Promise.all([
    getAdmCorretorMembers(),
    getAdmMobileManagerMembers(),
  ]);

  return {
    members: [...corretorMembers, ...managerMembers],
  };
}
