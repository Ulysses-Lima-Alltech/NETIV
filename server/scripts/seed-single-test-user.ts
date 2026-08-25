import 'dotenv/config';
import { getPool } from '../db/pg.js';
import { hashPasswordForStorage } from '../repositories/userRepository.js';

const USERNAME = 'teste';
const NAME = 'Usuário de Teste';
const ROLE = 'ADMIN';

async function main(): Promise<void> {
  const password = process.env.TEST_ACCESS_PASSWORD?.trim();
  if (!password) {
    throw new Error('Defina TEST_ACCESS_PASSWORD no ambiente.');
  }

  const pool = getPool();
  const client = await pool.connect();
  try {
    const existing = await client.query<{ id: number }>(
      'SELECT id FROM app_users WHERE LOWER(username) = $1 LIMIT 1',
      [USERNAME]
    );

    if (existing.rows[0]) {
      console.log('[seed-single-test-user] usuário já existe:', USERNAME);
      return;
    }

    const passwordHash = await hashPasswordForStorage(password);
    const result = await client.query<{ id: number }>(
      `INSERT INTO app_users
         (username, name, email, password_hash, role, active, must_change_password, broker_id, django_user_id)
       VALUES ($1, $2, NULL, $3, $4, true, false, NULL, NULL)
       RETURNING id`,
      [USERNAME, NAME, passwordHash, ROLE]
    );

    console.log('[seed-single-test-user] criado:', {
      id: result.rows[0]?.id,
      username: USERNAME,
      role: ROLE,
    });
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[seed-single-test-user] erro:', error instanceof Error ? error.message : error);
  process.exit(1);
});
