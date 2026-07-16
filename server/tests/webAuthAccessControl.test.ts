import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { INITIAL_ACCESS_USERS } from '../constants/initialAccessUsers.js';
import { canAccessAll, canManageUsers, canRoleManageTargetUser, canViewDashboard } from '../services/authorizationService.js';
import { hashPasswordForStorage, isValidUsername, normalizeUsername, verifyPassword, wouldRemoveLastActiveAdmin, type AppUser } from '../repositories/userRepository.js';
import { requireAuth, requirePasswordChangeComplete, requireRole } from '../middleware/auth.js';

function responseRecorder() {
  const state: { status: number | null; body: unknown } = { status: null, body: null };
  const response = {
    status(value: number) { state.status = value; return this; },
    json(value: unknown) { state.body = value; return this; },
  };
  return { state, response };
}

function actor(role: AppUser['role'], active = true): AppUser {
  return {
    id: 1, username: 'actor', name: 'Actor', email: null, role, active,
    must_change_password: false, broker_id: null, django_user_id: null,
    created_at: new Date(), updated_at: new Date(),
  };
}

test('normalizes usernames while preserving dots and rejects spaces', () => {
  assert.equal(normalizeUsername('  Lucas.Pimenta  '), 'lucas.pimenta');
  assert.equal(isValidUsername('lucas.pimenta'), true);
  assert.equal(isValidUsername('lucas pimenta'), false);
});

test('scrypt verification accepts the right password and rejects a wrong one', async () => {
  const hash = await hashPasswordForStorage('a-secure-password');
  assert.equal(await verifyPassword(hash, 'a-secure-password'), true);
  assert.equal(await verifyPassword(hash, 'wrong-password'), false);
  assert.equal(hash.includes('a-secure-password'), false);
});

test('initial access manifest contains the exact seven unique usernames and hierarchy', () => {
  const usernames = INITIAL_ACCESS_USERS.map((item) => item.username);
  assert.deepEqual(usernames, ['ulysses', 'emerson', 'pedro', 'lucas.pimenta', 'kaua.sdr', 'georgia.sdr', 'rafael.sdr']);
  assert.equal(new Set(usernames.map((item) => item.toLowerCase())).size, 7);
  assert.equal(INITIAL_ACCESS_USERS.filter((item) => item.role === 'ADMIN').length, 3);
  assert.equal(INITIAL_ACCESS_USERS.filter((item) => item.managerUsername === 'lucas.pimenta').length, 3);
  assert.equal(INITIAL_ACCESS_USERS.some((item) => 'email' in item), false);
});

test('only ADMIN has global access; manager can manage users but collaborator cannot', () => {
  assert.equal(canAccessAll(actor('ADMIN')), true);
  assert.equal(canAccessAll(actor('MANAGERIAL')), false);
  assert.equal(canAccessAll(actor('COLLABORATOR')), false);
  assert.equal(canManageUsers(actor('MANAGERIAL')), true);
  assert.equal(canManageUsers(actor('COLLABORATOR')), false);
});

test('dashboard requires an active identity and never infers access from missing broker', () => {
  assert.equal(canViewDashboard(actor('COLLABORATOR', true)), true);
  assert.equal(canViewDashboard(actor('COLLABORATOR', false)), false);
  assert.equal(actor('COLLABORATOR').broker_id, null);
  assert.equal(canAccessAll(actor('COLLABORATOR')), false);
});

test('manager role can target collaborators only, never admins or other managers', () => {
  assert.equal(canRoleManageTargetUser(actor('MANAGERIAL'), { ...actor('COLLABORATOR'), id: 2 }), true);
  assert.equal(canRoleManageTargetUser(actor('MANAGERIAL'), { ...actor('MANAGERIAL'), id: 2 }), false);
  assert.equal(canRoleManageTargetUser(actor('MANAGERIAL'), { ...actor('ADMIN'), id: 2 }), false);
  assert.equal(canRoleManageTargetUser(actor('COLLABORATOR'), { ...actor('COLLABORATOR'), id: 2 }), false);
});

test('last active ADMIN cannot be deactivated or demoted', () => {
  assert.equal(wouldRemoveLastActiveAdmin(actor('ADMIN'), { active: false }, 0), true);
  assert.equal(wouldRemoveLastActiveAdmin(actor('ADMIN'), { role: 'MANAGERIAL' }, 0), true);
  assert.equal(wouldRemoveLastActiveAdmin(actor('ADMIN'), { active: false }, 1), false);
});

test('administrative profile updates are serialized around the last ADMIN check', () => {
  const repository = readFileSync(new URL('../repositories/userRepository.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../routes/users.ts', import.meta.url), 'utf8');
  assert.match(repository, /pg_advisory_lock/);
  assert.match(route, /acquireUserAdministrationLock/);
  assert.match(route, /releaseAdministrationLock/);
});

test('missing credentials are rejected without an authentication fallback', async () => {
  const { state, response } = responseRecorder();
  let nextCalled = false;
  await requireAuth({ headers: {}, method: 'GET', path: '/dashboard' } as never, response as never, () => { nextCalled = true; });
  assert.equal(state.status, 401);
  assert.equal(nextCalled, false);
});

test('authentication repository keeps username/email compatibility and validates session lifecycle', () => {
  const repository = readFileSync(new URL('../repositories/userRepository.ts', import.meta.url), 'utf8');
  const routes = readFileSync(new URL('../routes/auth.ts', import.meta.url), 'utf8');
  assert.match(repository, /LOWER\(username\) = \$1 OR \(email IS NOT NULL AND LOWER\(email\) = \$1\)/);
  assert.match(repository, /s\.expires_at > NOW\(\)[\s\S]*u\.active = true/);
  assert.match(routes, /!user \|\| !user\.active \|\| !passwordOk/);
  assert.match(routes, /deleteSession\(authReq\.authToken\)/);
  assert.match(routes, /updatePassword[\s\S]*mustChangePassword: false/);
});

test('mandatory password change blocks normal endpoints with a stable code', () => {
  const { state, response } = responseRecorder();
  const user = { ...actor('COLLABORATOR'), must_change_password: true };
  requirePasswordChangeComplete({ user } as never, response as never, () => assert.fail('must not continue'));
  assert.equal(state.status, 403);
  assert.equal((state.body as { code: string }).code, 'PASSWORD_CHANGE_REQUIRED');
});

test('role middleware denies collaborators from the access-management API', () => {
  const { state, response } = responseRecorder();
  requireRole('ADMIN', 'MANAGERIAL')({ user: actor('COLLABORATOR') } as never, response as never, () => assert.fail('must not continue'));
  assert.equal(state.status, 403);
});

test('migration enforces case-insensitive usernames and contains explicit assignment tables', () => {
  const sql = readFileSync(new URL('../db/migrations/pg/074_web_auth_access_control.sql', import.meta.url), 'utf8');
  assert.match(sql, /UNIQUE INDEX[\s\S]+LOWER\(username\)/i);
  for (const table of ['app_user_management', 'app_user_enterprises', 'app_user_brokers', 'app_user_conversations', 'app_access_audit']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  }
  assert.doesNotMatch(sql, /ia@/i);
});

test('initial access seed receives the password only from the environment', () => {
  const source = readFileSync(new URL('../scripts/seed-initial-access-users.ts', import.meta.url), 'utf8');
  assert.match(source, /process\.env\.INITIAL_ACCESS_PASSWORD/);
  assert.doesNotMatch(source, /ia@/i);
  assert.doesNotMatch(source, /length\s*<\s*8/);
  assert.doesNotMatch(source, /initPostgres/);
  assert.match(source, /FOR UPDATE/);
  assert.match(source, /client\.query\('BEGIN'\)/);
  assert.match(source, /client\.query\('ROLLBACK'\)/);
  assert.doesNotMatch(source, /updateUser|revokeAllSessions/);
  assert.match(source, /management_preserved/);
});

test('production startup verifies migrations but never applies them implicitly', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { scripts: Record<string, string> };
  const indexSource = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
  const pgSource = readFileSync(new URL('../db/pg.ts', import.meta.url), 'utf8');
  assert.equal(packageJson.scripts['start:prod'], 'node dist/index.js');
  assert.equal(packageJson.scripts['migrate:deploy'], 'node dist/db/migrate.js');
  assert.match(indexSource, /applyMigrations: config\.nodeEnv !== 'production'/);
  assert.match(pgSource, /if \(!applyMigrations && pending\.length > 0\)/);
});

test('SSO cannot elevate or demote the local authorization role', () => {
  const source = readFileSync(new URL('../routes/sso.ts', import.meta.url), 'utf8');
  assert.match(source, /role: 'COLLABORATOR'/);
  assert.match(source, /roleClaimIgnored/);
  assert.doesNotMatch(source, /role:\s*safeRole/);
});

test('realtime revalidates sessions and routes message.updated by conversation', () => {
  const publisher = readFileSync(new URL('../realtime/realtimePublisher.ts', import.meta.url), 'utf8');
  const socketServer = readFileSync(new URL('../realtime/socketServer.ts', import.meta.url), 'utf8');
  assert.match(publisher, /getSessionUser\(token\)/);
  assert.match(publisher, /canAccessConversation\(user, conversationId\)/);
  assert.match(publisher, /message\.updated'[\s\S]*payload\.conversationId/);
  assert.match(socketServer, /!user \|\| user\.must_change_password/);
  assert.doesNotMatch(socketServer, /handshake\.query/);
});

test('message deletion is constrained to the authorized conversation', () => {
  const repository = readFileSync(new URL('../repositories/messageRepository.ts', import.meta.url), 'utf8');
  const route = readFileSync(new URL('../routes/whatsapp.ts', import.meta.url), 'utf8');
  assert.match(repository, /WHERE id = \$2 AND conversation_id = \$3/);
  assert.match(route, /softDeleteMessage\(msgId, convId, userId\)/);
});

test('restricted module lists are wired to central scoped IDs', () => {
  const whatsapp = readFileSync(new URL('../routes/whatsapp.ts', import.meta.url), 'utf8');
  const contacts = readFileSync(new URL('../routes/contacts.ts', import.meta.url), 'utf8');
  const appointments = readFileSync(new URL('../routes/appointments.ts', import.meta.url), 'utf8');
  const dashboard = readFileSync(new URL('../routes/dashboard.ts', import.meta.url), 'utf8');
  assert.match(whatsapp, /getAccessibleConversationIds\(user\)/);
  assert.match(contacts, /getAccessibleContactIds\(authReq\.user\)/);
  assert.match(appointments, /getAccessibleAppointmentIds\(authReq\.user\)/);
  assert.match(dashboard, /getScopedDashboardOverview[\s\S]*getAccessibleConversationIds\(req\.user\)/);
});

test('manager user listing is constrained to the explicit management relation', () => {
  const repository = readFileSync(new URL('../repositories/userRepository.ts', import.meta.url), 'utf8');
  const routes = readFileSync(new URL('../routes/users.ts', import.meta.url), 'utf8');
  assert.match(repository, /WHERE m\.manager_user_id = \$1 AND u\.role = 'COLLABORATOR'/);
  assert.match(routes, /req\.user\.role === 'ADMIN' \? await listAllUsers\(\) : await listManagedUsers\(req\.user\.id\)/);
});
