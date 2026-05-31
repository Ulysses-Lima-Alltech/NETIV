import { query } from '../db/pg.js';

export interface MobileUserDeviceTokenRow {
  id: number;
  user_id: number;
  token: string;
  platform: string | null;
  active: boolean;
  last_seen_at: Date;
  created_at: Date;
  updated_at: Date;
}

function normalizeToken(raw: string): string {
  return raw.trim().slice(0, 500);
}

function normalizePlatform(raw: string | null | undefined): string | null {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return null;
  return value.slice(0, 40);
}

export async function upsertMobileUserDeviceToken(args: {
  userId: number;
  token: string;
  platform?: string | null;
}): Promise<MobileUserDeviceTokenRow> {
  const normalizedToken = normalizeToken(args.token);
  const platform = normalizePlatform(args.platform);

  const { rows } = await query<MobileUserDeviceTokenRow>(
    `INSERT INTO mobile_user_device_tokens (user_id, token, platform, active, last_seen_at, updated_at)
     VALUES ($1, $2, $3, true, NOW(), NOW())
     ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id,
           platform = COALESCE(EXCLUDED.platform, mobile_user_device_tokens.platform),
           active = true,
           last_seen_at = NOW(),
           updated_at = NOW()
     RETURNING id, user_id, token, platform, active, last_seen_at, created_at, updated_at`,
    [args.userId, normalizedToken, platform]
  );

  const row = rows[0];
  if (!row) {
    throw new Error('Falha ao registrar token mobile.');
  }
  return row;
}

export async function listActiveMobileDeviceTokensByBrokerId(
  brokerId: number
): Promise<string[]> {
  const { rows } = await query<{ token: string }>(
    `SELECT dt.token
     FROM mobile_user_device_tokens dt
     INNER JOIN mobile_users mu ON mu.id = dt.user_id
     WHERE mu.corretor_id = $1
       AND mu.is_active = true
       AND dt.active = true
     ORDER BY dt.updated_at DESC, dt.id DESC`,
    [brokerId]
  );
  return rows.map((row) => row.token).filter((token) => token.trim().length > 0);
}

