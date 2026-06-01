import { query } from '../db/pg.js';
import {
  deactivateMobileUserDeviceToken,
  listActiveMobileDeviceTokensByBrokerId,
} from '../repositories/mobileDeviceTokenRepository.js';

const EXPO_PUSH_ENDPOINT = 'https://exp.host/--/api/v2/push/send';

type BrokerPushStatus =
  | 'sent'
  | 'skipped_disabled'
  | 'no_device_token'
  | 'failed';

function readEnvFlag(name: string, defaultValue: boolean): boolean {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function buildPushBody(customerNameOrPhone: string, enterpriseName: string): string {
  const customer = String(customerNameOrPhone ?? '').trim() || 'cliente';
  const enterprise = String(enterpriseName ?? '').trim() || 'empreendimento';
  return `Cliente ${customer} aguarda atendimento sobre ${enterprise}.`;
}

function shouldDeactivateTokenFromExpoError(args: {
  detailsError: string | null;
  message: string | null;
}): boolean {
  const detailsError = String(args.detailsError ?? '').trim();
  if (detailsError === 'DeviceNotRegistered') return true;

  const message = String(args.message ?? '').toLowerCase();
  return (
    message.includes('not a valid expo push token') ||
    message.includes('not a registered push notification recipient')
  );
}

async function persistBrokerPushNotificationStatus(args: {
  conversationId: number;
  status: BrokerPushStatus;
  error: string | null;
}): Promise<void> {
  await query(
    `UPDATE conversations
     SET broker_push_notified_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE NULL END,
         broker_push_notification_status = $2,
         broker_push_notification_error = $3,
         updated_at = NOW()
     WHERE id = $1`,
    [args.conversationId, args.status, args.error ? args.error.slice(0, 500) : null]
  );
}

export async function sendBrokerPendingAttendancePush(args: {
  brokerId: number;
  conversationId: number;
  enterpriseId: number | null;
  customerNameOrPhone: string;
  enterpriseName: string;
}): Promise<{
  success: boolean;
  status: BrokerPushStatus;
  error: string | null;
  sentCount: number;
}> {
  const enabled = readEnvFlag('BROKER_PUSH_NOTIFICATION_ENABLED', true);

  console.log('[BROKER_PUSH_SEND_STARTED]', {
    conversationId: args.conversationId,
    brokerId: args.brokerId,
    enabled,
  });

  if (!enabled) {
    await persistBrokerPushNotificationStatus({
      conversationId: args.conversationId,
      status: 'skipped_disabled',
      error: null,
    });
    return { success: false, status: 'skipped_disabled', error: null, sentCount: 0 };
  }

  const tokens = await listActiveMobileDeviceTokensByBrokerId(args.brokerId);
  if (tokens.length === 0) {
    console.warn('[BROKER_PUSH_NO_DEVICE_TOKEN]', {
      conversationId: args.conversationId,
      brokerId: args.brokerId,
    });
    await persistBrokerPushNotificationStatus({
      conversationId: args.conversationId,
      status: 'no_device_token',
      error: null,
    });
    return { success: false, status: 'no_device_token', error: null, sentCount: 0 };
  }

  const payload = tokens.map((token) => ({
    to: token,
    sound: 'default',
    title: 'Novo atendimento pendente',
    body: buildPushBody(args.customerNameOrPhone, args.enterpriseName),
    data: {
      type: 'broker_handoff',
      conversationId: args.conversationId,
      enterpriseId: args.enterpriseId,
      customerNameOrPhone: args.customerNameOrPhone,
      route: `/conversas/${args.conversationId}`,
    },
  }));

  try {
    const response = await fetch(EXPO_PUSH_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const raw = (await response.json().catch(() => null)) as
      | { data?: Array<{ status?: string; id?: string; message?: string; details?: { error?: string } }> }
      | null;

    if (!response.ok) {
      const err = `Expo push HTTP ${response.status}`;
      console.error('[BROKER_PUSH_FAILED]', {
        conversationId: args.conversationId,
        brokerId: args.brokerId,
        error: err,
      });
      await persistBrokerPushNotificationStatus({
        conversationId: args.conversationId,
        status: 'failed',
        error: err,
      });
      return { success: false, status: 'failed', error: err, sentCount: 0 };
    }

    const responseItems = Array.isArray(raw?.data) ? raw?.data : [];
    for (let index = 0; index < responseItems.length; index += 1) {
      const item = responseItems[index];
      const token = tokens[index];
      if (!item || !token || item.status === 'ok') continue;

      const detailsError = item.details?.error ?? null;
      const message = item.message ?? null;
      if (!shouldDeactivateTokenFromExpoError({ detailsError, message })) continue;

      await deactivateMobileUserDeviceToken(token);
      console.warn('[BROKER_PUSH_TOKEN_DEACTIVATED]', {
        conversationId: args.conversationId,
        brokerId: args.brokerId,
        tokenSuffix: token.slice(-10),
        reason: detailsError || message || 'unknown',
      });
    }

    const sentCount = responseItems.filter((item) => item?.status === 'ok').length;
    const errors = responseItems
      .filter((item) => item?.status !== 'ok')
      .map((item) => item?.details?.error || item?.message || 'unknown_error')
      .filter((value) => value && value.trim().length > 0);

    if (sentCount > 0) {
      console.log('[BROKER_PUSH_SENT]', {
        conversationId: args.conversationId,
        brokerId: args.brokerId,
        sentCount,
        totalTokens: tokens.length,
      });
      await persistBrokerPushNotificationStatus({
        conversationId: args.conversationId,
        status: 'sent',
        error: errors.length > 0 ? `partial:${errors.join(';').slice(0, 400)}` : null,
      });
      return { success: true, status: 'sent', error: null, sentCount };
    }

    const err = errors.join('; ').slice(0, 500) || 'Nenhum push aceito pelo Expo.';
    console.error('[BROKER_PUSH_FAILED]', {
      conversationId: args.conversationId,
      brokerId: args.brokerId,
      error: err,
      totalTokens: tokens.length,
    });
    await persistBrokerPushNotificationStatus({
      conversationId: args.conversationId,
      status: 'failed',
      error: err,
    });
    return { success: false, status: 'failed', error: err, sentCount: 0 };
  } catch (error) {
    const err = error instanceof Error ? error.message : String(error);
    console.error('[BROKER_PUSH_FAILED]', {
      conversationId: args.conversationId,
      brokerId: args.brokerId,
      error: err,
    });
    await persistBrokerPushNotificationStatus({
      conversationId: args.conversationId,
      status: 'failed',
      error: err,
    });
    return { success: false, status: 'failed', error: err, sentCount: 0 };
  }
}
