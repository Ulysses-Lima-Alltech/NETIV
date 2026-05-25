import { createHmac, timingSafeEqual } from 'crypto';
import { query } from '../db/pg.js';
import { hashPasswordForStorage, verifyPassword } from '../repositories/userRepository.js';

export type MobileUserRole = 'CORRETOR' | 'GESTOR' | 'ADM';

type MobileUserRow = {
  id: number;
  username: string;
  password_hash: string;
  name: string;
  phone: string | null;
  role: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

export type MobileAuthUser = {
  id: number;
  username: string;
  name: string;
  phone: string | null;
  role: MobileUserRole;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

export type MobileAuthPublicUser = {
  id: string;
  username: string;
  name: string;
  role: MobileUserRole;
};

type MobileAuthTokenPayload = {
  sub: string;
  typ: 'mobile_auth';
  iat: number;
  exp: number;
};

export type MobileLoginResult =
  | { ok: true; token: string; user: MobileAuthPublicUser }
  | {
      ok: false;
      code: 'INVALID_CREDENTIALS' | 'USER_INACTIVE' | 'TOKEN_SECRET_MISSING';
    };

export type MobileTokenValidationResult =
  | { ok: true; user: MobileAuthUser }
  | {
      ok: false;
      code: 'INVALID_TOKEN' | 'USER_NOT_FOUND' | 'USER_INACTIVE' | 'TOKEN_SECRET_MISSING';
    };

function isMobileUserRole(value: string): value is MobileUserRole {
  return value === 'CORRETOR' || value === 'GESTOR' || value === 'ADM';
}

function parseMobileUserRole(value: string): MobileUserRole {
  if (!isMobileUserRole(value)) {
    throw new Error(`Role mobile invalida no banco: ${value}`);
  }

  return value;
}

function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

function base64UrlEncode(data: string | Buffer): string {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlToBase64(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
  return normalized + padding;
}

function base64UrlDecodeToString(value: string): string {
  return Buffer.from(base64UrlToBase64(value), 'base64').toString('utf8');
}

function base64UrlDecodeToBuffer(value: string): Buffer {
  return Buffer.from(base64UrlToBase64(value), 'base64');
}

function getMobileAuthSecret(): string | null {
  const secret = String(process.env.MOBILE_AUTH_JWT_SECRET ?? '').trim();
  return secret.length > 0 ? secret : null;
}

function getMobileTokenTtlSeconds(): number {
  const raw = String(process.env.MOBILE_AUTH_TOKEN_TTL_SECONDS ?? '').trim();
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) {
    return Math.floor(parsed);
  }
  return 60 * 60 * 24 * 30;
}

function mapMobileUserRow(row: MobileUserRow): MobileAuthUser {
  return {
    id: row.id,
    username: row.username,
    name: row.name,
    phone: row.phone,
    role: parseMobileUserRole(row.role),
    is_active: row.is_active,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function findMobileUserByUsername(
  username: string
): Promise<(MobileAuthUser & { password_hash: string }) | null> {
  const normalizedUsername = normalizeUsername(username);
  const result = await query<MobileUserRow>(
    `SELECT id, username, password_hash, name, phone, role, is_active, created_at, updated_at
     FROM mobile_users
     WHERE LOWER(username) = $1
     LIMIT 1`,
    [normalizedUsername]
  );
  const row = result.rows[0];
  if (!row) return null;

  const mapped = mapMobileUserRow(row);
  return { ...mapped, password_hash: row.password_hash };
}

async function findMobileUserById(id: number): Promise<MobileAuthUser | null> {
  const result = await query<MobileUserRow>(
    `SELECT id, username, password_hash, name, phone, role, is_active, created_at, updated_at
     FROM mobile_users
     WHERE id = $1
     LIMIT 1`,
    [id]
  );
  const row = result.rows[0];
  return row ? mapMobileUserRow(row) : null;
}

function createMobileAuthToken(userId: number): string | null {
  const secret = getMobileAuthSecret();
  if (!secret) return null;

  const now = Math.floor(Date.now() / 1000);
  const payload: MobileAuthTokenPayload = {
    sub: String(userId),
    typ: 'mobile_auth',
    iat: now,
    exp: now + getMobileTokenTtlSeconds(),
  };

  const headerBase64Url = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payloadBase64Url = base64UrlEncode(JSON.stringify(payload));
  const signatureBase = `${headerBase64Url}.${payloadBase64Url}`;
  const signature = createHmac('sha256', secret).update(signatureBase).digest();
  const signatureBase64Url = base64UrlEncode(signature);

  return `${signatureBase}.${signatureBase64Url}`;
}

function verifyMobileAuthToken(token: string): MobileAuthTokenPayload | null {
  const secret = getMobileAuthSecret();
  if (!secret) return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return null;

  const signatureBase = `${headerPart}.${payloadPart}`;
  const expectedSignature = createHmac('sha256', secret).update(signatureBase).digest();
  const receivedSignature = base64UrlDecodeToBuffer(signaturePart);

  if (receivedSignature.length !== expectedSignature.length) return null;
  if (!timingSafeEqual(receivedSignature, expectedSignature)) return null;

  const payloadRaw = base64UrlDecodeToString(payloadPart);
  let payload: unknown;
  try {
    payload = JSON.parse(payloadRaw);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== 'object') return null;

  const tokenPayload = payload as Partial<MobileAuthTokenPayload>;
  if (tokenPayload.typ !== 'mobile_auth') return null;
  if (typeof tokenPayload.sub !== 'string') return null;
  if (typeof tokenPayload.iat !== 'number') return null;
  if (typeof tokenPayload.exp !== 'number') return null;

  const now = Math.floor(Date.now() / 1000);
  if (tokenPayload.exp < now) return null;

  return tokenPayload as MobileAuthTokenPayload;
}

export function toMobileAuthPublicUser(user: MobileAuthUser): MobileAuthPublicUser {
  return {
    id: String(user.id),
    username: user.username,
    name: user.name,
    role: user.role,
  };
}

export async function loginMobileUser(
  username: string,
  password: string
): Promise<MobileLoginResult> {
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername || !password.trim()) {
    return { ok: false, code: 'INVALID_CREDENTIALS' };
  }

  const user = await findMobileUserByUsername(normalizedUsername);
  if (!user) {
    return { ok: false, code: 'INVALID_CREDENTIALS' };
  }

  const passwordMatches = await verifyPassword(user.password_hash, password);
  if (!passwordMatches) {
    return { ok: false, code: 'INVALID_CREDENTIALS' };
  }

  if (!user.is_active) {
    return { ok: false, code: 'USER_INACTIVE' };
  }

  const token = createMobileAuthToken(user.id);
  if (!token) {
    return { ok: false, code: 'TOKEN_SECRET_MISSING' };
  }

  return {
    ok: true,
    token,
    user: toMobileAuthPublicUser(user),
  };
}

export async function getMobileUserFromAuthToken(token: string): Promise<MobileTokenValidationResult> {
  const secret = getMobileAuthSecret();
  if (!secret) {
    return { ok: false, code: 'TOKEN_SECRET_MISSING' };
  }

  const payload = verifyMobileAuthToken(token);
  if (!payload) {
    return { ok: false, code: 'INVALID_TOKEN' };
  }

  const userId = Number(payload.sub);
  if (!Number.isFinite(userId) || userId <= 0) {
    return { ok: false, code: 'INVALID_TOKEN' };
  }

  const user = await findMobileUserById(userId);
  if (!user) {
    return { ok: false, code: 'USER_NOT_FOUND' };
  }

  if (!user.is_active) {
    return { ok: false, code: 'USER_INACTIVE' };
  }

  return { ok: true, user };
}

export type UpsertMobileUserInput = {
  username: string;
  password: string;
  name: string;
  phone?: string | null;
  role: MobileUserRole;
  isActive?: boolean;
};

export async function upsertMobileUserWithPassword(
  input: UpsertMobileUserInput
): Promise<MobileAuthUser> {
  const username = normalizeUsername(input.username);
  const passwordHash = await hashPasswordForStorage(input.password);

  const result = await query<MobileUserRow>(
    `INSERT INTO mobile_users (username, password_hash, name, phone, role, is_active)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (username) DO UPDATE
       SET password_hash = EXCLUDED.password_hash,
           name = EXCLUDED.name,
           phone = EXCLUDED.phone,
           role = EXCLUDED.role,
           is_active = EXCLUDED.is_active,
           updated_at = NOW()
     RETURNING id, username, password_hash, name, phone, role, is_active, created_at, updated_at`,
    [username, passwordHash, input.name.trim(), input.phone ?? null, input.role, input.isActive ?? true]
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error('Falha ao criar/atualizar usuario mobile.');
  }

  return mapMobileUserRow(row);
}
