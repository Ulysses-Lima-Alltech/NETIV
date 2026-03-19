import {
  createUser,
  findByEmailIncludingInactive,
  updatePassword,
  updateUser,
} from '../repositories/userRepository.js';

const BOOTSTRAP_EMAIL = 'ulysses.lima@alltechbr.com';
const BOOTSTRAP_PASSWORD = 'ulysses123';
const BOOTSTRAP_NAME = 'Ulysses Lima';

function isBootstrapEnabled(): boolean {
  return process.env.BOOTSTRAP_ADMIN === 'true';
}

export async function bootstrapFirstAdmin(): Promise<void> {
  if (!isBootstrapEnabled()) {
    return;
  }

  const email = BOOTSTRAP_EMAIL.toLowerCase();
  const existing = await findByEmailIncludingInactive(email);

  if (!existing) {
    await createUser({
      name: BOOTSTRAP_NAME,
      email,
      password: BOOTSTRAP_PASSWORD,
      role: 'ADMIN',
      active: true,
    });
    console.log('[bootstrap-admin] ADMIN criado:', email);
    return;
  }

  await updateUser(existing.id, {
    name: existing.name || BOOTSTRAP_NAME,
    role: 'ADMIN',
    active: true,
  });
  await updatePassword(existing.id, BOOTSTRAP_PASSWORD);
  console.log('[bootstrap-admin] ADMIN garantido/atualizado:', email, '| id:', existing.id);
}
