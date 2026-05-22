import 'dotenv/config';
import { initPostgres, query } from '../db/pg.js';
import { upsertMobileUserWithPassword } from '../services/mobileAuthService.js';

type SeedEnterprise = {
  key: 'evora' | 'montaresa' | 'altis';
  name: string;
  slug: string;
};

type SeedConversation = {
  key: 'evora' | 'montaresa' | 'altis';
  externalContactId: string;
  contactPhone: string;
  customerName: string;
  enterpriseKey: SeedEnterprise['key'];
  assignedBrokerKey: 'primary' | 'secondary';
  handoff: boolean;
  leadTemperature: 'quente' | 'morno' | 'frio';
  classification: string;
};

const DEV_MARKER = '[MOBILE DEV]';
const CORRETOR_PHONE = '5511990000001';
const SECONDARY_BROKER_PHONE = '5511990000002';

const ENTERPRISES: SeedEnterprise[] = [
  { key: 'evora', name: `${DEV_MARKER} Evora`, slug: 'mobile-dev-evora' },
  { key: 'montaresa', name: `${DEV_MARKER} Montaresa`, slug: 'mobile-dev-montaresa' },
  { key: 'altis', name: `${DEV_MARKER} Altis`, slug: 'mobile-dev-altis' },
];

const CONVERSATIONS: SeedConversation[] = [
  {
    key: 'evora',
    externalContactId: 'mobile-dev-evora-001',
    contactPhone: '5511911111111',
    customerName: 'Cliente Evora Mobile Teste',
    enterpriseKey: 'evora',
    assignedBrokerKey: 'primary',
    handoff: false,
    leadTemperature: 'morno',
    classification: 'Novo',
  },
  {
    key: 'montaresa',
    externalContactId: 'mobile-dev-montaresa-001',
    contactPhone: '5511922222222',
    customerName: 'Cliente Montaresa Mobile Teste',
    enterpriseKey: 'montaresa',
    assignedBrokerKey: 'secondary',
    handoff: true,
    leadTemperature: 'quente',
    classification: 'Handoff',
  },
  {
    key: 'altis',
    externalContactId: 'mobile-dev-altis-001',
    contactPhone: '5511933333333',
    customerName: 'Cliente Altis Mobile Teste',
    enterpriseKey: 'altis',
    assignedBrokerKey: 'secondary',
    handoff: false,
    leadTemperature: 'frio',
    classification: 'Novo',
  },
];

function digits(value: string): string {
  return value.replace(/\D/g, '');
}

function firstNameFrom(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return 'Cliente';
  const [first] = trimmed.split(/\s+/);
  return first || 'Cliente';
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

async function ensureContact(phoneE164: string, fullName: string, enterpriseId: number): Promise<number> {
  const result = await query<{ id: number }>(
    `INSERT INTO contacts (
       full_name,
       first_name,
       phone_e164,
       phone_display,
       source,
       enterprise_id,
       enterprise_interest,
       updated_at
     )
     VALUES ($1, $2, $3, $3, 'mobile_dev_seed', $4, $1, NOW())
     ON CONFLICT (phone_e164) DO UPDATE
       SET full_name = EXCLUDED.full_name,
           first_name = EXCLUDED.first_name,
           enterprise_id = EXCLUDED.enterprise_id,
           enterprise_interest = EXCLUDED.enterprise_interest,
           updated_at = NOW()
     RETURNING id`,
    [fullName, firstNameFrom(fullName), digits(phoneE164), enterpriseId]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Falha ao garantir contato ${phoneE164}`);
  return row.id;
}

async function ensureConversation(
  item: SeedConversation,
  enterpriseId: number,
  contactId: number,
  assignedBrokerId: number
): Promise<number> {
  const result = await query<{ id: number }>(
    `INSERT INTO conversations (
       channel,
       external_contact_id,
       contact_phone,
       customer_name,
       whatsapp_display_name,
       contact_id,
       enterprise_id,
       classification,
       lead_temperature,
       handoff,
       last_message_at,
       updated_at
     )
     VALUES (
       'whatsapp',
       $1,
       $2,
       $3,
       $3,
       $4,
       $5,
       $6,
       $7,
       $8,
       NOW(),
       NOW()
     )
     ON CONFLICT (channel, external_contact_id) DO UPDATE
       SET contact_phone = EXCLUDED.contact_phone,
           customer_name = EXCLUDED.customer_name,
           whatsapp_display_name = EXCLUDED.whatsapp_display_name,
           contact_id = EXCLUDED.contact_id,
           enterprise_id = EXCLUDED.enterprise_id,
           classification = EXCLUDED.classification,
           lead_temperature = EXCLUDED.lead_temperature,
           handoff = EXCLUDED.handoff,
           last_message_at = NOW(),
           updated_at = NOW()
     RETURNING id`,
    [
      item.externalContactId,
      digits(item.contactPhone),
      item.customerName,
      contactId,
      enterpriseId,
      item.classification,
      item.leadTemperature,
      item.handoff,
    ]
  );
  const row = result.rows[0];
  if (!row) throw new Error(`Falha ao garantir conversa ${item.key}`);

  await query(
    `UPDATE conversations
     SET assigned_broker_id = $1,
         updated_at = NOW()
     WHERE id = $2`,
    [assignedBrokerId, row.id]
  );

  return row.id;
}

async function ensureSeedMessage(
  conversationId: number,
  role: 'user' | 'assistant',
  content: string,
  metaMessageId: string
): Promise<void> {
  const existing = await query<{ id: number; meta_message_id: string | null }>(
    `SELECT id, meta_message_id
     FROM messages
     WHERE conversation_id = $1
       AND role = $2
       AND content = $3
     ORDER BY id ASC
     LIMIT 1`,
    [conversationId, role, content]
  );

  const current = existing.rows[0];
  if (current) {
    if ((current.meta_message_id ?? '') !== metaMessageId) {
      await query(
        `UPDATE messages
         SET meta_message_id = $1
         WHERE id = $2`,
        [metaMessageId, current.id]
      );
    }
    return;
  }

  await query(
    `INSERT INTO messages (
       conversation_id,
       role,
       content,
       meta_message_id,
       created_at
     )
     VALUES ($1, $2, $3, $4, NOW())`,
    [conversationId, role, content, metaMessageId]
  );
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

  const conversationIds: Record<string, number> = {};
  for (const conversation of CONVERSATIONS) {
    const enterpriseId = enterpriseIds.get(conversation.enterpriseKey);
    if (!enterpriseId) continue;

    const contactId = await ensureContact(conversation.contactPhone, conversation.customerName, enterpriseId);
    const assignedBrokerId =
      conversation.assignedBrokerKey === 'primary' ? primaryBrokerId : secondaryBrokerId;

    const conversationId = await ensureConversation(
      conversation,
      enterpriseId,
      contactId,
      assignedBrokerId
    );
    conversationIds[conversation.key] = conversationId;

    await ensureSeedMessage(
      conversationId,
      'user',
      `${DEV_MARKER} Cliente: Tenho interesse no empreendimento ${conversation.enterpriseKey}.`,
      `mobile-dev-${conversation.key}-user-1`
    );
    await ensureSeedMessage(
      conversationId,
      'assistant',
      `${DEV_MARKER} Ana: Perfeito, posso te ajudar com os próximos passos.`,
      `mobile-dev-${conversation.key}-assistant-1`
    );
  }

  console.log('[seed-mobile-conversations-dev] concluido com sucesso', {
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
    conversations: conversationIds,
  });
}

run().catch((error) => {
  console.error('[seed-mobile-conversations-dev] erro:', error);
  process.exit(1);
});
