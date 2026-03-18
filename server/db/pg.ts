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
      await client.query(sql);
    }
  } finally {
    client.release();
  }
  mkdirSync(config.storageEmpreendimentos, { recursive: true });
  console.log(`[pg] ${migrationFiles.length} migrations OK, storage:`, config.storageEmpreendimentos);
}
