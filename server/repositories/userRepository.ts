import { randomBytes } from 'crypto';
import { scrypt, timingSafeEqual } from 'crypto';
import { promisify } from 'util';
import { query } from '../db/pg.js';
import { config } from '../config.js';
import { isUserRole, type UserRole } from '../constants/roles.js';

export type { UserRole } from '../constants/roles.js';

const scryptAsync = promisify(scrypt);

const TOKEN_BYTES = 32;
const SESSION_DAYS = 30;
const SALT_LEN = 16;
const KEY_LEN = 64;

/**
 * Converte role lida do PostgreSQL sem asserção insegura.
 * Se o valor for inválido (ex.: ambiente sem migração 015), registra aviso e usa COLLABORATOR (menor privilégio).
 */
export function parseStoredUserRole(raw: string): UserRole {
  if (isUserRole(raw)) return raw;
  console.error(
    '[userRepository] role desconhecido no banco. Verifique migração 015_app_users_role_managerial.sql. Valor:',
    raw
  );
  return 'COLLABORATOR';
}

export interface AppUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  broker_id: number | null;    // NOVO
  django_user_id: number | null; // NOVO
  created_at: Date;
  updated_at: Date;
}

export interface AppUserPublic {
  id: number;
  name: string;
  email: string;
  role: UserRole;
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

export async function findByEmail(email: string): Promise<(AppUser & { password_hash: string }) | null> {
  const normalized = email.trim().toLowerCase();
  const result = await query<{
    id: number;
    name: string;
    email: string;
    password_hash: string;
    role: string;
    active: boolean;
    broker_id: number | null;
    django_user_id: number | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, email, password_hash, role, active, broker_id, django_user_id, created_at, updated_at
     FROM app_users WHERE LOWER(email) = $1 AND active = true`,
    [normalized]
  );
  const row = result.rows[0];
  return row ? { ...row, role: parseStoredUserRole(row.role) } : null;
}

/**
 * Usuário usado quando a API é chamada sem Bearer (modo embutido / sem login local na ANA).
 */
export async function findEmbeddedDefaultUser(): Promise<AppUser | null> {
  const fixedId = config.embeddedDefaultUserId;
  if (fixedId != null) {
    const u = await findById(fixedId);
    if (u) return u;
  }
  const result = await query<{
    id: number;
    name: string;
    email: string;
    role: string;
    active: boolean;
    broker_id: number | null;
    django_user_id: number | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, email, role, active, broker_id, django_user_id, created_at, updated_at
     FROM app_users
     WHERE active = true
     ORDER BY CASE role WHEN 'ADMIN' THEN 0 WHEN 'MANAGERIAL' THEN 1 ELSE 2 END, id ASC
     LIMIT 1`
  );
  const row = result.rows[0];
  return row ? { ...row, role: parseStoredUserRole(row.role) } : null;
}

export async function findById(id: number): Promise<AppUser | null> {
  const result = await query<{
    id: number;
    name: string;
    email: string;
    role: string;
    active: boolean;
    broker_id: number | null;
    django_user_id: number | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, email, role, active, broker_id, django_user_id, created_at, updated_at
     FROM app_users WHERE id = $1 AND active = true`,
    [id]
  );
  const row = result.rows[0];
  return row ? { ...row, role: parseStoredUserRole(row.role) } : null;
}

export async function findByIdIncludingInactive(id: number): Promise<AppUser | null> {
  const result = await query<{
    id: number;
    name: string;
    email: string;
    role: string;
    active: boolean;
    broker_id: number | null;
    django_user_id: number | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, email, role, active, broker_id, django_user_id, created_at, updated_at
     FROM app_users WHERE id = $1`,
    [id]
  );
  const row = result.rows[0];
  return row ? { ...row, role: parseStoredUserRole(row.role) } : null;
}

export async function listAllUsers(): Promise<AppUser[]> {
  const result = await query<{
    id: number;
    name: string;
    email: string;
    role: string;
    active: boolean;
    broker_id: number | null;
    django_user_id: number | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, email, role, active, broker_id, django_user_id, created_at, updated_at
     FROM app_users ORDER BY name ASC`
  );
  return result.rows.map((row) => ({ ...row, role: parseStoredUserRole(row.role) }));
}

export async function findByEmailIncludingInactive(email: string): Promise<(AppUser & { password_hash: string }) | null> {
  const normalized = email.trim().toLowerCase();
  const result = await query<{
    id: number;
    name: string;
    email: string;
    password_hash: string;
    role: string;
    active: boolean;
    broker_id: number | null;
    django_user_id: number | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT id, name, email, password_hash, role, active, broker_id, django_user_id, created_at, updated_at
     FROM app_users WHERE LOWER(email) = $1`,
    [normalized]
  );
  const row = result.rows[0];
  return row ? { ...row, role: parseStoredUserRole(row.role) } : null;
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: UserRole;
  active: boolean;
}

export async function createUser(input: CreateUserInput): Promise<AppUser> {
  const email = input.email.trim().toLowerCase();
  const hash = await hashPasswordForStorage(input.password);
  const result = await query<{
    id: number;
    name: string;
    email: string;
    role: string;
    active: boolean;
    broker_id: number | null;
    django_user_id: number | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `INSERT INTO app_users (name, email, password_hash, role, active, broker_id, django_user_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id, name, email, role, active, broker_id, django_user_id, created_at, updated_at`,
    [input.name.trim(), email, hash, input.role, input.active, null, null]
  );
  const row = result.rows[0];
  if (!row) throw new Error('Falha ao criar usuário.');
  return { ...row, role: parseStoredUserRole(row.role) };
}

export interface UpdateUserInput {
  name?: string;
  email?: string;
  role?: UserRole;
  active?: boolean;
  broker_id?: number | null;      // NOVO
  django_user_id?: number | null; // NOVO
}

export async function updateUser(id: number, input: UpdateUserInput): Promise<AppUser | null> {
  const current = await findByIdIncludingInactive(id);
  if (!current) return null;
  const name = input.name !== undefined ? input.name.trim() : current.name;
  const email = input.email !== undefined ? input.email.trim().toLowerCase() : current.email;
  const role = input.role !== undefined ? input.role : current.role;
  const active = input.active !== undefined ? input.active : current.active;
  const broker_id = input.broker_id !== undefined ? input.broker_id : current.broker_id;
  const django_user_id = input.django_user_id !== undefined ? input.django_user_id : current.django_user_id;
  await query(
    `UPDATE app_users SET name = $1, email = $2, role = $3, active = $4, broker_id = $5, django_user_id = $6, updated_at = NOW() WHERE id = $7`,
    [name, email, role, active, broker_id, django_user_id, id]
  );
  return findByIdIncludingInactive(id);
}

export async function updatePassword(id: number, newPassword: string): Promise<boolean> {
  const hash = await hashPasswordForStorage(newPassword);
  const result = await query(`UPDATE app_users SET password_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, id]);
  return (result.rowCount ?? 0) > 0;
}

export async function createSession(userId: number): Promise<string> {
  const token = randomBytes(TOKEN_BYTES).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS);
  await query(
    `INSERT INTO app_sessions (user_id, token, expires_at) VALUES ($1, $2, $3)`,
    [userId, token, expiresAt]
  );
  return token;
}

export async function getSessionUser(token: string): Promise<AppUser | null> {
  const result = await query<{
    id: number;
    name: string;
    email: string;
    role: string;
    active: boolean;
    broker_id: number | null;
    django_user_id: number | null;
    created_at: Date;
    updated_at: Date;
  }>(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.broker_id, u.django_user_id, u.created_at, u.updated_at
     FROM app_sessions s
     JOIN app_users u ON u.id = s.user_id AND u.active = true
     WHERE s.token = $1 AND s.expires_at > NOW()`,
    [token]
  );
  const row = result.rows[0];
  return row ? { ...row, role: parseStoredUserRole(row.role) } : null;
}

export async function deleteSession(token: string): Promise<void> {
  await query(`DELETE FROM app_sessions WHERE token = $1`, [token]);
}

export function toPublic(user: AppUser): AppUserPublic {
  return { id: user.id, name: user.name, email: user.email, role: user.role };
}
