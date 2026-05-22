import 'dotenv/config';
import { initPostgres, query } from '../db/pg.js';
import { upsertMobileUserWithPassword } from '../services/mobileAuthService.js';

type SeedEnterprise = {
  key: 'evora' | 'montaresa' | 'altis';
  name: string;
  slug: string;
};

type SeedVisit = {
  key: 'evora' | 'montaresa' | 'altis';
  customerName: string;
  customerPhone: string;
  enterpriseKey: SeedEnterprise['key'];
  brokerKey: 'primary' | 'secondary';
  status: 'CONFIRMADO' | 'PENDENTE_CONFIRMACAO' | 'PENDENTE_DISTRIBUICAO';
  city: string;
  startAtIso: string;
  endAtIso: string;
};

const DEV_MARKER = '[MOBILE DEV]';
const CORRETOR_PHONE = '5511990000001';
const SECONDARY_BROKER_PHONE = '5511990000002';

const ENTERPRISES: SeedEnterprise[] = [
  { key: 'evora', name: `${DEV_MARKER} Evora`, slug: 'mobile-dev-evora' },
  { key: 'montaresa', name: `${DEV_MARKER} Montaresa`, slug: 'mobile-dev-montaresa' },
  { key: 'altis', name: `${DEV_MARKER} Altis`, slug: 'mobile-dev-altis' },
];

const VISITS: SeedVisit[] = [
  {
    key: 'evora',
    customerName: 'Cliente Visita Evora Mobile Teste',
    customerPhone: '5511944444441',
    enterpriseKey: 'evora',
    brokerKey: 'primary',
    status: 'CONFIRMADO',
    city: 'Sao Paulo',
    startAtIso: '2030-01-15T14:00:00.000Z',
    endAtIso: '2030-01-15T15:00:00.000Z',
  },
  {
    key: 'montaresa',
    customerName: 'Cliente Visita Montaresa Mobile Teste',
    customerPhone: '5511944444442',
    enterpriseKey: 'montaresa',
    brokerKey: 'secondary',
    status: 'PENDENTE_CONFIRMACAO',
    city: 'Sao Paulo',
    startAtIso: '2030-01-16T16:00:00.000Z',
    endAtIso: '2030-01-16T17:00:00.000Z',
  },
  {
    key: 'altis',
    customerName: 'Cliente Visita Altis Mobile Teste',
    customerPhone: '5511944444443',
    enterpriseKey: 'altis',
    brokerKey: 'secondary',
    status: 'CONFIRMADO',
    city: 'Sao Paulo',
    startAtIso: '2030-01-17T18:00:00.000Z',
    endAtIso: '2030-01-17T19:00:00.000Z',
  },
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
  const found = await query<{ id: number }>(
    `SELECT id
     FROM corretores
     WHERE regexp_replace(COALESCE(phone, ''), '\D', '', 'g') = $1
     ORDER BY id ASC
     LIMIT 1`,
    [digits(phone)]
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
      [fullName, digits(phone), id]
    );
    return id;
  }

  const created = await query<{ id: number }>(
    `INSERT INTO corretores (full_name, city, phone, real_estate_agency, active, updated_at)
     VALUES ($1, '', $2, 'NETIV MOBILE DEV', true, NOW())
     RETURNING id`,
    [fullName, digits(phone)]
  );
  const row = created.rows[0];
  if (!row) throw new Error(`Falha ao criar corretor ${fullName}`);
  return row.id;
}

async function ensureMobileUsers(): Promise<{ corretorId: number; gestorId: number; adminId: number }> {
  const corretor = await upsertMobileUserWithPassword({
    username: 'corretor',
    password: 'corretor',
    name: 'Corretor Teste',
    role: 'CORRETOR',
    phone: CORRETOR_PHONE,
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

async function ensureMobileEnterpriseLink(
  userId: number,
  enterpriseId: number,
  canManage: boolean
): Promise<void> {
  await query(
    `INSERT INTO mobile_user_enterprises (user_id, enterprise_id, can_manage, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, enterprise_id) DO UPDATE
       SET can_manage = EXCLUDED.can_manage,
           updated_at = NOW()`,
    [userId, enterpriseId, canManage]
  );
}

async function ensureVisit(
  visit: SeedVisit,
  enterpriseId: number,
  brokerId: number
): Promise<number> {
  const startAt = new Date(visit.startAtIso);
  const endAt = new Date(visit.endAtIso);
  const notes = `${DEV_MARKER} Seed visita ${visit.key}`;

  const existing = await query<{ id: number }>(
    `SELECT id
     FROM appointments
     WHERE customer_name = $1
       AND enterprise_id = $2
       AND source = 'MOBILE_DEV'
     ORDER BY id ASC
     LIMIT 1`,
    [visit.customerName, enterpriseId]
  );

  if (existing.rows[0]) {
    const id = existing.rows[0].id;
    await query(
      `UPDATE appointments
       SET customer_phone = $1,
           broker_id = $2,
           city = $3,
           start_at = $4,
           end_at = $5,
           status = $6,
           source = 'MOBILE_DEV',
           notes = $7,
           updated_at = NOW()
       WHERE id = $8`,
      [digits(visit.customerPhone), brokerId, visit.city, startAt, endAt, visit.status, notes, id]
    );
    return id;
  }

  const created = await query<{ id: number }>(
    `INSERT INTO appointments (
       customer_name,
       customer_phone,
       enterprise_id,
       broker_id,
       city,
       start_at,
       end_at,
       status,
       source,
       notes,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'MOBILE_DEV', $9, NOW())
     RETURNING id`,
    [
      visit.customerName,
      digits(visit.customerPhone),
      enterpriseId,
      brokerId,
      visit.city,
      startAt,
      endAt,
      visit.status,
      notes,
    ]
  );
  const row = created.rows[0];
  if (!row) throw new Error(`Falha ao criar visita ${visit.key}`);
  return row.id;
}

async function run(): Promise<void> {
  await initPostgres();

  const mobileUsers = await ensureMobileUsers();
  const primaryBrokerId = await ensureCorretor(`${DEV_MARKER} Corretor Principal`, CORRETOR_PHONE);
  const secondaryBrokerId = await ensureCorretor(`${DEV_MARKER} Corretor Secundario`, SECONDARY_BROKER_PHONE);

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

  await ensureMobileEnterpriseLink(mobileUsers.gestorId, evoraId, true);
  await ensureMobileEnterpriseLink(mobileUsers.gestorId, montaresaId, true);
  await ensureMobileEnterpriseLink(mobileUsers.corretorId, evoraId, false);
  await ensureMobileEnterpriseLink(mobileUsers.corretorId, montaresaId, false);

  const visitIds: Record<string, number> = {};
  for (const visit of VISITS) {
    const enterpriseId = enterpriseIds.get(visit.enterpriseKey);
    if (!enterpriseId) continue;

    const brokerId = visit.brokerKey === 'primary' ? primaryBrokerId : secondaryBrokerId;
    const visitId = await ensureVisit(visit, enterpriseId, brokerId);
    visitIds[visit.key] = visitId;
  }

  console.log('[seed-mobile-visits-dev] concluido com sucesso', {
    marker: DEV_MARKER,
    users: {
      corretorMobileUserId: mobileUsers.corretorId,
      gestorMobileUserId: mobileUsers.gestorId,
      adminMobileUserId: mobileUsers.adminId,
    },
    brokers: {
      primaryBrokerId,
      secondaryBrokerId,
    },
    enterprises: {
      evoraId,
      montaresaId,
      altisId,
    },
    visits: visitIds,
  });
}

run().catch((error) => {
  console.error('[seed-mobile-visits-dev] erro:', error);
  process.exit(1);
});
