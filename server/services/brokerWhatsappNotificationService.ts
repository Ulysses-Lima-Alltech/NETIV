import { query } from '../db/pg.js';
import { normalizePhoneE164 } from '../utils/phone.js';
import { sendTemplateMessageByName } from './whatsappMetaService.js';

const DEFAULT_PENDING_ATTENDANCE_TEMPLATE_NAME = 'corretor_atendimento_pendente';
const DEFAULT_APPOINTMENT_CONFIRMED_TEMPLATE_NAME = 'corretor_agendamento_confirmado';
const DEFAULT_TEMPLATE_LANGUAGE = 'pt_BR';

type BrokerWhatsappStatus = 'sent' | 'skipped_disabled' | 'no_phone' | 'failed';
type BrokerAppointmentWhatsappStatus = BrokerWhatsappStatus | 'sending' | 'skipped_duplicate';

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

async function claimAppointmentBrokerNotificationSend(args: {
  appointmentId: number;
  templateName: string;
}): Promise<boolean> {
  const result = await query(
    `UPDATE appointments
     SET appointment_broker_notification_status = 'sending',
         appointment_broker_notification_error = NULL,
         appointment_broker_notification_template = $2,
         updated_at = NOW()
     WHERE id = $1
       AND COALESCE(appointment_broker_notification_status, 'pending') NOT IN ('sent', 'sending')
     RETURNING id`,
    [args.appointmentId, args.templateName]
  );
  return (result.rowCount ?? 0) > 0;
}

async function persistAppointmentBrokerWhatsappNotificationStatus(args: {
  appointmentId: number;
  status: BrokerAppointmentWhatsappStatus;
  templateName: string;
  error: string | null;
}): Promise<void> {
  await query(
    `UPDATE appointments
     SET appointment_broker_notified_at = CASE
           WHEN $2 = 'sent' THEN NOW()
           ELSE appointment_broker_notified_at
         END,
         appointment_broker_notification_status = $2,
         appointment_broker_notification_error = $3,
         appointment_broker_notification_template = $4,
         updated_at = NOW()
     WHERE id = $1
       AND COALESCE(appointment_broker_notification_status, 'pending') <> 'sent'`,
    [
      args.appointmentId,
      args.status,
      args.error ? args.error.slice(0, 500) : null,
      args.templateName,
    ]
  );
}

function cleanTemplateValue(value: unknown, fallback: string): string {
  const text = String(value ?? '').trim();
  return text || fallback;
}

export function buildBrokerPendingAttendanceTemplateParameters(args: {
  brokerName: string | null;
  customerNameOrPhone: string;
  enterpriseName: string;
}): string[] {
  return [
    cleanTemplateValue(args.brokerName, 'Corretor'),
    cleanTemplateValue(args.customerNameOrPhone, 'Cliente'),
    cleanTemplateValue(args.enterpriseName, 'empreendimento'),
  ];
}

export function buildBrokerAppointmentConfirmedTemplateParameters(args: {
  brokerName: string | null;
  customerNameOrPhone: string;
  enterpriseName: string;
  appointmentDateTimeText: string;
}): string[] {
  return [
    cleanTemplateValue(args.brokerName, 'Corretor'),
    cleanTemplateValue(args.customerNameOrPhone, 'Cliente'),
    cleanTemplateValue(args.enterpriseName, 'empreendimento'),
    cleanTemplateValue(args.appointmentDateTimeText, 'data/hora da visita'),
  ];
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
    process.env.BROKER_PENDING_ATTENDANCE_TEMPLATE_NAME ?? DEFAULT_PENDING_ATTENDANCE_TEMPLATE_NAME
  ).trim() || DEFAULT_PENDING_ATTENDANCE_TEMPLATE_NAME;
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

  const parameters = buildBrokerPendingAttendanceTemplateParameters({
    brokerName: args.brokerName,
    customerNameOrPhone: args.customerNameOrPhone,
    enterpriseName: args.enterpriseName,
  });

  try {
    const result = await sendTemplateMessageByName(
      brokerPhone,
      templateName,
      templateLanguage,
      parameters
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

export async function sendBrokerAppointmentConfirmedTemplate(args: {
  brokerPhone: string | null;
  brokerName: string | null;
  customerNameOrPhone: string;
  enterpriseName: string;
  appointmentDateTimeText: string;
  conversationId: number;
  appointmentId: number;
}): Promise<{
  success: boolean;
  status: BrokerAppointmentWhatsappStatus;
  error: string | null;
  metaMessageId: string | null;
}> {
  const templateName = String(
    process.env.BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_NAME ?? DEFAULT_APPOINTMENT_CONFIRMED_TEMPLATE_NAME
  ).trim() || DEFAULT_APPOINTMENT_CONFIRMED_TEMPLATE_NAME;
  const templateLanguage = String(
    process.env.BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_LANGUAGE ?? DEFAULT_TEMPLATE_LANGUAGE
  ).trim() || DEFAULT_TEMPLATE_LANGUAGE;
  const enabled = readEnvFlag('BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_ENABLED', false);

  console.log('[BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_SEND_STARTED]', {
    conversationId: args.conversationId,
    appointmentId: args.appointmentId,
    templateName,
    templateLanguage,
    enabled,
  });

  if (!enabled) {
    console.log('[BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_SKIPPED_DISABLED]', {
      conversationId: args.conversationId,
      appointmentId: args.appointmentId,
      templateName,
    });
    await persistAppointmentBrokerWhatsappNotificationStatus({
      appointmentId: args.appointmentId,
      status: 'skipped_disabled',
      templateName,
      error: null,
    });
    return { success: false, status: 'skipped_disabled', error: null, metaMessageId: null };
  }

  const brokerPhone = normalizePhoneE164(args.brokerPhone);
  if (!brokerPhone) {
    const err = 'Corretor sem telefone valido para template de agendamento.';
    console.warn('[BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_NO_PHONE]', {
      conversationId: args.conversationId,
      appointmentId: args.appointmentId,
      templateName,
    });
    await persistAppointmentBrokerWhatsappNotificationStatus({
      appointmentId: args.appointmentId,
      status: 'no_phone',
      templateName,
      error: err,
    });
    return { success: false, status: 'no_phone', error: err, metaMessageId: null };
  }

  const claimed = await claimAppointmentBrokerNotificationSend({
    appointmentId: args.appointmentId,
    templateName,
  });
  if (!claimed) {
    console.log('[BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_SKIPPED_DUPLICATE]', {
      conversationId: args.conversationId,
      appointmentId: args.appointmentId,
      templateName,
    });
    return { success: false, status: 'skipped_duplicate', error: null, metaMessageId: null };
  }

  const parameters = buildBrokerAppointmentConfirmedTemplateParameters({
    brokerName: args.brokerName,
    customerNameOrPhone: args.customerNameOrPhone,
    enterpriseName: args.enterpriseName,
    appointmentDateTimeText: args.appointmentDateTimeText,
  });

  try {
    const result = await sendTemplateMessageByName(
      brokerPhone,
      templateName,
      templateLanguage,
      parameters
    );

    if (result.success && result.metaMessageId) {
      console.log('[BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_SENT]', {
        conversationId: args.conversationId,
        appointmentId: args.appointmentId,
        templateName,
        metaMessageId: result.metaMessageId,
      });
      await persistAppointmentBrokerWhatsappNotificationStatus({
        appointmentId: args.appointmentId,
        status: 'sent',
        templateName,
        error: null,
      });
      return { success: true, status: 'sent', error: null, metaMessageId: result.metaMessageId };
    }

    const err = result.error || 'Falha ao enviar template de agendamento para corretor.';
    console.error('[BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_FAILED]', {
      conversationId: args.conversationId,
      appointmentId: args.appointmentId,
      templateName,
      error: err,
      code: result.code ?? null,
      httpStatus: result.httpStatus ?? null,
      metaErrorCode: result.metaErrorCode ?? null,
      metaErrorType: result.metaErrorType ?? null,
      metaErrorSubcode: result.metaErrorSubcode ?? null,
      metaFbTraceId: result.metaFbTraceId ?? null,
    });
    await persistAppointmentBrokerWhatsappNotificationStatus({
      appointmentId: args.appointmentId,
      status: 'failed',
      templateName,
      error: err,
    });
    return { success: false, status: 'failed', error: err, metaMessageId: null };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    console.error('[BROKER_APPOINTMENT_CONFIRMED_TEMPLATE_FAILED]', {
      conversationId: args.conversationId,
      appointmentId: args.appointmentId,
      templateName,
      error: err,
    });
    await persistAppointmentBrokerWhatsappNotificationStatus({
      appointmentId: args.appointmentId,
      status: 'failed',
      templateName,
      error: err,
    });
    return { success: false, status: 'failed', error: err, metaMessageId: null };
  }
}
