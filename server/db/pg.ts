
function isDuplicateAppSessionsScopeColumnError(error: unknown): boolean {
  const err = error as { code?: string; message?: string };
  const message = String(err?.message ?? '').toLowerCase();

  return (
    err?.code === '42701' &&
    message.includes('scope_kind') &&
    message.includes('app_sessions') &&
    message.includes('already exists')
  );
}

async function safeBootstrapQuery(client: any, sql: any, ...params: any[]): Promise<any> {
  try {
    return await client.query(sql, ...params);
  } catch (error) {
    if (isDuplicateAppSessionsScopeColumnError(error)) {
      console.warn('[startup] ignoring duplicate app_sessions.scope_kind bootstrap column');
      return;
    }

    throw error;
  }
}

import { readFileSync, mkdirSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: config.databaseUrl,
      max: 12,
    });
    pool.on('error', (e) => console.error('[pg] pool error', e.message));
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

export async function initPostgres(): Promise<void> {
  const pgMigrationsDir = join(__dirname, 'migrations', 'pg');
  const migrationFiles = readdirSync(pgMigrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const client = await getPool().connect();
  try {
    for (const file of migrationFiles) {
      const sql = readFileSync(join(pgMigrationsDir, file), 'utf-8');
      await safeBootstrapQuery(client, sql);
    }
  } finally {
    client.release();
  }
  mkdirSync(config.storageEmpreendimentos, { recursive: true });
  console.log(`[pg] ${migrationFiles.length} migrations OK, storage:`, config.storageEmpreendimentos);
}




