import { mkdirSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
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
      // Sem esses timeouts, uma única conexão travada/vazada (rede instável,
      // query longa demais, cliente pego via pool.connect() e nunca liberado)
      // esgota o pool inteiro pra sempre — toda query nova fica esperando um
      // slot que nunca libera, sem erro nenhum, até o processo ser reiniciado
      // manualmente. Causa raiz confirmada de uma parada total de produção
      // (nenhum turno da Ana processado por dias, sem nenhum erro logado).
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 30_000,
      query_timeout: 30_000,
    });
    pool.on('error', (error) => console.error('[pg] pool error', error.message));
  }
  return pool;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/**
 * Inicialização idempotente usando a mesma tabela de controle do comando migrate.
 * Cada arquivo novo é aplicado exatamente uma vez e dentro de uma transação.
 */
type InitPostgresOptions = {
  applyMigrations?: boolean;
};

export async function initPostgres(options: InitPostgresOptions = {}): Promise<void> {
  const applyMigrations = options.applyMigrations ?? true;
  const migrationsDir = join(__dirname, 'migrations', 'pg');
  const migrationFiles = readdirSync(migrationsDir).filter((file) => file.endsWith('.sql')).sort();
  const client = await getPool().connect();
  let appliedCount = 0;
  try {
    if (applyMigrations) {
      await client.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
          filename VARCHAR(512) PRIMARY KEY,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
    } else {
      const control = await client.query<{ table_name: string | null }>(
        `SELECT to_regclass('public.schema_migrations')::text AS table_name`
      );
      if (!control.rows[0]?.table_name) {
        throw new Error('Banco sem controle de migrations. Execute npm run migrate:deploy antes de iniciar em producao.');
      }
    }
    const applied = await client.query<{ filename: string }>(`SELECT filename FROM schema_migrations`);
    const appliedNames = new Set(applied.rows.map((row) => row.filename));
    const pending = migrationFiles.filter((filename) => !appliedNames.has(filename));
    if (!applyMigrations && pending.length > 0) {
      throw new Error(`Existem ${pending.length} migration(s) pendente(s): ${pending.join(', ')}. Execute npm run migrate:deploy.`);
    }
    for (const filename of applyMigrations ? pending : []) {
      const sql = readFileSync(join(migrationsDir, filename), 'utf8');
      await client.query('BEGIN');
      try {
        if (sql.trim()) await client.query(sql);
        await client.query(`INSERT INTO schema_migrations (filename) VALUES ($1)`, [filename]);
        await client.query('COMMIT');
        appliedCount++;
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${filename} falhou: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } finally {
    client.release();
  }
  mkdirSync(config.storageEmpreendimentos, { recursive: true });
  console.log(`[pg] migrations=${migrationFiles.length} applied=${appliedCount} mode=${applyMigrations ? 'apply' : 'verify'} storage=${config.storageEmpreendimentos}`);
}
