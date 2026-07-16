import { createHash, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { getPool, query } from '../db/pg.js';
import type pg from 'pg';
import { isUserRole, type UserRole } from '../constants/roles.js';

export type { UserRole } from '../constants/roles.js';

const scryptAsync = promisify(scrypt);
const TOKEN_BYTES = 32;
const SESSION_DAYS = 30;
const SALT_LEN = 16;
const KEY_LEN = 64;

export interface SessionScope {
  kind: string;
  convIds: number[];
  totalSize?: number;
}

export interface AppUser {
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
  sessionScope?: SessionScope | null;
}

export interface AppUserPublic {
  id: number;
  username: string | null;
  name: string;
  email: string | null;
  role: UserRole;
  active: boolean;
  mustChangePassword: boolean;
}

type StoredUserRow = Omit<AppUser, 'role' | 'sessionScope'> & {
  role: string;
  password_hash?: string;
};

const USER_COLUMNS = `id, username, name, email, role, active, must_change_password,
  broker_id, django_user_id, created_at, updated_at`;

export type UserRepositoryClient = Pick<pg.PoolClient, 'query'>;

function userDb(client?: UserRepositoryClient): Pick<pg.Pool, 'query'> | UserRepositoryClient {
  return client ?? getPool();
}

export function parseStoredUserRole(raw: string): UserRole {
  if (isUserRole(raw)) return raw;
  console.error('[userRepository] role desconhecido; usando COLLABORATOR (fail closed).', { raw });
  return 'COLLABORATOR';
}

function mapUser(row: StoredUserRow): AppUser {
  return { ...row, role: parseStoredUserRole(row.role) };
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidUsername(value: string): boolean {
  const normalized = normalizeUsername(value);
  return normalized.length >= 3 && normalized.length <= 120 && /^[a-z0-9._-]+$/.test(normalized);
}

function normalizeEmail(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized || null;
}

function hashPassword(password: string, salt: Buffer): Promise<Buffer> {
  return scryptAsync(password, salt, KEY_LEN) as Promise<Buffer>;
}

export async function hashPasswordForStorage(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await hashPassword(password, salt);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(stored: string, password: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const salt = Buffer.from(saltHex, 'hex');
  const key = Buffer.from(keyHex, 'hex');
  const supplied = await hashPassword(password, salt);
  return key.length === supplied.length && timingSafeEqual(key, supplied);
}

function sessionTokenDigest(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function findByLogin(
  identifier: string,
  options: { includeInactive?: boolean } = {}
): Promise<(AppUser & { password_hash: string }) | null> {
  const normalized = identifier.trim().toLowerCase();
  if (!normalized) return null;
  const activeClause = options.includeInactive ? '' : 'AND active = true';
  const { rows } = await query<StoredUserRow & { password_hash: string }>(
    `SELECT ${USER_COLUMNS}, password_hash
     FROM app_users
     WHERE (LOWER(username) = $1 OR (email IS NOT NULL AND LOWER(email) = $1))
       ${activeClause}
     ORDER BY CASE WHEN LOWER(username) = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [normalized]
  );
  const row = rows[0];
  return row ? { ...mapUser(row), password_hash: row.password_hash } : null;
}

export async function findByEmail(email: string): Promise<(AppUser & { password_hash: string }) | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { rows } = await query<StoredUserRow & { password_hash: string }>(
    `SELECT ${USER_COLUMNS}, password_hash FROM app_users
     WHERE email IS NOT NULL AND LOWER(email) = $1 AND active = true LIMIT 1`,
    [normalized]
  );
  const row = rows[0];
  return row ? { ...mapUser(row), password_hash: row.password_hash } : null;
}

export async function findByEmailIncludingInactive(email: string, client?: UserRepositoryClient): Promise<(AppUser & { password_hash: string }) | null> {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { rows } = await userDb(client).query<StoredUserRow & { password_hash: string }>(
    `SELECT ${USER_COLUMNS}, password_hash FROM app_users
     WHERE email IS NOT NULL AND LOWER(email) = $1 LIMIT 1`,
    [normalized]
  );
  const row = rows[0];
  return row ? { ...mapUser(row), password_hash: row.password_hash } : null;
}

export async function findByUsernameIncludingInactive(username: string, client?: UserRepositoryClient): Promise<(AppUser & { password_hash: string }) | null> {
  const normalized = normalizeUsername(username);
  if (!normalized) return null;
  const { rows } = await userDb(client).query<StoredUserRow & { password_hash: string }>(
    `SELECT ${USER_COLUMNS}, password_hash FROM app_users WHERE LOWER(username) = $1 LIMIT 1`,
    [normalized]
  );
  const row = rows[0];
  return row ? { ...mapUser(row), password_hash: row.password_hash } : null;
}

export async function findById(id: number): Promise<AppUser | null> {
  const { rows } = await query<StoredUserRow>(
    `SELECT ${USER_COLUMNS} FROM app_users WHERE id = $1 AND active = true LIMIT 1`,
    [id]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function findByIdIncludingInactive(id: number, client?: UserRepositoryClient): Promise<AppUser | null> {
  const { rows } = await userDb(client).query<StoredUserRow>(
    `SELECT ${USER_COLUMNS} FROM app_users WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function listAllUsers(): Promise<AppUser[]> {
  const { rows } = await query<StoredUserRow>(
    `SELECT ${USER_COLUMNS} FROM app_users ORDER BY name, id`
  );
  return rows.map(mapUser);
}

export async function listManagedUsers(managerUserId: number): Promise<AppUser[]> {
  const { rows } = await query<StoredUserRow>(
    `SELECT ${USER_COLUMNS.replace(/\b(id|username|name|email|role|active|must_change_password|broker_id|django_user_id|created_at|updated_at)\b/g, 'u.$1')}
     FROM app_user_management m
     JOIN app_users u ON u.id = m.collaborator_user_id
     WHERE m.manager_user_id = $1 AND u.role = 'COLLABORATOR'
     ORDER BY u.name, u.id`,
    [managerUserId]
  );
  return rows.map(mapUser);
}

export interface CreateUserInput {
  username?: string | null;
  name: string;
  email?: string | null;
  password: string;
  role: UserRole;
  active: boolean;
  must_change_password?: boolean;
  broker_id?: number | null;
  django_user_id?: number | null;
}

export async function createUser(input: CreateUserInput, client?: UserRepositoryClient): Promise<AppUser> {
  const username = input.username == null ? null : normalizeUsername(input.username);
  const email = normalizeEmail(input.email);
  if (!username && !email) throw new Error('Username ou e-mail é obrigatório.');
  if (username && !isValidUsername(username)) throw new Error('Username inválido.');
  const hash = await hashPasswordForStorage(input.password);
  const { rows } = await userDb(client).query<StoredUserRow>(
    `INSERT INTO app_users
       (username, name, email, password_hash, role, active, must_change_password, broker_id, django_user_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     RETURNING ${USER_COLUMNS}`,
    [
      username,
      input.name.trim(),
      email,
      hash,
      input.role,
      input.active,
      input.must_change_password ?? false,
      input.broker_id ?? null,
      input.django_user_id ?? null,
    ]
  );
  if (!rows[0]) throw new Error('Falha ao criar usuário.');
  return mapUser(rows[0]);
}

export interface UpdateUserInput {
  username?: string | null;
  name?: string;
  email?: string | null;
  role?: UserRole;
  active?: boolean;
  must_change_password?: boolean;
  broker_id?: number | null;
  django_user_id?: number | null;
}

export async function updateUser(id: number, input: UpdateUserInput, client?: UserRepositoryClient): Promise<AppUser | null> {
  const current = await findByIdIncludingInactive(id, client);
  if (!current) return null;
  const username = input.username !== undefined
    ? (input.username == null ? null : normalizeUsername(input.username))
    : current.username;
  const email = input.email !== undefined ? normalizeEmail(input.email) : current.email;
  if (!username && !email) throw new Error('Username ou e-mail é obrigatório.');
  if (username && !isValidUsername(username)) throw new Error('Username inválido.');
  const { rows } = await userDb(client).query<StoredUserRow>(
    `UPDATE app_users SET
       username = $1, name = $2, email = $3, role = $4, active = $5,
       must_change_password = $6, broker_id = $7, django_user_id = $8, updated_at = NOW()
     WHERE id = $9
     RETURNING ${USER_COLUMNS}`,
    [
      username,
      input.name !== undefined ? input.name.trim() : current.name,
      email,
      input.role ?? current.role,
      input.active ?? current.active,
      input.must_change_password ?? current.must_change_password,
      input.broker_id !== undefined ? input.broker_id : current.broker_id,
      input.django_user_id !== undefined ? input.django_user_id : current.django_user_id,
      id,
    ]
  );
  return rows[0] ? mapUser(rows[0]) : null;
}

export async function updatePassword(
  id: number,
  newPassword: string,
  options: { mustChangePassword?: boolean } = {}
): Promise<boolean> {
  const hash = await hashPasswordForStorage(newPassword);
  const result = await query(
    `UPDATE app_users SET password_hash = $1, must_change_password = $2, updated_at = NOW() WHERE id = $3`,
    [hash, options.mustChangePassword ?? false, id]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function countActiveAdmins(excludeUserId?: number, client?: UserRepositoryClient): Promise<number> {
  const { rows } = await userDb(client).query<{ total: string }>(
    `SELECT COUNT(*)::text AS total FROM app_users
     WHERE role = 'ADMIN' AND active = true AND ($1::int IS NULL OR id <> $1)`,
    [excludeUserId ?? null]
  );
  return Number.parseInt(rows[0]?.total ?? '0', 10) || 0;
}

export function wouldRemoveLastActiveAdmin(
  target: Pick<AppUser, 'role' | 'active'>,
  patch: Pick<UpdateUserInput, 'role' | 'active'>,
  otherActiveAdminCount: number
): boolean {
  const removesAdmin = target.role === 'ADMIN' && target.active &&
    (patch.active === false || (patch.role !== undefined && patch.role !== 'ADMIN'));
  return removesAdmin && otherActiveAdminCount < 1;
}

/** Serializa alterações administrativas de perfil/status para evitar corrida no último ADMIN. */
export async function acquireUserAdministrationLock(): Promise<() => Promise<void>> {
  const client = await getPool().connect();
  const lockKey = 6_284_831_109;
  try {
    await client.query(`SELECT pg_advisory_lock($1::bigint)`, [lockKey]);
  } catch (error) {
    client.release();
    throw error;
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await client.query(`SELECT pg_advisory_unlock($1::bigint)`, [lockKey]);
    } catch (error) {
      console.error('[userRepository] falha ao liberar lock administrativo', error);
    } finally {
      client.release();
    }
  };
}

export async function createSession(userId: number, scope?: SessionScope | null): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const storedToken = sessionTokenDigest(token);
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await query(
    `INSERT INTO app_sessions (user_id, token, expires_at, scope_kind, scope_conv_ids, scope_total_size)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, storedToken, expiresAt, scope?.kind ?? null, scope?.convIds ?? null, scope?.totalSize ?? null]
  );
  return token;
}

export async function getSessionUser(token: string): Promise<AppUser | null> {
  if (!token) return null;
  const digest = sessionTokenDigest(token);
  const { rows } = await query<StoredUserRow & {
    scope_kind: string | null;
    scope_conv_ids: number[] | null;
    scope_total_size: number | null;
  }>(
    `SELECT ${USER_COLUMNS.replace(/\b(id|username|name|email|role|active|must_change_password|broker_id|django_user_id|created_at|updated_at)\b/g, 'u.$1')},
            s.scope_kind, s.scope_conv_ids, s.scope_total_size
     FROM app_sessions s
     JOIN app_users u ON u.id = s.user_id
     WHERE (s.token = $1 OR s.token = $2)
       AND s.expires_at > NOW()
       AND u.active = true
     LIMIT 1`,
    [digest, token]
  );
  const row = rows[0];
  if (!row) return null;
  const user = mapUser(row);
  user.sessionScope = row.scope_kind
    ? { kind: row.scope_kind, convIds: row.scope_conv_ids ?? [], totalSize: row.scope_total_size ?? undefined }
    : null;
  return user;
}

export async function getSessionOwnerId(token: string): Promise<number | null> {
  const digest = sessionTokenDigest(token);
  const { rows } = await query<{ user_id: number }>(
    `SELECT user_id FROM app_sessions WHERE token = $1 OR token = $2 LIMIT 1`,
    [digest, token]
  );
  return rows[0]?.user_id ?? null;
}

export async function deleteSession(token: string): Promise<void> {
  const digest = sessionTokenDigest(token);
  await query(`DELETE FROM app_sessions WHERE token = $1 OR token = $2`, [digest, token]);
}

export async function revokeAllSessions(userId: number, client?: UserRepositoryClient): Promise<number> {
  const result = await userDb(client).query(`DELETE FROM app_sessions WHERE user_id = $1`, [userId]);
  return result.rowCount ?? 0;
}

export async function revokeOtherSessions(userId: number, keepToken: string): Promise<number> {
  const digest = sessionTokenDigest(keepToken);
  const result = await query(
    `DELETE FROM app_sessions WHERE user_id = $1 AND token <> $2 AND token <> $3`,
    [userId, digest, keepToken]
  );
  return result.rowCount ?? 0;
}

export function toPublic(user: AppUser): AppUserPublic {
  return {
    id: user.id,
    username: user.username,
    name: user.name,
    email: user.email,
    role: user.role,
    active: user.active,
    mustChangePassword: user.must_change_password,
  };
}
