import 'dotenv/config';
import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, 'migrations', 'pg');

const databaseUrl = (process.env.DATABASE_URL ?? '').trim() || config.databaseUrl;

async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename VARCHAR(512) PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  console.log('[migrate] tabela de controle schema_migrations OK');
}

async function getAppliedFilenames(client: pg.PoolClient): Promise<Set<string>> {
  const { rows } = await client.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY filename'
  );
  return new Set(rows.map((r) => r.filename));
}

function listMigrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b, 'en'));
}

async function run(): Promise<void> {
  if ((process.env.DATABASE_URL ?? '').trim()) {
    console.log('[migrate] DATABASE_URL lida do ambiente.');
  } else {
    console.log('[migrate] DATABASE_URL ausente; usando fallback de config.ts.');
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const applied = await getAppliedFilenames(client);
    const files = listMigrationFiles();
    if (files.length === 0) {
      console.log('[migrate] nenhum arquivo .sql em', MIGRATIONS_DIR);
      return;
    }

    let pending = 0;
    for (const filename of files) {
      if (applied.has(filename)) {
        console.log('[migrate] já aplicada:', filename);
        continue;
      }
      pending++;
      const path = join(MIGRATIONS_DIR, filename);
      const sql = readFileSync(path, 'utf-8');
      if (!sql.trim()) {
        console.warn('[migrate] arquivo vazio, registrando sem SQL:', filename);
        await client.query('BEGIN');
        try {
          await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
          await client.query('COMMIT');
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        }
        console.log('[migrate] concluída (vazia):', filename);
        continue;
      }

      console.log('[migrate] aplicando:', filename);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
        await client.query('COMMIT');
        console.log('[migrate] concluída:', filename);
      } catch (e) {
        await client.query('ROLLBACK');
        console.error('[migrate] falha em', filename, e);
        throw e;
      }
    }

    if (pending === 0) {
      console.log('[migrate] nada pendente; total de arquivos:', files.length);
    } else {
      console.log('[migrate] finalizado;', pending, 'nova(s) migration(s) aplicada(s).');
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error('[migrate] erro:', err);
  process.exit(1);
});
