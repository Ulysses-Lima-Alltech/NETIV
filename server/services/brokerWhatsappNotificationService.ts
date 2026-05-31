import { query } from '../db/pg.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import { sendTemplateMessageByName } from './whatsappMetaService.js';

const DEFAULT_TEMPLATE_NAME = 'corretor_atendimento_pendente';
const DEFAULT_TEMPLATE_LANGUAGE = 'pt_BR';

type BrokerWhatsappStatus = 'sent' | 'skipped_disabled' | 'no_phone' | 'failed';

function readEnvFlag(name: string, defaultValue: boolean): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

async function persistBrokerWhatsappNotificationStatus(args: {
  conversationId: number;
  status: BrokerWhatsappStatus;
  templateName: string;
  error: string | null;
}): Promise<void> {
  await query(
    `UPDATE conversations
     SET broker_notified_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE NULL END,
         broker_notification_status = $2,
         broker_notification_error = $3,
         broker_notification_template = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [
      args.conversationId,
      args.status,
      args.error ? args.error.slice(0, 500) : null,
      args.templateName,
    ]
  );
}

export async function sendBrokerPendingAttendanceTemplate(args: {
  brokerPhone: string | null;
  brokerName: string | null;
  customerNameOrPhone: string;
  enterpriseName: string;
  conversationId: number;
}): Promise<{
  success: boolean;
  status: BrokerWhatsappStatus;
  error: string | null;
  metaMessageId: string | null;
}> {
  const templateName = String(
    process.env.BROKER_PENDING_ATTENDANCE_TEMPLATE_NAME ?? DEFAULT_TEMPLATE_NAME
  ).trim() || DEFAULT_TEMPLATE_NAME;
  const templateLanguage = String(
    process.env.BROKER_PENDING_ATTENDANCE_TEMPLATE_LANGUAGE ?? DEFAULT_TEMPLATE_LANGUAGE
  ).trim() || DEFAULT_TEMPLATE_LANGUAGE;
  const enabled = readEnvFlag('BROKER_PENDING_ATTENDANCE_TEMPLATE_ENABLED', false);

  console.log('[BROKER_WHATSAPP_TEMPLATE_SEND_STARTED]', {
    conversationId: args.conversationId,
    templateName,
    templateLanguage,
    enabled,
  });

  if (!enabled) {
    console.log('[BROKER_WHATSAPP_TEMPLATE_SKIPPED_DISABLED]', {
      conversationId: args.conversationId,
      templateName,
    });
    await persistBrokerWhatsappNotificationStatus({
      conversationId: args.conversationId,
      status: 'skipped_disabled',
      templateName,
      error: null,
    });
    return { success: false, status: 'skipped_disabled', error: null, metaMessageId: null };
  }

  const brokerPhone = normalizePhoneE164(args.brokerPhone);
  if (!brokerPhone) {
    const err = 'Corretor sem telefone valido para template.';
    console.warn('[BROKER_WHATSAPP_TEMPLATE_NO_PHONE]', {
      conversationId: args.conversationId,
      templateName,
    });
    await persistBrokerWhatsappNotificationStatus({
      conversationId: args.conversationId,
      status: 'no_phone',
      templateName,
      error: err,
    });
    return { success: false, status: 'no_phone', error: err, metaMessageId: null };
  }

  const brokerName = String(args.brokerName ?? '').trim() || 'Corretor';
  const customerNameOrPhone = String(args.customerNameOrPhone ?? '').trim() || 'Cliente';
  const enterpriseName = String(args.enterpriseName ?? '').trim() || 'empreendimento';

  try {
    const result = await sendTemplateMessageByName(
      brokerPhone,
      templateName,
      templateLanguage,
      [brokerName, customerNameOrPhone, enterpriseName]
    );

    if (result.success && result.metaMessageId) {
      console.log('[BROKER_WHATSAPP_TEMPLATE_SENT]', {
        conversationId: args.conversationId,
        templateName,
        metaMessageId: result.metaMessageId,
      });
      await persistBrokerWhatsappNotificationStatus({
        conversationId: args.conversationId,
        status: 'sent',
        templateName,
        error: null,
      });
      return { success: true, status: 'sent', error: null, metaMessageId: result.metaMessageId };
    }

    const err = result.error || 'Falha ao enviar template para corretor.';
    console.error('[BROKER_WHATSAPP_TEMPLATE_FAILED]', {
      conversationId: args.conversationId,
      templateName,
      error: err,
      code: result.code ?? null,
      httpStatus: result.httpStatus ?? null,
    });
    await persistBrokerWhatsappNotificationStatus({
      conversationId: args.conversationId,
      status: 'failed',
      templateName,
      error: err,
    });
    return { success: false, status: 'failed', error: err, metaMessageId: null };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    console.error('[BROKER_WHATSAPP_TEMPLATE_FAILED]', {
      conversationId: args.conversationId,
      templateName,
      error: err,
    });
    await persistBrokerWhatsappNotificationStatus({
      conversationId: args.conversationId,
      status: 'failed',
      templateName,
      error: err,
    });
    return { success: false, status: 'failed', error: err, metaMessageId: null };
  }
}

