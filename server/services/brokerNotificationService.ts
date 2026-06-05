import { query } from '../db/pg.js';

type SendBrokerPendingAttendanceParams = {
  brokerPhone: string;
  brokerName: string;
  clientName: string;
  enterpriseName: string;
};

type NotifyAndPersistBrokerPendingAttendanceParams = SendBrokerPendingAttendanceParams & {
  conversationId: number;
  brokerId: number;
};

type MetaTemplateParameter = {
  type: 'text';
  text: string;
};

type MetaTemplatePayload = {
  messaging_product: 'whatsapp';
  to: string;
  type: 'template';
  template: {
    name: string;
    language: {
      code: string;
    };
    components: Array<{
      type: 'body';
      parameters: MetaTemplateParameter[];
    }>;
  };
};

const BROKER_ATTENDANCE_TEMPLATE_NAME = 'corretor_atendimento_pendente';

function normalizeMetaApiVersion(value: string | undefined): string {
  const version = String(value || 'v21.0').trim();

  if (/^v\d+\.\d+$/.test(version)) return version;
  if (/^\d+\.\d+$/.test(version)) return `v${version}`;

  return version || 'v21.0';
}

function sanitizeTemplateText(value: unknown, fallback = '-'): string {
  const text = String(value ?? '').trim();

  if (!text) return fallback;

  return text.length > 180 ? `${text.slice(0, 177)}...` : text;
}

function normalizeBrazilPhone(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

function errorToString(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 900 ? `${message.slice(0, 897)}...` : message;
}

async function persistBrokerNotificationStatus(params: {
  conversationId: number;
  brokerId: number;
  status: string;
  error?: string | null;
}) {
  await query(
    `UPDATE conversations
     SET broker_notified_at = CASE WHEN $3 = 'sent' THEN NOW() ELSE broker_notified_at END,
         broker_notification_status = $3,
         broker_notification_error = $4,
         broker_notification_template = $5,
         updated_at = NOW()
     WHERE id = $1
       AND assigned_broker_id = $2`,
    [
      params.conversationId,
      params.brokerId,
      params.status,
      params.error ?? null,
      BROKER_ATTENDANCE_TEMPLATE_NAME,
    ]
  );
}

export async function sendBrokerPendingAttendanceTemplate({
  brokerPhone,
  brokerName,
  clientName,
  enterpriseName,
}: SendBrokerPendingAttendanceParams) {
  const token = process.env.META_WHATSAPP_TOKEN;
  const phoneNumberId = process.env.META_PHONE_NUMBER_ID;
  const apiVersion = normalizeMetaApiVersion(process.env.META_API_VERSION);

  const to = normalizeBrazilPhone(brokerPhone);

  if (!token) {
    throw new Error('META_WHATSAPP_TOKEN não configurado');
  }

  if (!phoneNumberId) {
    throw new Error('META_PHONE_NUMBER_ID não configurado');
  }

  if (!to) {
    throw new Error('Telefone do corretor não informado');
  }

  const payload: MetaTemplatePayload = {
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: BROKER_ATTENDANCE_TEMPLATE_NAME,
      language: {
        code: 'pt_BR',
      },
      components: [
        {
          type: 'body',
          parameters: [
            {
              type: 'text',
              text: sanitizeTemplateText(brokerName, 'Corretor'),
            },
            {
              type: 'text',
              text: sanitizeTemplateText(clientName, 'Cliente'),
            },
            {
              type: 'text',
              text: sanitizeTemplateText(enterpriseName, 'Empreendimento'),
            },
          ],
        },
      ],
    },
  };

  if (process.env.ANA_DEV_DISABLE_WHATSAPP_SEND === 'true') {
    console.log('[broker-notification] envio WhatsApp desabilitado por ANA_DEV_DISABLE_WHATSAPP_SEND=true');
    console.log('[broker-notification] payload:', JSON.stringify(payload, null, 2));

    return {
      skipped: true,
      reason: 'ANA_DEV_DISABLE_WHATSAPP_SEND=true',
      payload,
    };
  }

  const url = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(
      `[broker-notification] erro ao enviar ${BROKER_ATTENDANCE_TEMPLATE_NAME}: ${JSON.stringify(data)}`
    );
  }

  console.log('[broker-notification] template corretor_atendimento_pendente enviado', {
    to,
    template: BROKER_ATTENDANCE_TEMPLATE_NAME,
    metaResponse: data,
  });

  return data;
}

export async function notifyAndPersistBrokerPendingAttendance({
  conversationId,
  brokerId,
  brokerPhone,
  brokerName,
  clientName,
  enterpriseName,
}: NotifyAndPersistBrokerPendingAttendanceParams) {
  const normalizedPhone = normalizeBrazilPhone(brokerPhone);

  if (!normalizedPhone) {
    await persistBrokerNotificationStatus({
      conversationId,
      brokerId,
      status: 'skipped_no_phone',
      error: 'Corretor sem telefone cadastrado',
    });

    console.warn('[broker-notification] skipped_no_phone', {
      conversationId,
      brokerId,
    });

    return {
      skipped: true,
      reason: 'skipped_no_phone',
    };
  }

  const claim = await query<{ id: number }>(
    `UPDATE conversations
     SET broker_notification_status = 'sending',
         broker_notification_error = NULL,
         broker_notification_template = $3,
         updated_at = NOW()
     WHERE id = $1
       AND assigned_broker_id = $2
       AND COALESCE(broker_notification_status, 'pending') <> 'sent'
     RETURNING id`,
    [conversationId, brokerId, BROKER_ATTENDANCE_TEMPLATE_NAME]
  );

  if (claim.rows.length === 0) {
    console.log('[broker-notification] skipped_already_sent_or_broker_changed', {
      conversationId,
      brokerId,
    });

    return {
      skipped: true,
      reason: 'already_sent_or_broker_changed',
    };
  }

  try {
    const result = await sendBrokerPendingAttendanceTemplate({
      brokerPhone: normalizedPhone,
      brokerName,
      clientName,
      enterpriseName,
    });

    const skipped = Boolean((result as { skipped?: boolean } | null)?.skipped);

    await persistBrokerNotificationStatus({
      conversationId,
      brokerId,
      status: skipped ? 'skipped_disabled' : 'sent',
      error: skipped ? 'ANA_DEV_DISABLE_WHATSAPP_SEND=true' : null,
    });

    return result;
  } catch (error) {
    const message = errorToString(error);

    await persistBrokerNotificationStatus({
      conversationId,
      brokerId,
      status: 'failed',
      error: message,
    });

    console.error('[broker-notification] failed', {
      conversationId,
      brokerId,
      error: message,
    });

    return {
      skipped: false,
      error: message,
    };
  }
}