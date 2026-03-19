/**
 * Cria um usuário ADMIN inicial para login.
 * Uso: npx tsx scripts/seed-admin.ts
 *
 * Variáveis de ambiente:
 * - SEED_ADMIN_EMAIL (obrigatório em produção)
 * - SEED_ADMIN_PASSWORD (obrigatório em produção)
 * - SEED_ADMIN_NAME (opcional, padrão: Administrador)
 *
 * Em desenvolvimento: se nenhuma variável estiver definida, usa admin@netiv.com / admin123.
 * Em produção (NODE_ENV=production): não usa credenciais padrão; exibe aviso e não cria usuário.
 */
import 'dotenv/config';
import { hashPasswordForStorage } from '../repositories/userRepository.js';
import { getPool } from '../db/pg.js';

const DEV_DEFAULT_EMAIL = 'admin@netiv.com';
const DEV_DEFAULT_PASSWORD = 'admin123';
const MIN_PASSWORD_LENGTH = 8;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

async function seed() {
  const envEmail = process.env.SEED_ADMIN_EMAIL?.trim();
  const envPassword = process.env.SEED_ADMIN_PASSWORD;
  const envName = process.env.SEED_ADMIN_NAME?.trim() ?? 'Administrador';

  const production = isProduction();
  let email: string;
  let password: string;

  if (envEmail && envPassword !== undefined && envPassword !== '') {
    email = envEmail.toLowerCase();
    password = envPassword;
    if (production && password.length < MIN_PASSWORD_LENGTH) {
      console.warn('[seed-admin] AVISO: Em produção use senha com pelo menos 8 caracteres.');
    }
  } else if (production) {
    console.warn(
      '[seed-admin] Em produção defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD. Nenhum usuário criado com credenciais padrão.'
    );
    return;
  } else {
    email = DEV_DEFAULT_EMAIL;
    password = DEV_DEFAULT_PASSWORD;
    console.log('[seed-admin] Desenvolvimento: usando credenciais padrão (admin@netiv.com). Em produção defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD.');
  }

  const hash = await hashPasswordForStorage(password);
  const pool = getPool();
  const result = await pool.query(
    `INSERT INTO app_users (name, email, password_hash, role, active)
     VALUES ($1, $2, $3, 'ADMIN', true)
     ON CONFLICT (email) DO NOTHING
     RETURNING id`,
    [envName, email, hash]
  );

  if (result.rows.length > 0) {
    console.log('[seed-admin] Usuário admin criado:', email, '| role: ADMIN');
  } else {
    const r = await pool.query('SELECT id, email, role FROM app_users WHERE LOWER(email) = $1', [email]);
    if (r.rows.length) {
      console.log('[seed-admin] Usuário já existe:', r.rows[0].email, '| role:', r.rows[0].role);
    } else {
      console.log('[seed-admin] Nenhum usuário criado.');
    }
  }
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
