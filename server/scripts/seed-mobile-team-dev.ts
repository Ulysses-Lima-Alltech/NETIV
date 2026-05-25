import 'dotenv/config';
import { initPostgres, query } from '../db/pg.js';
import { upsertMobileUserWithPassword } from '../services/mobileAuthService.js';

type SeedEnterprise = {
  key: 'evora' | 'montaresa' | 'altis';
  name: string;
  slug: string;
};

const DEV_MARKER = '[MOBILE DEV]';
const PRIMARY_BROKER_NAME = `${DEV_MARKER} Corretor Principal`;
const SECONDARY_BROKER_NAME = `${DEV_MARKER} Corretor Secundario`;
const PRIMARY_BROKER_PHONE = '5511990000001';
const SECONDARY_BROKER_PHONE = '5511990000002';

const ENTERPRISES: SeedEnterprise[] = [
  { key: 'evora', name: `${DEV_MARKER} Evora`, slug: 'mobile-dev-evora' },
  { key: 'montaresa', name: `${DEV_MARKER} Montaresa`, slug: 'mobile-dev-montaresa' },
  { key: 'altis', name: `${DEV_MARKER} Altis`, slug: 'mobile-dev-altis' },
];

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

async function ensureEnterprise(input: SeedEnterprise): Promise<number> {
  const result = await query<{ id: number }>(
    `INSERT INTO enterprises (name, slug, status, language_style, prompt_addons, tipo, exclusivo, updated_at)
     VALUES ($1, $2, 'ativo', 'natural', '[]', 'APARTAMENTO', false, NOW())
     ON CONFLICT (slug) DO UPDATE
       SET name = EXCLUDED.name,
           status = 'ativo',
           updated_at = NOW()
     RETURNING id`,
    [input.name, input.slug]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Falha ao garantir empreendimento ${input.slug}`);
  return row.id;
}

async function ensureCorretor(fullName: string, phone: string): Promise<number> {
  const normalizedPhone = digits(phone);
  const found = await query<{ id: number }>(
    `SELECT id
     FROM corretores
     WHERE full_name = $1
        OR regexp_replace(COALESCE(phone, ''), '\\D', '', 'g') = $2
     ORDER BY id ASC
     LIMIT 1`,
    [fullName, normalizedPhone]
  );

  if (found.rows[0]) {
    const id = found.rows[0].id;
    await query(
      `UPDATE corretores
       SET full_name = $1,
           phone = $2,
           active = true,
           updated_at = NOW()
       WHERE id = $3`,
      [fullName, normalizedPhone, id]
    );
    return id;
  }

  const created = await query<{ id: number }>(
    `INSERT INTO corretores (full_name, city, phone, real_estate_agency, active, updated_at)
     VALUES ($1, '', $2, 'NETIV MOBILE DEV', true, NOW())
     RETURNING id`,
    [fullName, normalizedPhone]
  );
  const row = created.rows[0];
  if (!row) throw new Error(`Falha ao criar corretor ${fullName}`);
  return row.id;
}

async function ensureCorretorEnterpriseLink(corretorId: number, enterpriseId: number): Promise<void> {
  await query(
    `INSERT INTO corretor_empreendimentos (corretor_id, enterprise_id)
     VALUES ($1, $2)
     ON CONFLICT (corretor_id, enterprise_id) DO NOTHING`,
    [corretorId, enterpriseId]
  );
}

async function ensureMobileUsers(): Promise<{ corretorId: number; gestorId: number; adminId: number }> {
  const corretor = await upsertMobileUserWithPassword({
    username: 'corretor',
    password: 'corretor',
    name: 'Corretor Teste',
    role: 'CORRETOR',
    phone: PRIMARY_BROKER_PHONE,
    isActive: true,
  });

  const gestor = await upsertMobileUserWithPassword({
    username: 'gestor',
    password: 'gestor',
    name: 'Gestor Teste',
    role: 'GESTOR',
    phone: '5511990000009',
    isActive: true,
  });

  const admin = await upsertMobileUserWithPassword({
    username: 'admin',
    password: 'admin',
    name: 'Administrador Teste',
    role: 'ADM',
    phone: '5511990000010',
    isActive: true,
  });

  return { corretorId: corretor.id, gestorId: gestor.id, adminId: admin.id };
}

async function upsertMobileEnterpriseLink(userId: number, enterpriseId: number, canManage: boolean): Promise<void> {
  await query(
    `INSERT INTO mobile_user_enterprises (user_id, enterprise_id, can_manage, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, enterprise_id) DO UPDATE
       SET can_manage = EXCLUDED.can_manage,
           updated_at = NOW()`,
    [userId, enterpriseId, canManage]
  );
}

async function run(): Promise<void> {
  await initPostgres();

  const mobileUsers = await ensureMobileUsers();
  const primaryBrokerId = await ensureCorretor(PRIMARY_BROKER_NAME, PRIMARY_BROKER_PHONE);
  const secondaryBrokerId = await ensureCorretor(SECONDARY_BROKER_NAME, SECONDARY_BROKER_PHONE);

  const enterpriseIds = new Map<SeedEnterprise['key'], number>();
  for (const enterprise of ENTERPRISES) {
    const id = await ensureEnterprise(enterprise);
    enterpriseIds.set(enterprise.key, id);
  }

  const evoraId = enterpriseIds.get('evora');
  const montaresaId = enterpriseIds.get('montaresa');
  const altisId = enterpriseIds.get('altis');
  if (!evoraId || !montaresaId || !altisId) {
    throw new Error('Falha ao resolver IDs dos empreendimentos de seed.');
  }

  await ensureCorretorEnterpriseLink(primaryBrokerId, evoraId);
  await ensureCorretorEnterpriseLink(secondaryBrokerId, montaresaId);
  await ensureCorretorEnterpriseLink(primaryBrokerId, altisId);

  await upsertMobileEnterpriseLink(mobileUsers.gestorId, evoraId, true);
  await upsertMobileEnterpriseLink(mobileUsers.gestorId, montaresaId, true);
  await upsertMobileEnterpriseLink(mobileUsers.gestorId, altisId, false);

  console.log('[seed-mobile-team-dev] concluido com sucesso', {
    marker: DEV_MARKER,
    brokers: {
      primaryBrokerId,
      secondaryBrokerId,
    },
    enterprises: {
      evoraId,
      montaresaId,
      altisId,
    },
    mobileUsers: {
      corretorMobileUserId: mobileUsers.corretorId,
      gestorMobileUserId: mobileUsers.gestorId,
      adminMobileUserId: mobileUsers.adminId,
    },
    links: {
      corretor_empreendimentos: [
        [primaryBrokerId, evoraId],
        [secondaryBrokerId, montaresaId],
        [primaryBrokerId, altisId],
      ],
      mobile_user_enterprises: [
        [mobileUsers.gestorId, evoraId, true],
        [mobileUsers.gestorId, montaresaId, true],
        [mobileUsers.gestorId, altisId, false],
      ],
    },
  });
}

run().catch((error) => {
  console.error('[seed-mobile-team-dev] erro:', error);
  process.exit(1);
});
