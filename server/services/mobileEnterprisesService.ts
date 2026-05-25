import { query } from '../db/pg.js';
import type { MobileAuthUser } from './mobileAuthService.js';

type EnterpriseRow = {
  id: number;
  name: string;
  status: string | null;
};

export type MobileEnterpriseItem = {
  id: string;
  name: string;
  active: boolean;
};

export type MobileEnterprisesResponse = {
  enterprises: MobileEnterpriseItem[];
};

export async function getMobileEnterprises(user: MobileAuthUser): Promise<MobileEnterprisesResponse> {
  if (user.role === 'CORRETOR') {
    return { enterprises: [] };
  }

  const result = await query<EnterpriseRow>(
    `SELECT id, name, status
     FROM enterprises
     ORDER BY name ASC`
  );

  return {
    enterprises: result.rows
      .filter((row) => typeof row.name === 'string' && row.name.trim() !== '')
      .map((row) => ({
        id: String(row.id),
        name: row.name.trim(),
        active: row.status === 'ativo',
      })),
  };
}
