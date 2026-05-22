import 'dotenv/config';
import { initPostgres } from '../db/pg.js';
import {
  type MobileUserRole,
  upsertMobileUserWithPassword,
} from '../services/mobileAuthService.js';

type MobileSeedUser = {
  username: string;
  password: string;
  name: string;
  role: MobileUserRole;
  phone?: string | null;
};

const DEFAULT_USERS: MobileSeedUser[] = [
  {
    username: 'corretor',
    password: 'corretor',
    name: 'Corretor Teste',
    role: 'CORRETOR',
  },
  {
    username: 'gestor',
    password: 'gestor',
    name: 'Gestor Teste',
    role: 'GESTOR',
  },
  {
    username: 'admin',
    password: 'admin',
    name: 'Administrador Teste',
    role: 'ADM',
  },
];

async function seedMobileUsers(): Promise<void> {
  await initPostgres();

  for (const user of DEFAULT_USERS) {
    const saved = await upsertMobileUserWithPassword({
      username: user.username,
      password: user.password,
      name: user.name,
      role: user.role,
      phone: user.phone ?? null,
      isActive: true,
    });

    console.log('[seed-mobile-users] usuario sincronizado:', {
      id: saved.id,
      username: saved.username,
      role: saved.role,
      isActive: saved.is_active,
    });
  }
}

seedMobileUsers().catch((error) => {
  console.error('[seed-mobile-users] erro:', error);
  process.exit(1);
});
