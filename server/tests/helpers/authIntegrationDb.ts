import assert from 'node:assert/strict';
import pg from 'pg';

export function integrationDatabaseUrl(): string | null {
  const value = process.env.TEST_DATABASE_URL?.trim() ?? '';
  if (!value) return null;
  const parsed = new URL(value);
  const databaseName = parsed.pathname.replace(/^\//, '').toLowerCase();
  assert.match(databaseName, /(test|spec)/, 'TEST_DATABASE_URL deve apontar para um banco nomeado como teste.');
  return value;
}

export function createIntegrationPool(): pg.Pool | null {
  const connectionString = integrationDatabaseUrl();
  return connectionString ? new pg.Pool({ connectionString, max: 6 }) : null;
}

export async function resetAuthIntegrationData(pool: pg.Pool): Promise<void> {
  await pool.query(`
    TRUNCATE TABLE
      app_access_audit,
      app_sso_token_uses,
      app_sessions,
      app_user_management,
      app_user_enterprises,
      app_user_brokers,
      app_user_conversations,
      app_user_contacts,
      app_user_appointments,
      messages,
      appointments,
      contacts,
      conversations,
      corretor_empreendimentos,
      corretores,
      enterprises,
      app_users
    RESTART IDENTITY CASCADE
  `);
}
