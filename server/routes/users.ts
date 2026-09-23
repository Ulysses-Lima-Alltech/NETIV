import { Router, type Response } from 'express';
import type pg from 'pg';
import { getPool, query } from '../db/pg.js';
import {
  acquireUserAdministrationLock,
  countActiveAdmins,
  createUser,
  findByEmailIncludingInactive,
  findByIdIncludingInactive,
  findByUsernameIncludingInactive,
  listAllUsers,
  listManagedUsers,
  revokeAllSessions,
  toPublic,
  updatePassword,
  updateUser,
  wouldRemoveLastActiveAdmin,
  type AppUser,
} from '../repositories/userRepository.js';
import { createCorretor } from '../repositories/corretorRepository.js';
import { createUserSchema, updatePasswordSchema, updateUserSchema, userScopeSchema } from '../validators/users.js';
import {
  AuthorizationError,
  canAssignResource,
  canManageTargetUser,
  getManagedCollaboratorIds,
  getAuthorizationSummary,
  getUserScopeAssignment,
  listAssignableResources,
  pruneManagerDelegations,
  recordAccessAudit,
  resourceExists,
  replaceUserScope,
  type AssignableResourceType,
  type UserScopeAssignment,
} from '../services/authorizationService.js';
import { disconnectUserSockets } from '../realtime/socketServer.js';
import { disconnectSseUser } from '../services/whatsappEvents.js';

const router = Router();

async function toUserDto(user: AppUser) {
  const scope = await getAuthorizationSummary(user);
  return {
    ...toPublic(user),
    brokerId: user.broker_id,
    managerId: scope.managerId,
    scope,
    createdAt: user.created_at.toISOString(),
    updatedAt: user.updated_at.toISOString(),
  };
}

function hasAnyDirectScope(scope: UserScopeAssignment): boolean {
  return scope.enterpriseIds.length + scope.brokerIds.length + scope.conversationIds.length +
    scope.contactIds.length + scope.appointmentIds.length > 0;
}

async function validateManager(managerId: number | null): Promise<void> {
  if (managerId == null) return;
  const manager = await findByIdIncludingInactive(managerId);
  if (!manager || !manager.active || manager.role !== 'MANAGERIAL') {
    throw new AuthorizationError('Gestor responsável inválido.', 400, 'INVALID_MANAGER');
  }
}

async function assertScopeAssignable(actor: AppUser, target: AppUser, scope: UserScopeAssignment): Promise<void> {
  const current = await getUserScopeAssignment(target.id);
  const resources: Array<[AssignableResourceType, number[]]> = [
    ['enterprise', scope.enterpriseIds],
    ['broker', scope.brokerIds],
    ['conversation', scope.conversationIds],
    ['contact', scope.contactIds],
    ['appointment', scope.appointmentIds],
  ];
  for (const [type, ids] of resources) {
    for (const id of ids) {
      const existingIds = type === 'enterprise' ? current.enterpriseIds : type === 'broker' ? current.brokerIds :
        type === 'conversation' ? current.conversationIds : type === 'contact' ? current.contactIds : current.appointmentIds;
      if (existingIds.includes(id)) continue;
      if (!(await canAssignResource(actor, target, type, id))) {
        throw new AuthorizationError('Não é permitido atribuir um recurso fora do seu escopo.', 403, 'ASSIGNMENT_OUT_OF_SCOPE');
      }
    }
  }
}

async function assertScopeResourcesExist(scope: UserScopeAssignment): Promise<void> {
  const resources: Array<[AssignableResourceType, number[]]> = [
    ['enterprise', scope.enterpriseIds],
    ['broker', scope.brokerIds],
    ['conversation', scope.conversationIds],
    ['contact', scope.contactIds],
    ['appointment', scope.appointmentIds],
  ];
  for (const [type, ids] of resources) {
    for (const id of ids) {
      if (!(await resourceExists(type, id))) {
        throw new AuthorizationError('Um dos recursos informados nao existe.', 400, 'INVALID_RESOURCE');
      }
    }
  }
}

async function revokeUsersInTransaction(userIds: number[], client: pg.PoolClient): Promise<number[]> {
  const ids = [...new Set(userIds)].filter((id) => Number.isSafeInteger(id) && id > 0);
  for (const id of ids) await revokeAllSessions(id, client);
  return ids;
}

function disconnectUsers(userIds: number[], reason: string): void {
  for (const id of userIds) {
    disconnectUserSockets(id, reason);
    disconnectSseUser(id);
  }
}

async function removeInvalidRoleRelations(previous: AppUser, updated: AppUser, client: pg.PoolClient): Promise<void> {
  if (updated.role !== 'COLLABORATOR') {
    await client.query(`DELETE FROM app_user_management WHERE collaborator_user_id = $1`, [updated.id]);
    const assignmentTables = [
      'app_user_enterprises', 'app_user_brokers', 'app_user_conversations',
      'app_user_contacts', 'app_user_appointments',
    ] as const;
    for (const table of assignmentTables) {
      await client.query(`DELETE FROM ${table} WHERE user_id = $1 AND assignment_source = 'MANAGER'`, [updated.id]);
    }
  }
  if (previous.role === 'MANAGERIAL' && (updated.role !== 'MANAGERIAL' || !updated.active)) {
    await client.query(`DELETE FROM app_user_management WHERE manager_user_id = $1`, [updated.id]);
    const delegatedAssignmentTables = [
      'app_user_enterprises', 'app_user_brokers', 'app_user_conversations',
      'app_user_contacts', 'app_user_appointments',
    ] as const;
    for (const table of delegatedAssignmentTables) {
      await client.query(
        `DELETE FROM ${table} WHERE assigned_by_user_id = $1 AND assignment_source = 'MANAGER'`,
        [updated.id]
      );
    }
  }
}

function handleError(error: unknown, res: Response, fallback: string): Response {
  if (error instanceof AuthorizationError) {
    return res.status(error.status).json({ error: error.message, code: error.code });
  }
  const pgError = error as { code?: string; constraint?: string };
  if (pgError.code === '23505') {
    const username = pgError.constraint?.includes('username');
    return res.status(409).json({ error: username ? 'Username já cadastrado.' : 'E-mail já cadastrado.', code: 'DUPLICATE_USER' });
  }
  if (pgError.code === '23503') {
    return res.status(400).json({ error: 'Um dos recursos informados não existe.', code: 'INVALID_RESOURCE' });
  }
  console.error('[Users]', error);
  return res.status(500).json({ error: fallback });
}

router.get('/resources', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
    res.json(await listAssignableResources(req.user));
  } catch (error) {
    return handleError(error, res, 'Erro ao listar recursos atribuíveis.');
  }
});

router.get('/', async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Não autenticado.' });
    const users = req.user.role === 'ADMIN' ? await listAllUsers() : await listManagedUsers(req.user.id);
    res.json({ users: await Promise.all(users.map(toUserDto)) });
  } catch (error) {
    return handleError(error, res, 'Erro ao listar usuários.');
  }
});

router.post('/', async (req, res) => {
  let client: pg.PoolClient | null = null;
  try {
    const actor = req.user;
    if (!actor) return res.status(401).json({ error: 'Não autenticado.' });
    if (actor.role !== 'ADMIN') return res.status(403).json({ error: 'Somente ADMIN pode criar usuários.', code: 'ROLE_FORBIDDEN' });
    const parsed = createUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
    const data = parsed.data;
    if (await findByUsernameIncludingInactive(data.username)) {
      return res.status(409).json({ error: 'Username já cadastrado.', code: 'DUPLICATE_USERNAME' });
    }
    if (data.email && await findByEmailIncludingInactive(data.email)) {
      return res.status(409).json({ error: 'E-mail já cadastrado.', code: 'DUPLICATE_EMAIL' });
    }
    const scope: UserScopeAssignment = {
      managerId: data.managerId,
      enterpriseIds: data.enterpriseIds,
      brokerIds: data.brokerIds,
      conversationIds: data.conversationIds,
      contactIds: data.contactIds,
      appointmentIds: data.appointmentIds,
    };
    if (data.createBrokerAccess) {
      if (data.role !== 'COLLABORATOR') {
        return res.status(400).json({
          error: 'Acesso de corretor só pode ser criado para o perfil Colaborador.',
          code: 'BROKER_ACCESS_REQUIRES_COLLABORATOR',
        });
      }
      if (scope.enterpriseIds.length === 0) {
        return res.status(400).json({
          error: 'Selecione ao menos um empreendimento para criar o acesso de corretor.',
          code: 'BROKER_ACCESS_REQUIRES_ENTERPRISE',
        });
      }
    }
    if (data.role === 'COLLABORATOR') {
      await validateManager(scope.managerId);
      if (scope.managerId == null && (!data.allowDirectAssignment || !hasAnyDirectScope(scope))) {
        return res.status(400).json({
          error: 'Colaborador precisa de gestor ou de atribuição direta explícita.',
          code: 'COLLABORATOR_SCOPE_REQUIRED',
        });
      }
    } else {
      scope.managerId = null;
    }
    await assertScopeResourcesExist(scope);
    client = await getPool().connect();
    await client.query('BEGIN');
    let brokerId: number | null = null;
    if (data.createBrokerAccess) {
      const corretor = await createCorretor(
        { fullName: data.name, city: '', phone: '', realEstateAgency: '', enterpriseIds: scope.enterpriseIds },
        client
      );
      brokerId = corretor.id;
      scope.brokerIds = [...new Set([...scope.brokerIds, corretor.id])];
    }
    const user = await createUser({
      username: data.username,
      name: data.name,
      email: data.email || null,
      password: data.password,
      role: data.role,
      active: data.active,
      must_change_password: true,
      broker_id: brokerId,
    }, client);
    await replaceUserScope(actor, user, scope, client);
    await recordAccessAudit({ actorUserId: actor.id, targetUserId: user.id, action: 'USER_CREATED', resourceType: 'user', resourceId: user.id, metadata: { role: user.role, brokerId } }, client);
    await client.query('COMMIT');
    res.status(201).json({ user: await toUserDto(user) });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    return handleError(error, res, 'Erro ao criar usuário.');
  } finally {
    client?.release();
  }
});

router.get('/:id/scope', async (req, res) => {
  try {
    const actor = req.user;
    const id = Number(req.params.id);
    if (!actor) return res.status(401).json({ error: 'Não autenticado.' });
    const target = await findByIdIncludingInactive(id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!(await canManageTargetUser(actor, target))) return res.status(403).json({ error: 'Acesso negado.', code: 'USER_OUT_OF_SCOPE' });
    res.json({ scope: await getUserScopeAssignment(target.id) });
  } catch (error) {
    return handleError(error, res, 'Erro ao carregar escopo.');
  }
});

router.put('/:id/scope', async (req, res) => {
  let client: pg.PoolClient | null = null;
  let disconnectedUserIds: number[] = [];
  try {
    const actor = req.user;
    const id = Number(req.params.id);
    if (!actor) return res.status(401).json({ error: 'Não autenticado.' });
    const target = await findByIdIncludingInactive(id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!(await canManageTargetUser(actor, target))) return res.status(403).json({ error: 'Acesso negado.', code: 'USER_OUT_OF_SCOPE' });
    if (actor.id === target.id) return res.status(403).json({ error: 'Você não pode alterar o próprio escopo.', code: 'SELF_SCOPE_CHANGE' });
    const parsed = userScopeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
    const scope = parsed.data;
    if (target.role === 'COLLABORATOR') {
      if (actor.role === 'MANAGERIAL' && scope.managerId !== actor.id) {
        return res.status(403).json({ error: 'Gestor não pode remover ou trocar o vínculo de gestão.', code: 'MANAGER_RELATION_FORBIDDEN' });
      }
      await validateManager(scope.managerId);
      if (scope.managerId == null && !hasAnyDirectScope(scope)) {
        return res.status(400).json({ error: 'Colaborador sem gestor precisa de atribuição direta.', code: 'COLLABORATOR_SCOPE_REQUIRED' });
      }
    } else if (scope.managerId != null) {
      return res.status(400).json({ error: 'Somente colaboradores podem possuir gestor responsável.' });
    }
    await assertScopeResourcesExist(scope);
    await assertScopeAssignable(actor, target, scope);
    const affectedCollaborators = target.role === 'MANAGERIAL' ? await getManagedCollaboratorIds(target.id) : [];
    client = await getPool().connect();
    await client.query('BEGIN');
    await replaceUserScope(actor, target, scope, client);
    if (target.role === 'MANAGERIAL') await pruneManagerDelegations(target, affectedCollaborators, actor.id, client);
    disconnectedUserIds = await revokeUsersInTransaction([target.id, ...affectedCollaborators], client);
    await client.query('COMMIT');
    disconnectUsers(disconnectedUserIds, 'scope_changed');
    res.json({ scope: await getUserScopeAssignment(target.id) });
  } catch (error) {
    disconnectedUserIds = [];
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    return handleError(error, res, 'Erro ao atualizar escopo.');
  } finally {
    client?.release();
  }
});

router.patch('/:id', async (req, res) => {
  let releaseAdministrationLock: (() => Promise<void>) | null = null;
  let client: pg.PoolClient | null = null;
  let disconnectAfterCommit: { ids: number[]; reason: string } | null = null;
  try {
    const actor = req.user;
    const id = Number(req.params.id);
    if (actor?.role === 'ADMIN') releaseAdministrationLock = await acquireUserAdministrationLock();
    if (!actor || !Number.isSafeInteger(id)) return res.status(actor ? 400 : 401).json({ error: actor ? 'ID inválido.' : 'Não autenticado.' });
    const target = await findByIdIncludingInactive(id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!(await canManageTargetUser(actor, target))) return res.status(403).json({ error: 'Acesso negado.', code: 'USER_OUT_OF_SCOPE' });
    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
    const data = parsed.data;
    if (actor.role === 'MANAGERIAL' && (data.role !== undefined || data.active !== undefined || data.username !== undefined)) {
      return res.status(403).json({ error: 'Gestor só pode editar dados operacionais do colaborador.', code: 'MANAGER_UPDATE_FORBIDDEN' });
    }
    if (actor.id === target.id && data.role !== undefined && data.role !== target.role) {
      return res.status(403).json({ error: 'Você não pode alterar o próprio perfil.', code: 'SELF_ROLE_CHANGE' });
    }
    if (actor.id === target.id && data.active === false) {
      return res.status(403).json({ error: 'Você não pode desativar a própria conta.', code: 'SELF_DEACTIVATION' });
    }
    client = await getPool().connect();
    await client.query('BEGIN');
    const transactionalTarget = await findByIdIncludingInactive(target.id, client);
    if (!transactionalTarget) throw new AuthorizationError('Usuário não encontrado.', 404, 'USER_NOT_FOUND');
    const otherActiveAdmins = await countActiveAdmins(transactionalTarget.id, client);
    if (wouldRemoveLastActiveAdmin(transactionalTarget, data, otherActiveAdmins)) {
      throw new AuthorizationError('Não é possível desativar ou rebaixar o último ADMIN ativo.', 409, 'LAST_ACTIVE_ADMIN');
    }
    if (data.username) {
      const existing = await findByUsernameIncludingInactive(data.username, client);
      if (existing && existing.id !== target.id) throw new AuthorizationError('Username já cadastrado.', 409, 'DUPLICATE_USERNAME');
    }
    if (data.email) {
      const existing = await findByEmailIncludingInactive(data.email, client);
      if (existing && existing.id !== target.id) throw new AuthorizationError('E-mail já cadastrado.', 409, 'DUPLICATE_EMAIL');
    }
    const affectedCollaborators = target.role === 'MANAGERIAL' ? await getManagedCollaboratorIds(target.id, client) : [];
    const updated = await updateUser(transactionalTarget.id, {
      name: data.name,
      username: data.username,
      email: data.email === '' ? null : data.email,
      role: data.role,
      active: data.active,
    }, client);
    if (!updated) throw new AuthorizationError('Usuário não encontrado.', 404, 'USER_NOT_FOUND');
    const securityChanged = updated.role !== target.role || updated.active !== target.active;
    if (securityChanged) {
      await removeInvalidRoleRelations(transactionalTarget, updated, client);
      const managerInvalidated = target.role === 'MANAGERIAL' && (updated.role !== 'MANAGERIAL' || !updated.active);
      const ids = await revokeUsersInTransaction(
        [target.id, ...(managerInvalidated ? affectedCollaborators : [])],
        client
      );
      disconnectAfterCommit = { ids, reason: updated.active ? 'role_changed' : 'user_deactivated' };
    }
    await recordAccessAudit({ actorUserId: actor.id, targetUserId: target.id, action: 'USER_UPDATED', resourceType: 'user', resourceId: target.id, metadata: { roleFrom: target.role, roleTo: updated.role, activeFrom: target.active, activeTo: updated.active } }, client);
    await client.query('COMMIT');
    if (disconnectAfterCommit) disconnectUsers(disconnectAfterCommit.ids, disconnectAfterCommit.reason);
    res.json({ user: await toUserDto(updated) });
  } catch (error) {
    disconnectAfterCommit = null;
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    return handleError(error, res, 'Erro ao atualizar usuário.');
  } finally {
    client?.release();
    await releaseAdministrationLock?.();
  }
});

router.patch('/:id/password', async (req, res) => {
  try {
    const actor = req.user;
    const id = Number(req.params.id);
    if (!actor) return res.status(401).json({ error: 'Não autenticado.' });
    if (actor.role !== 'ADMIN') return res.status(403).json({ error: 'Somente ADMIN pode redefinir senhas.', code: 'ROLE_FORBIDDEN' });
    const target = await findByIdIncludingInactive(id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    const parsed = updatePasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.issues.map((issue) => issue.message).join('; ') });
    await updatePassword(target.id, parsed.data.newPassword, { mustChangePassword: true });
    await revokeAllSessions(target.id);
    disconnectUserSockets(target.id, 'password_reset');
    disconnectSseUser(target.id);
    await recordAccessAudit({ actorUserId: actor.id, targetUserId: target.id, action: 'PASSWORD_RESET', resourceType: 'user', resourceId: target.id });
    res.json({ ok: true, mustChangePassword: true });
  } catch (error) {
    return handleError(error, res, 'Erro ao redefinir senha.');
  }
});

router.delete('/:id/sessions', async (req, res) => {
  try {
    const actor = req.user;
    const id = Number(req.params.id);
    if (!actor) return res.status(401).json({ error: 'Não autenticado.' });
    if (actor.role !== 'ADMIN') return res.status(403).json({ error: 'Somente ADMIN pode encerrar sessões.', code: 'ROLE_FORBIDDEN' });
    const target = await findByIdIncludingInactive(id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!(await canManageTargetUser(actor, target))) return res.status(403).json({ error: 'Acesso negado.' });
    const revoked = await revokeAllSessions(target.id);
    disconnectUserSockets(target.id, 'sessions_terminated');
    disconnectSseUser(target.id);
    await recordAccessAudit({ actorUserId: actor.id, targetUserId: target.id, action: 'SESSIONS_REVOKED', resourceType: 'session', metadata: { revoked } });
    res.json({ ok: true, revoked });
  } catch (error) {
    return handleError(error, res, 'Erro ao encerrar sessões.');
  }
});

router.get('/:id/audit', async (req, res) => {
  try {
    const actor = req.user;
    const id = Number(req.params.id);
    if (!actor) return res.status(401).json({ error: 'Não autenticado.' });
    if (actor.role !== 'ADMIN') return res.status(403).json({ error: 'Somente ADMIN pode consultar auditoria.', code: 'ROLE_FORBIDDEN' });
    const target = await findByIdIncludingInactive(id);
    if (!target) return res.status(404).json({ error: 'Usuário não encontrado.' });
    if (!(await canManageTargetUser(actor, target))) return res.status(403).json({ error: 'Acesso negado.' });
    const { rows } = await query(
      `SELECT id, actor_user_id, target_user_id, action, resource_type, resource_id, metadata, created_at
       FROM app_access_audit WHERE target_user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [target.id]
    );
    res.json({ audit: rows });
  } catch (error) {
    return handleError(error, res, 'Erro ao carregar auditoria.');
  }
});

export default router;
