import { createHash } from 'node:crypto';
import { getPool, query } from '../db/pg.js';
import type { WhatsAppTemplateCatalogItem } from '../catalogs/whatsappTemplates.js';
import { renderTemplateTextForInbox } from '../catalogs/whatsappTemplates.js';
import { insertMessage } from '../repositories/messageRepository.js';
import { getUnclassifiedLeadSettings } from '../repositories/anaUnclassifiedLeadSettingsRepository.js';
import { listEnterprises } from '../repositories/enterpriseRepository.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import { getTriageCities } from '../utils/anaUnclassifiedLeadTriage.js';
import { sendAnaTextMessageWithQuota } from './anaOutboundQuotaService.js';
import { sendTemplateMessage } from './whatsappMetaService.js';
import { listBatchTemplatesFromMetaOrFallback } from './whatsappTemplateCatalogSyncService.js';
import { publishConversationUpdated } from '../realtime/realtimePublisher.js';

const CUSTOMER_SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

interface FollowupCandidateRow {
  conversation_id: number;
  customer_name: string | null;
  contact_phone: string | null;
  external_contact_id: string | null;
  last_user_message_at: Date | string;
}

export interface UnclassifiedLeadFollowupPreviewRow {
  conversationId: number;
  customerName: string | null;
  phoneMasked: string;
  lastUserMessageAt: string;
  deliveryType: 'SERVICE_TEXT' | 'MARKETING_TEMPLATE';
}

export interface UnclassifiedLeadFollowupTemplate {
  key: string;
  name: string;
  languageCode: string;
  body: string;
}

export function isApprovedSimpleMarketingTemplate(
  template: WhatsAppTemplateCatalogItem
): boolean {
  return (
    template.source === 'meta' &&
    String(template.status ?? '').toUpperCase() === 'APPROVED' &&
    String(template.category ?? '').toUpperCase() === 'MARKETING' &&
    String(template.languageCode ?? '').toLowerCase() === 'pt_br' &&
    template.variables.length === 0 &&
    !template.requiresHeaderMedia &&
    !template.hasHeaderImage &&
    !template.hasHeaderVideo &&
    !template.hasHeaderDocument &&
    Boolean(template.messageBodyTemplate?.trim())
  );
}

function maskPhone(phone: string): string {
  return `•••• ${phone.slice(-4)}`;
}

export function getFollowupDeliveryType(
  lastUserMessageAt: Date | string,
  now = Date.now()
): UnclassifiedLeadFollowupPreviewRow['deliveryType'] {
  const timestamp = new Date(lastUserMessageAt).getTime();
  return Number.isFinite(timestamp) && now - timestamp < CUSTOMER_SERVICE_WINDOW_MS
    ? 'SERVICE_TEXT'
    : 'MARKETING_TEMPLATE';
}

export function getUnclassifiedFollowupTemplatesFromCatalog(
  templates: WhatsAppTemplateCatalogItem[],
  fallbackUsed: boolean
): UnclassifiedLeadFollowupTemplate[] {
  if (fallbackUsed) return [];
  return templates
    .filter(isApprovedSimpleMarketingTemplate)
    .map((template) => ({
      key: template.key,
      name: template.name,
      languageCode: template.languageCode,
      body: template.messageBodyTemplate!.trim(),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

function makePreviewFingerprint(
  candidates: Array<{
    conversationId: number;
    lastUserMessageAt: string;
    deliveryType: UnclassifiedLeadFollowupPreviewRow['deliveryType'];
  }>,
  templateKey: string,
  marketingTemplateBody: string,
  followUpMessage: string | null,
  cities: string[]
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      candidates: [...candidates].sort((a, b) => a.conversationId - b.conversationId),
      templateKey,
      marketingTemplateBody,
      followUpMessage,
      cities,
    }))
    .digest('hex');
}

function renderFollowupText(message: string, cities: string[]): string {
  const cityList = cities.length > 1
    ? `${cities.slice(0, -1).join(', ')} e ${cities[cities.length - 1]}`
    : cities[0] ?? 'cidades a confirmar com nossa equipe';
  return message.replaceAll('{cidades}', cityList);
}

async function listEligibleCandidates(): Promise<FollowupCandidateRow[]> {
  const { rows } = await query<FollowupCandidateRow>(
    `SELECT c.id AS conversation_id,
            COALESCE(NULLIF(TRIM(c.customer_name), ''), NULLIF(TRIM(ct.full_name), '')) AS customer_name,
            c.contact_phone,
            c.external_contact_id,
            inbound.last_user_message_at
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       JOIN LATERAL (
         SELECT MAX(m.created_at) AS last_user_message_at
           FROM messages m
          WHERE m.conversation_id = c.id
            AND m.role = 'user'
            AND m.deleted_at IS NULL
       ) inbound ON inbound.last_user_message_at IS NOT NULL
      WHERE lower(trim(COALESCE(c.channel, ''))) = 'whatsapp'
        AND upper(trim(COALESCE(c.conversation_type, 'CLIENT'))) = 'CLIENT'
        AND c.enterprise_id IS NULL
        AND c.enterprise_origin_id IS NULL
        AND ct.enterprise_id IS NULL
        AND COALESCE(c.handoff, false) = false
        AND lower(trim(COALESCE(c.classification, ''))) NOT IN ('handoff', 'carteira')
        AND c.manual_closed_at IS NULL
        AND COALESCE(NULLIF(TRIM(c.contact_phone), ''), NULLIF(TRIM(c.external_contact_id), '')) IS NOT NULL
      ORDER BY inbound.last_user_message_at DESC, c.id DESC`
  );
  return rows;
}

async function getApprovedMarketingTemplate(templateKey: string): Promise<WhatsAppTemplateCatalogItem> {
  const { templates, fallbackUsed } = await listBatchTemplatesFromMetaOrFallback({ forceRefresh: true });
  if (fallbackUsed) throw new Error('Não foi possível validar os templates diretamente com a Meta.');
  const template = templates.find((item) => item.key === templateKey);
  if (!template || !isApprovedSimpleMarketingTemplate(template)) {
    throw new Error('Selecione um template de Marketing aprovado, sem variáveis e sem mídia de cabeçalho.');
  }
  return template;
}

function toPreviewRows(rows: FollowupCandidateRow[], now = Date.now()): UnclassifiedLeadFollowupPreviewRow[] {
  const seenPhones = new Set<string>();
  return rows.flatMap((row) => {
    const phone = normalizePhoneE164(row.contact_phone ?? row.external_contact_id);
    if (!phone || phone.length > 15 || phone.length < 10 || seenPhones.has(phone)) return [];
    seenPhones.add(phone);
    const lastUserMessageAt = new Date(row.last_user_message_at);
    if (!Number.isFinite(lastUserMessageAt.getTime())) return [];
    return [{
      conversationId: row.conversation_id,
      customerName: row.customer_name,
      phoneMasked: maskPhone(phone),
      lastUserMessageAt: lastUserMessageAt.toISOString(),
      deliveryType: getFollowupDeliveryType(lastUserMessageAt, now),
    }];
  });
}

export async function getUnclassifiedLeadFollowupTemplates(): Promise<UnclassifiedLeadFollowupTemplate[]> {
  const { templates, fallbackUsed } = await listBatchTemplatesFromMetaOrFallback({ forceRefresh: true });
  return getUnclassifiedFollowupTemplatesFromCatalog(templates, fallbackUsed);
}

export async function previewUnclassifiedLeadFollowup(templateKey: string): Promise<{
  previewFingerprint: string;
  total: number;
  serviceTextCount: number;
  marketingTemplateCount: number;
  followUpMessageConfigured: boolean;
  requiresMarketingTemplate: boolean;
  serviceTextPreview: string | null;
  marketingTemplateBody: string;
  leads: UnclassifiedLeadFollowupPreviewRow[];
}> {
  const [template, rows, settings, enterprises] = await Promise.all([
    getApprovedMarketingTemplate(templateKey),
    listEligibleCandidates(),
    getUnclassifiedLeadSettings(),
    listEnterprises(true),
  ]);
  const leads = toPreviewRows(rows);
  const cities = getTriageCities(enterprises);
  const serviceTextCount = leads.filter((row) => row.deliveryType === 'SERVICE_TEXT').length;
  const marketingTemplateCount = leads.length - serviceTextCount;

  return {
    previewFingerprint: makePreviewFingerprint(
      leads.map(({ conversationId, lastUserMessageAt, deliveryType }) => ({
        conversationId,
        lastUserMessageAt,
        deliveryType,
      })),
      templateKey,
      template.messageBodyTemplate?.trim() ?? '',
      settings.followUpMessage,
      cities
    ),
    total: leads.length,
    serviceTextCount,
    marketingTemplateCount,
    followUpMessageConfigured: Boolean(settings.followUpMessage),
    requiresMarketingTemplate: marketingTemplateCount > 0,
    serviceTextPreview:
      settings.followUpMessage && serviceTextCount > 0
        ? renderFollowupText(settings.followUpMessage, cities)
        : null,
    marketingTemplateBody: template.messageBodyTemplate?.trim() ?? '',
    leads,
  };
}

export async function sendUnclassifiedLeadFollowup(params: {
  requestId: string;
  templateKey: string;
  previewFingerprint: string;
  confirmed: true;
  consentConfirmed: true;
  createdBy: number | null;
}): Promise<{
  campaignId: number;
  status: 'SENDING' | 'COMPLETED' | 'PARTIAL_FAILED';
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  alreadyProcessed?: boolean;
}> {
  const duplicate = await query<{
    id: number;
    status: 'SENDING' | 'COMPLETED' | 'PARTIAL_FAILED';
    total_recipients: number;
    sent_recipients: number;
    failed_recipients: number;
    skipped_recipients: number;
  }>(
    `SELECT id, status, total_recipients, sent_recipients, failed_recipients, skipped_recipients
       FROM ana_unclassified_lead_followup_campaigns
      WHERE request_id = $1
      LIMIT 1`,
    [params.requestId]
  );
  if (duplicate.rows[0]) {
    const campaign = duplicate.rows[0];
    return {
      campaignId: campaign.id,
      status: campaign.status,
      total: campaign.total_recipients,
      sent: campaign.sent_recipients,
      failed: campaign.failed_recipients,
      skipped: campaign.skipped_recipients,
      alreadyProcessed: true,
    };
  }

  const template = await getApprovedMarketingTemplate(params.templateKey);
  const settings = await getUnclassifiedLeadSettings();
  const followUpMessage = settings.followUpMessage;
  if (!followUpMessage) {
    throw new Error('Salve a mensagem de Follow-Up antes de enviar.');
  }
  const candidateRows = await listEligibleCandidates();
  const previewRows = toPreviewRows(candidateRows);
  const cities = getTriageCities(await listEnterprises(true));
  const currentFingerprint = makePreviewFingerprint(
    previewRows.map(({ conversationId, lastUserMessageAt, deliveryType }) => ({
      conversationId,
      lastUserMessageAt,
      deliveryType,
    })),
    params.templateKey,
    template.messageBodyTemplate?.trim() ?? '',
    followUpMessage,
    cities
  );
  if (currentFingerprint !== params.previewFingerprint) {
    throw new Error('A lista ou a configuração mudou desde a prévia. Gere uma nova prévia antes de enviar.');
  }
  if (previewRows.length === 0) throw new Error('Não há leads elegíveis para este Follow-Up.');

  const client = await getPool().connect();
  let campaignId: number;
  try {
    await client.query('BEGIN');
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO ana_unclassified_lead_followup_campaigns (
         request_id, template_key, follow_up_message, preview_fingerprint,
         consent_confirmed, status, total_recipients, created_by
       ) VALUES ($1, $2, $3, $4, $5, 'SENDING', $6, $7)
       ON CONFLICT (request_id) DO NOTHING
       RETURNING id`,
      [
        params.requestId,
        params.templateKey,
        followUpMessage,
        currentFingerprint,
        params.consentConfirmed,
        previewRows.length,
        params.createdBy,
      ]
    );
    if (!inserted.rows[0]) {
      await client.query('ROLLBACK');
      const existing = await query<{
        id: number;
        status: 'SENDING' | 'COMPLETED' | 'PARTIAL_FAILED';
        total_recipients: number;
        sent_recipients: number;
        failed_recipients: number;
        skipped_recipients: number;
      }>(
        `SELECT id, status, total_recipients, sent_recipients, failed_recipients, skipped_recipients
           FROM ana_unclassified_lead_followup_campaigns
          WHERE request_id = $1
          LIMIT 1`,
        [params.requestId]
      );
      const campaign = existing.rows[0];
      if (!campaign) throw new Error('Não foi possível confirmar o estado da campanha.');
      return {
        campaignId: campaign.id,
        status: campaign.status,
        total: campaign.total_recipients,
        sent: campaign.sent_recipients,
        failed: campaign.failed_recipients,
        skipped: campaign.skipped_recipients,
        alreadyProcessed: true,
      };
    }
    campaignId = inserted.rows[0].id;
    for (const lead of previewRows) {
      await client.query(
        `INSERT INTO ana_unclassified_lead_followup_recipients (
           campaign_id, conversation_id, last_user_message_at, planned_channel
         ) VALUES ($1, $2, $3, $4)`,
        [campaignId, lead.conversationId, lead.lastUserMessageAt, lead.deliveryType]
      );
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const recipientRows = await query<{ id: number; conversation_id: number; last_user_message_at: Date | string }>(
    `SELECT id, conversation_id, last_user_message_at
       FROM ana_unclassified_lead_followup_recipients
      WHERE campaign_id = $1 AND status = 'PENDING'
      ORDER BY id`,
    [campaignId]
  );

  const renderedFollowUpMessage = renderFollowupText(followUpMessage, cities);
  async function processRecipient(recipient: (typeof recipientRows.rows)[number]): Promise<'SENT' | 'FAILED' | 'SKIPPED'> {
    const currentRows = await query<FollowupCandidateRow>(
      `SELECT c.id AS conversation_id,
              c.customer_name,
              c.contact_phone,
              c.external_contact_id,
              inbound.last_user_message_at
         FROM conversations c
         LEFT JOIN contacts ct ON ct.id = c.contact_id
         JOIN LATERAL (
           SELECT MAX(m.created_at) AS last_user_message_at
             FROM messages m
            WHERE m.conversation_id = c.id
              AND m.role = 'user'
              AND m.deleted_at IS NULL
         ) inbound ON inbound.last_user_message_at IS NOT NULL
        WHERE c.id = $1
          AND lower(trim(COALESCE(c.channel, ''))) = 'whatsapp'
          AND upper(trim(COALESCE(c.conversation_type, 'CLIENT'))) = 'CLIENT'
          AND c.enterprise_id IS NULL
          AND c.enterprise_origin_id IS NULL
          AND ct.enterprise_id IS NULL
          AND COALESCE(c.handoff, false) = false
          AND lower(trim(COALESCE(c.classification, ''))) NOT IN ('handoff', 'carteira')
          AND c.manual_closed_at IS NULL`,
      [recipient.conversation_id]
    );
    const current = currentRows.rows[0];
    const snapshotAt = new Date(recipient.last_user_message_at).getTime();
    const currentAt = current ? new Date(current.last_user_message_at).getTime() : Number.NaN;
    const phone = current ? normalizePhoneE164(current.contact_phone ?? current.external_contact_id) : null;
    if (!current || !phone || currentAt !== snapshotAt) {
      await query(
        `UPDATE ana_unclassified_lead_followup_recipients
            SET status = 'SKIPPED',
                error_message = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [recipient.id, !current || !phone ? 'Lead não é mais elegível.' : 'O lead enviou nova mensagem após a prévia.']
      );
      return 'SKIPPED';
    }

    const claimed = await query(
      `UPDATE ana_unclassified_lead_followup_recipients
          SET status = 'PROCESSING', updated_at = NOW()
        WHERE id = $1 AND status = 'PENDING'
        RETURNING id`,
      [recipient.id]
    );
    if (!claimed.rows[0]) return 'SKIPPED';

    const currentWindowOpen = getFollowupDeliveryType(current.last_user_message_at) === 'SERVICE_TEXT';
    const result = currentWindowOpen
      ? await sendAnaTextMessageWithQuota({
          conversationId: current.conversation_id,
          to: phone,
          text: renderedFollowUpMessage,
          phase: 'ana_unclassified_lead_followup',
        })
      : await sendTemplateMessage(phone, template.key, { parameters: [] });

    if (!result.success || !result.metaMessageId) {
      await query(
        `UPDATE ana_unclassified_lead_followup_recipients
            SET status = 'FAILED',
                error_message = $2,
                updated_at = NOW()
          WHERE id = $1`,
        [recipient.id, result.error ?? 'Falha no envio.']
      );
      return 'FAILED';
    }

    await query(
      `UPDATE ana_unclassified_lead_followup_recipients
          SET status = 'SENT',
              meta_message_id = $2,
              sent_at = NOW(),
              updated_at = NOW()
        WHERE id = $1`,
      [recipient.id, result.metaMessageId]
    );

    try {
      const inboxText = currentWindowOpen
        ? renderedFollowUpMessage
        : renderTemplateTextForInbox(template, []);
      await insertMessage(current.conversation_id, 'assistant', inboxText, result.metaMessageId);
      await publishConversationUpdated(current.conversation_id);
    } catch (error) {
      console.error('[ANA_UNCLASSIFIED_FOLLOWUP_INBOX_PERSIST_FAILED]', {
        campaignId,
        conversationId: current.conversation_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return 'SENT';
  }

  for (const recipient of recipientRows.rows) {
    try {
      const result = await processRecipient(recipient);
      if (result === 'SENT') sent++;
      else if (result === 'FAILED') failed++;
      else skipped++;
    } catch (error) {
      await query(
        `UPDATE ana_unclassified_lead_followup_recipients
            SET status = 'FAILED',
                error_message = 'Falha interna ao processar o destinatário.',
                updated_at = NOW()
          WHERE id = $1 AND status NOT IN ('SENT', 'SKIPPED', 'FAILED')`,
        [recipient.id]
      );
      failed++;
      console.error('[ANA_UNCLASSIFIED_FOLLOWUP_RECIPIENT_FAILED]', {
        campaignId,
        conversationId: recipient.conversation_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const status = failed > 0 || skipped > 0 ? 'PARTIAL_FAILED' : 'COMPLETED';
  await query(
    `UPDATE ana_unclassified_lead_followup_campaigns
        SET status = $2,
            sent_recipients = $3,
            failed_recipients = $4,
            skipped_recipients = $5,
            finished_at = NOW()
      WHERE id = $1`,
    [campaignId, status, sent, failed, skipped]
  );

  return { campaignId, status, total: previewRows.length, sent, failed, skipped };
}
