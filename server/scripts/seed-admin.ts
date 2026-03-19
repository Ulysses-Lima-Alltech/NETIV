/**
 * Garante um usuário ADMIN (upsert por e-mail): cria ou atualiza role, active e senha.
 * Uso (pasta server): npx tsx scripts/seed-admin.ts
 *
 * Variáveis de ambiente:
 * - SEED_ADMIN_EMAIL (opcional; em dev o padrão é ulysses.lima@alltechbr.com)
 * - SEED_ADMIN_PASSWORD (opcional; em dev o padrão é ulysses123)
 * - SEED_ADMIN_NAME (opcional; padrão: Ulysses Lima)
 *
 * Em produção (NODE_ENV=production): exige SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD.
 */
import 'dotenv/config';
import { initPostgres } from '../db/pg.js';
import {
  findByEmailIncludingInactive,
  createUser,
  updateUser,
  updatePassword,
} from '../repositories/userRepository.js';

const DEV_DEFAULT_EMAIL = 'ulysses.lima@alltechbr.com';
const DEV_DEFAULT_PASSWORD = 'ulysses123';
const DEV_DEFAULT_NAME = 'Ulysses Lima';
const MIN_PASSWORD_LENGTH = 8;

function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

async function seed() {
  await initPostgres();

  const envEmail = process.env.SEED_ADMIN_EMAIL?.trim();
  const envPassword = process.env.SEED_ADMIN_PASSWORD;
  const envName = process.env.SEED_ADMIN_NAME?.trim();

  const production = isProduction();
  let email: string;
  let password: string;
  let name: string;

  if (envEmail && envPassword !== undefined && envPassword !== '') {
    email = envEmail.toLowerCase();
    password = envPassword;
    name = envName && envName !== '' ? envName : 'Administrador';
    if (production && password.length < MIN_PASSWORD_LENGTH) {
      console.warn('[seed-admin] AVISO: Em produção use senha com pelo menos 8 caracteres.');
    }
  } else if (production) {
    console.warn(
      '[seed-admin] Em produção defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD. Nenhum usuário atualizado.'
    );
    return;
  } else {
    email = DEV_DEFAULT_EMAIL.toLowerCase();
    password = DEV_DEFAULT_PASSWORD;
    name = envName && envName !== '' ? envName : DEV_DEFAULT_NAME;
    console.log(
      '[seed-admin] Desenvolvimento: garantindo usuário padrão',
      email,
      '| defina SEED_ADMIN_* para outro e-mail em produção.'
    );
  }

  const existing = await findByEmailIncludingInactive(email);

  if (!existing) {
    await createUser({
      name,
      email,
      password,
      role: 'ADMIN',
      active: true,
    });
    console.log('[seed-admin] Usuário ADMIN criado:', email);
    return;
  }

  await updateUser(existing.id, { role: 'ADMIN', active: true, name });
  await updatePassword(existing.id, password);
  console.log('[seed-admin] Usuário existente atualizado (ADMIN, active, senha):', email, '| id:', existing.id);
}

seed().catch((e) => {
  console.error(e);
  process.exit(1);
});
