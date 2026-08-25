import type pg from 'pg';
import { getPool, query } from '../db/pg.js';
import type { AppUser, UserRole } from '../repositories/userRepository.js';

export type AssignableResourceType =
  | 'enterprise'
  | 'broker'
  | 'conversation'
  | 'contact'
  | 'appointment';

export interface UserScopeAssignment {
  managerId: number | null;
  enterpriseIds: number[];
  brokerIds: number[];
  conversationIds: number[];
  contactIds: number[];
  appointmentIds: number[];
}

export interface AuthorizationSummary extends UserScopeAssignment {
  accessAll: boolean;
  managedCollaboratorIds: number[];
  accessibleConversationCount: number | null;
}

export class AuthorizationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message = 'Acesso negado.', status = 403, code = 'ACCESS_DENIED') {
    super(message);
    this.name = 'AuthorizationError';
    this.status = status;
    this.code = code;
  }
}

const ASSIGNMENT_TABLES = {
  enterprise: ['app_user_enterprises', 'enterprise_id'],
  broker: ['app_user_brokers', 'broker_id'],
  conversation: ['app_user_conversations', 'conversation_id'],
  contact: ['app_user_contacts', 'contact_id'],
  appointment: ['app_user_appointments', 'appointment_id'],
} as const;

const RESOURCE_TABLES = {
  enterprise: 'enterprises',
  broker: 'corretores',
  conversation: 'conversations',
  contact: 'contacts',
  appointment: 'appointments',
} as const;

type AuthorizationClient = Pick<pg.PoolClient, 'query'>;

function authorizationDb(client?: AuthorizationClient): Pick<pg.Pool, 'query'> | AuthorizationClient {
  return client ?? getPool();
}

function uniquePositive(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isSafeInteger(value) && value > 0))].sort((a, b) => a - b);
}

export function canAccessAll(user: Pick<AppUser, 'role'>): boolean {
  return user.role === 'ADMIN';
}

export function canManageUsers(user: Pick<AppUser, 'role'>): boolean {
  return user.role === 'ADMIN' || user.role === 'MANAGERIAL';
}

export async function resourceExists(resourceType: AssignableResourceType, resourceId: number, client?: AuthorizationClient): Promise<boolean> {
  if (!Number.isSafeInteger(resourceId) || resourceId < 1) return false;
  const table = RESOURCE_TABLES[resourceType];
  const { rows } = await authorizationDb(client).query<{ exists: boolean }>(`SELECT EXISTS (SELECT 1 FROM ${table} WHERE id = $1) AS exists`, [resourceId]);
  return rows[0]?.exists === true;
}

export async function getManagerId(userId: number, client?: AuthorizationClient): Promise<number | null> {
  const { rows } = await authorizationDb(client).query<{ manager_user_id: number }>(
    `SELECT manager_user_id FROM app_user_management WHERE collaborator_user_id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0]?.manager_user_id ?? null;
}

export async function getManagedCollaboratorIds(managerUserId: number, client?: AuthorizationClient): Promise<number[]> {
  const { rows } = await authorizationDb(client).query<{ collaborator_user_id: number }>(
    `SELECT collaborator_user_id
     FROM app_user_management m
     JOIN app_users u ON u.id = m.collaborator_user_id
     WHERE m.manager_user_id = $1 AND u.active = true AND u.role = 'COLLABORATOR'
     ORDER BY collaborator_user_id`,
    [managerUserId]
  );
  return rows.map((row) => row.collaborator_user_id);
}

export async function canManageTargetUser(
  actor: Pick<AppUser, 'id' | 'role'>,
  target: Pick<AppUser, 'id' | 'role'>,
  client?: AuthorizationClient
): Promise<boolean> {
  if (!canRoleManageTargetUser(actor, target)) return false;
  if (actor.role === 'ADMIN') return true;
  const managerId = await getManagerId(target.id, client);
  return managerId === actor.id;
}

export function canRoleManageTargetUser(
  actor: Pick<AppUser, 'id' | 'role'>,
  target: Pick<AppUser, 'id' | 'role'>
): boolean {
  if (actor.role === 'ADMIN') return true;
  return actor.role === 'MANAGERIAL' && target.role === 'COLLABORATOR' && actor.id !== target.id;
}

async function getRawAssignedIds(
  userId: number,
  resourceType: AssignableResourceType,
  client?: AuthorizationClient
): Promise<Array<{ id: number; source: 'ADMIN_DIRECT' | 'MANAGER' | 'LEGACY' }>> {
  const [table, column] = ASSIGNMENT_TABLES[resourceType];
  const { rows } = await authorizationDb(client).query<{ id: number; assignment_source: 'ADMIN_DIRECT' | 'MANAGER' | 'LEGACY' }>(
    `SELECT ${column}::int AS id, assignment_source FROM ${table} WHERE user_id = $1 ORDER BY ${column}`,
    [userId]
  );
  return rows.map((row) => ({ id: row.id, source: row.assignment_source }));
}

async function getEffectiveAssignedIds(user: AppUser, resourceType: AssignableResourceType, client?: AuthorizationClient): Promise<number[]> {
  const assigned = await getRawAssignedIds(user.id, resourceType, client);
  if (user.role !== 'COLLABORATOR') return uniquePositive(assigned.map((item) => item.id));

  const managerId = await getManagerId(user.id, client);
  if (managerId == null) {
    return uniquePositive(
      assigned.filter((item) => item.source === 'ADMIN_DIRECT' || item.source === 'LEGACY').map((item) => item.id)
    );
  }

  const manager = await getUserIdentity(managerId, client);
  if (!manager || manager.role !== 'MANAGERIAL' || !manager.active) {
    return uniquePositive(
      assigned.filter((item) => item.source === 'ADMIN_DIRECT' || item.source === 'LEGACY').map((item) => item.id)
    );
  }
  const managerAssigned = new Set((await getRawAssignedIds(manager.id, resourceType, client)).map((item) => item.id));
  return uniquePositive(
    assigned
      .filter(
        (item) => item.source === 'ADMIN_DIRECT' || item.source === 'LEGACY' || managerAssigned.has(item.id)
      )
      .map((item) => item.id)
  );
}

async function getUserIdentity(userId: number, client?: AuthorizationClient): Promise<AppUser | null> {
  const { rows } = await authorizationDb(client).query<{
    id: number;
    username: string | null;
    name: string;
    email: string | null;
    role: UserRole;
    active: boolean;
    must_change_password: boolean;
    broker_id: number | null;
    django_user_id: number | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, username, name, email, role, active, must_change_password,
            broker_id, django_user_id, created_at, updated_at
     FROM app_users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return rows[0] ?? null;
}

async function allIds(table: string, client?: AuthorizationClient): Promise<number[]> {
  const { rows } = await authorizationDb(client).query<{ id: number }>(`SELECT id::int AS id FROM ${table} ORDER BY id`);
  return rows.map((row) => row.id);
}

export async function getAccessibleEnterpriseIds(user: AppUser, client?: AuthorizationClient): Promise<number[]> {
  if (canAccessAll(user)) return allIds('enterprises', client);
  return getEffectiveAssignedIds(user, 'enterprise', client);
}

export async function getAccessibleBrokerIds(user: AppUser, client?: AuthorizationClient): Promise<number[]> {
  if (canAccessAll(user)) return allIds('corretores', client);
  return getEffectiveAssignedIds(user, 'broker', client);
}

export async function getAccessibleConversationIds(user: AppUser, client?: AuthorizationClient): Promise<number[]> {
  if (canAccessAll(user)) return allIds('conversations', client);

  const [enterpriseIds, brokerIds, directIds] = client
    ? [await getAccessibleEnterpriseIds(user, client), await getAccessibleBrokerIds(user, client), await getEffectiveAssignedIds(user, 'conversation', client)]
    : await Promise.all([getAccessibleEnterpriseIds(user), getAccessibleBrokerIds(user), getEffectiveAssignedIds(user, 'conversation')]);
  const { rows } = await authorizationDb(client).query<{ id: number }>(
    `SELECT c.id::int AS id
     FROM conversations c
     WHERE c.id = ANY($1::bigint[])
        OR c.enterprise_id = ANY($2::int[])
        OR c.assigned_broker_id = ANY($3::int[])
     ORDER BY c.id`,
    [directIds, enterpriseIds, brokerIds]
  );
  let ids = uniquePositive(rows.map((row) => row.id));
  const legacySessionScope = user.sessionScope;
  if (legacySessionScope?.kind === 'broker_portfolio') {
    const legacyAllowed = new Set(uniquePositive(legacySessionScope.convIds));
    ids = ids.filter((id) => legacyAllowed.has(id));
  }
  return ids;
}

export async function getAccessibleContactIds(user: AppUser, client?: AuthorizationClient): Promise<number[]> {
  if (canAccessAll(user)) return allIds('contacts', client);
  const [enterpriseIds, brokerIds, conversationIds, directIds] = client
    ? [await getAccessibleEnterpriseIds(user, client), await getAccessibleBrokerIds(user, client), await getAccessibleConversationIds(user, client), await getEffectiveAssignedIds(user, 'contact', client)]
    : await Promise.all([getAccessibleEnterpriseIds(user), getAccessibleBrokerIds(user), getAccessibleConversationIds(user), getEffectiveAssignedIds(user, 'contact')]);
  const { rows } = await authorizationDb(client).query<{ id: number }>(
    `SELECT DISTINCT c.id::int AS id
     FROM contacts c
     LEFT JOIN conversations conv ON conv.contact_id = c.id
     WHERE c.id = ANY($1::bigint[])
        OR c.enterprise_id = ANY($2::int[])
        OR c.owner_user_id = ANY($3::int[])
        OR conv.id = ANY($4::bigint[])
     ORDER BY id`,
    [directIds, enterpriseIds, brokerIds, conversationIds]
  );
  return uniquePositive(rows.map((row) => row.id));
}

export async function getAccessibleAppointmentIds(user: AppUser, client?: AuthorizationClient): Promise<number[]> {
  if (canAccessAll(user)) return allIds('appointments', client);
  const [enterpriseIds, brokerIds, conversationIds, directIds] = client
    ? [await getAccessibleEnterpriseIds(user, client), await getAccessibleBrokerIds(user, client), await getAccessibleConversationIds(user, client), await getEffectiveAssignedIds(user, 'appointment', client)]
    : await Promise.all([getAccessibleEnterpriseIds(user), getAccessibleBrokerIds(user), getAccessibleConversationIds(user), getEffectiveAssignedIds(user, 'appointment')]);
  const { rows } = await authorizationDb(client).query<{ id: number }>(
    `SELECT a.id::int AS id
     FROM appointments a
     WHERE a.id = ANY($1::int[])
        OR a.enterprise_id = ANY($2::int[])
        OR a.broker_id = ANY($3::int[])
        OR a.conversation_id = ANY($4::bigint[])
     ORDER BY a.id`,
    [directIds, enterpriseIds, brokerIds, conversationIds]
  );
  return uniquePositive(rows.map((row) => row.id));
}

async function includesId(getIds: () => Promise<number[]>, id: number): Promise<boolean> {
  if (!Number.isSafeInteger(id) || id < 1) return false;
  return (await getIds()).includes(id);
}

export async function canAccessEnterprise(user: AppUser, enterpriseId: number): Promise<boolean> {
  return canAccessAll(user) || includesId(() => getAccessibleEnterpriseIds(user), enterpriseId);
}

export async function canAccessBroker(user: AppUser, brokerId: number): Promise<boolean> {
  return canAccessAll(user) || includesId(() => getAccessibleBrokerIds(user), brokerId);
}

export async function canAccessConversation(user: AppUser, conversationId: number): Promise<boolean> {
  return canAccessAll(user) || includesId(() => getAccessibleConversationIds(user), conversationId);
}

export async function canAccessContact(user: AppUser, contactId: number): Promise<boolean> {
  return canAccessAll(user) || includesId(() => getAccessibleContactIds(user), contactId);
}

export async function canAccessAppointment(user: AppUser, appointmentId: number): Promise<boolean> {
  return canAccessAll(user) || includesId(() => getAccessibleAppointmentIds(user), appointmentId);
}

export function canViewDashboard(user: Pick<AppUser, 'active'>): boolean {
  return user.active === true;
}

export async function canAssignResource(
  actor: AppUser,
  target: AppUser,
  resourceType: AssignableResourceType,
  resourceId: number
): Promise<boolean> {
  if (!(await resourceExists(resourceType, resourceId))) return false;
  if (actor.role === 'ADMIN') return true;
  if (actor.role !== 'MANAGERIAL' || target.role !== 'COLLABORATOR') return false;
  if (!(await canManageTargetUser(actor, target))) return false;
  switch (resourceType) {
    case 'enterprise': return canAccessEnterprise(actor, resourceId);
    case 'broker': return canAccessBroker(actor, resourceId);
    case 'conversation': return canAccessConversation(actor, resourceId);
    case 'contact': return canAccessContact(actor, resourceId);
    case 'appointment': return canAccessAppointment(actor, resourceId);
  }
}

export async function assertCanAccessResource(
  user: AppUser,
  resourceType: AssignableResourceType,
  resourceId: number
): Promise<void> {
  const allowed =
    resourceType === 'enterprise' ? await canAccessEnterprise(user, resourceId) :
    resourceType === 'broker' ? await canAccessBroker(user, resourceId) :
    resourceType === 'conversation' ? await canAccessConversation(user, resourceId) :
    resourceType === 'contact' ? await canAccessContact(user, resourceId) :
    await canAccessAppointment(user, resourceId);
  if (!allowed) throw new AuthorizationError('Recurso não encontrado no seu escopo.', 404, 'OUT_OF_SCOPE');
}

export async function getUserScopeAssignment(userId: number, client?: AuthorizationClient): Promise<UserScopeAssignment> {
  const [managerId, enterprises, brokers, conversations, contacts, appointments] = client
    ? [
        await getManagerId(userId, client),
        await getRawAssignedIds(userId, 'enterprise', client),
        await getRawAssignedIds(userId, 'broker', client),
        await getRawAssignedIds(userId, 'conversation', client),
        await getRawAssignedIds(userId, 'contact', client),
        await getRawAssignedIds(userId, 'appointment', client),
      ] as const
    : await Promise.all([
        getManagerId(userId), getRawAssignedIds(userId, 'enterprise'), getRawAssignedIds(userId, 'broker'),
        getRawAssignedIds(userId, 'conversation'), getRawAssignedIds(userId, 'contact'), getRawAssignedIds(userId, 'appointment'),
      ]);
  return {
    managerId,
    enterpriseIds: uniquePositive(enterprises.map((item) => item.id)),
    brokerIds: uniquePositive(brokers.map((item) => item.id)),
    conversationIds: uniquePositive(conversations.map((item) => item.id)),
    contactIds: uniquePositive(contacts.map((item) => item.id)),
    appointmentIds: uniquePositive(appointments.map((item) => item.id)),
  };
}

export async function getAuthorizationSummary(user: AppUser): Promise<AuthorizationSummary> {
  const [assignment, managedCollaboratorIds, accessibleConversationIds] = await Promise.all([
    getUserScopeAssignment(user.id),
    user.role === 'MANAGERIAL' ? getManagedCollaboratorIds(user.id) : Promise.resolve([]),
    canAccessAll(user) ? Promise.resolve(null) : getAccessibleConversationIds(user),
  ]);
  return {
    ...assignment,
    accessAll: canAccessAll(user),
    managedCollaboratorIds,
    accessibleConversationCount: accessibleConversationIds?.length ?? null,
  };
}

function scrubAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrubAuditMetadata);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !/(password|senha|hash|token|secret)/i.test(key))
      .map(([key, child]) => [key, scrubAuditMetadata(child)])
  );
}

export async function recordAccessAudit(input: {
  actorUserId: number | null;
  targetUserId?: number | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | number | null;
  metadata?: Record<string, unknown>;
}, client?: pg.PoolClient): Promise<void> {
  const db = client ?? getPool();
  await db.query(
    `INSERT INTO app_access_audit
       (actor_user_id, target_user_id, action, resource_type, resource_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      input.actorUserId,
      input.targetUserId ?? null,
      input.action,
      input.resourceType ?? null,
      input.resourceId == null ? null : String(input.resourceId),
      JSON.stringify(scrubAuditMetadata(input.metadata ?? {})),
    ]
  );
}

async function replaceAssignments(
  client: pg.PoolClient,
  targetUserId: number,
  actor: AppUser,
  resourceType: AssignableResourceType,
  ids: number[]
): Promise<void> {
  const [table, column] = ASSIGNMENT_TABLES[resourceType];
  if (actor.role === 'ADMIN') {
    await client.query(`DELETE FROM ${table} WHERE user_id = $1`, [targetUserId]);
  } else {
    await client.query(
      `DELETE FROM ${table} WHERE user_id = $1 AND assignment_source = 'MANAGER' AND assigned_by_user_id = $2`,
      [targetUserId, actor.id]
    );
  }
  const source = actor.role === 'ADMIN' ? 'ADMIN_DIRECT' : 'MANAGER';
  for (const id of uniquePositive(ids)) {
    await client.query(
      `INSERT INTO ${table} (user_id, ${column}, assigned_by_user_id, assignment_source)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, ${column}) DO NOTHING`,
      [targetUserId, id, actor.id, source]
    );
  }
}

export async function replaceUserScope(
  actor: AppUser,
  target: AppUser,
  scope: UserScopeAssignment,
  transactionClient?: pg.PoolClient
): Promise<void> {
  const client = transactionClient ?? await getPool().connect();
  const ownsTransaction = transactionClient == null;
  try {
    if (ownsTransaction) await client.query('BEGIN');
    if (target.role === 'COLLABORATOR') {
      if (scope.managerId == null) {
        await client.query(`DELETE FROM app_user_management WHERE collaborator_user_id = $1`, [target.id]);
      } else {
        await client.query(
          `INSERT INTO app_user_management
             (collaborator_user_id, manager_user_id, created_by_user_id, updated_at)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (collaborator_user_id) DO UPDATE SET
             manager_user_id = EXCLUDED.manager_user_id,
             created_by_user_id = EXCLUDED.created_by_user_id,
             updated_at = NOW()`,
          [target.id, scope.managerId, actor.id]
        );
      }
    } else {
      await client.query(`DELETE FROM app_user_management WHERE collaborator_user_id = $1`, [target.id]);
    }

    await replaceAssignments(client, target.id, actor, 'enterprise', scope.enterpriseIds);
    await replaceAssignments(client, target.id, actor, 'broker', scope.brokerIds);
    await replaceAssignments(client, target.id, actor, 'conversation', scope.conversationIds);
    await replaceAssignments(client, target.id, actor, 'contact', scope.contactIds);
    await replaceAssignments(client, target.id, actor, 'appointment', scope.appointmentIds);
    await recordAccessAudit({
      actorUserId: actor.id,
      targetUserId: target.id,
      action: 'USER_SCOPE_REPLACED',
      resourceType: 'user_scope',
      resourceId: target.id,
      metadata: {
        managerId: scope.managerId,
        enterpriseIds: uniquePositive(scope.enterpriseIds),
        brokerIds: uniquePositive(scope.brokerIds),
        conversationIds: uniquePositive(scope.conversationIds),
        contactIds: uniquePositive(scope.contactIds),
        appointmentIds: uniquePositive(scope.appointmentIds),
      },
    }, client);
    if (ownsTransaction) await client.query('COMMIT');
  } catch (error) {
    if (ownsTransaction) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

export async function pruneManagerDelegations(
  manager: AppUser,
  collaboratorIds: number[],
  actorUserId = manager.id,
  transactionClient?: pg.PoolClient
): Promise<number> {
  if (manager.role !== 'MANAGERIAL' || collaboratorIds.length === 0) return 0;
  const [enterpriseIds, brokerIds, conversationIds, contactIds, appointmentIds] = transactionClient
    ? [
        await getAccessibleEnterpriseIds(manager, transactionClient),
        await getAccessibleBrokerIds(manager, transactionClient),
        await getAccessibleConversationIds(manager, transactionClient),
        await getAccessibleContactIds(manager, transactionClient),
        await getAccessibleAppointmentIds(manager, transactionClient),
      ]
    : await Promise.all([
        getAccessibleEnterpriseIds(manager), getAccessibleBrokerIds(manager), getAccessibleConversationIds(manager),
        getAccessibleContactIds(manager), getAccessibleAppointmentIds(manager),
      ]);
  const allowed: Array<[AssignableResourceType, number[]]> = [
    ['enterprise', enterpriseIds], ['broker', brokerIds], ['conversation', conversationIds],
    ['contact', contactIds], ['appointment', appointmentIds],
  ];
  const client = transactionClient ?? await getPool().connect();
  const ownsTransaction = transactionClient == null;
  let removed = 0;
  try {
    if (ownsTransaction) await client.query('BEGIN');
    for (const [type, ids] of allowed) {
      const [table, column] = ASSIGNMENT_TABLES[type];
      const result = await client.query(
        `DELETE FROM ${table}
         WHERE user_id = ANY($1::int[])
           AND assigned_by_user_id = $2
           AND assignment_source = 'MANAGER'
           AND NOT (${column} = ANY($3::bigint[]))`,
        [collaboratorIds, manager.id, ids]
      );
      removed += result.rowCount ?? 0;
    }
    if (removed > 0) {
      await recordAccessAudit({
        actorUserId,
        targetUserId: manager.id,
        action: 'MANAGER_DELEGATIONS_PRUNED',
        resourceType: 'user_scope',
        metadata: { collaboratorIds, removed },
      }, client);
    }
    if (ownsTransaction) await client.query('COMMIT');
    return removed;
  } catch (error) {
    if (ownsTransaction) await client.query('ROLLBACK');
    throw error;
  } finally {
    if (ownsTransaction) client.release();
  }
}

export async function listAssignableResources(user: AppUser): Promise<{
  enterprises: Array<{ id: number; name: string }>;
  brokers: Array<{ id: number; name: string; active: boolean }>;
}> {
  const [enterpriseIds, brokerIds] = await Promise.all([
    getAccessibleEnterpriseIds(user),
    getAccessibleBrokerIds(user),
  ]);
  const [enterprises, brokers] = await Promise.all([
    query<{ id: number; name: string }>(
      `SELECT id, name FROM enterprises WHERE id = ANY($1::int[]) AND status = 'ativo' ORDER BY name`,
      [enterpriseIds]
    ),
    query<{ id: number; name: string; active: boolean }>(
      `SELECT id, full_name AS name, active FROM corretores WHERE id = ANY($1::int[]) ORDER BY full_name`,
      [brokerIds]
    ),
  ]);
  return { enterprises: enterprises.rows, brokers: brokers.rows };
}
