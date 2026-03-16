import Database from 'better-sqlite3';
import { readFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

let db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!db) {
    const path = config.dbPath;
    const dir = dirname(path);
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      // dir may already exist
    }
    db = new Database(path);
    db.pragma('journal_mode = WAL');
    runMigrations(db);
  }
  return db;
}

function runMigrations(database: Database.Database): void {
  const migrationsDir = join(__dirname, 'migrations');
  const migrations = [
    '001_integration_settings.sql',
    '002_conversations.sql',
    '003_messages.sql',
    '004_webhook_events.sql',
    '005_integration_settings_extra.sql',
    '006_conversations_messages_extra.sql',
    '007_openai_settings.sql',
    '008_lead_funnel.sql',
    '009_fix_integration_settings_created_at.sql',
    '010_openai_columns_safety.sql',
    '011_conversations_project_classification.sql',
    '012_projects_table.sql',
  ];
  for (const name of migrations) {
    const sql = readFileSync(join(migrationsDir, name), 'utf-8');
    const statements = sql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const statement of statements) {
      if (!statement) continue;
      try {
        database.exec(statement + ';');
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('duplicate column name')) continue;
        throw e;
      }
    }
  }
}

export { getDb };
