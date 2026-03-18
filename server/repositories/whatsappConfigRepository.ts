import type {
  WhatsAppIntegrationConfig,
  WhatsAppIntegrationConfigPublic,
  WhatsAppIntegrationConfigUpdate,
} from '../types/settings.js';
import { query } from '../db/pg.js';

type Row = {
  meta_access_token: string;
  whatsapp_phone_number_id: string;
  whatsapp_business_account_id: string;
  api_version: string;
  webhook_verify_token: string;
  default_send_phone_number: string | null;
  default_country_code: string | null;
  whatsapp_enabled: boolean;
  created_at: Date | null;
  updated_at: Date;
};

function rowToConfig(row: Row): WhatsAppIntegrationConfig {
  return {
    metaAccessToken: row.meta_access_token ?? '',
    whatsappPhoneNumberId: row.whatsapp_phone_number_id ?? '',
    whatsappBusinessAccountId: row.whatsapp_business_account_id ?? '',
    apiVersion: row.api_version ?? 'v21.0',
    webhookVerifyToken: row.webhook_verify_token ?? '',
    defaultSendPhoneNumber: row.default_send_phone_number,
    defaultCountryCode: row.default_country_code,
    enabled: !!row.whatsapp_enabled,
    createdAt: row.created_at?.toISOString?.() ?? row.updated_at?.toISOString?.() ?? '',
    updatedAt: row.updated_at?.toISOString?.() ?? '',
  };
}

export async function getWhatsAppConfig(): Promise<WhatsAppIntegrationConfig | null> {
  const { rows } = await query<Row>(
    `SELECT meta_access_token, whatsapp_phone_number_id, whatsapp_business_account_id,
      api_version, webhook_verify_token, default_send_phone_number, default_country_code,
      whatsapp_enabled, created_at, updated_at
     FROM integration_settings WHERE id = 1`
  );
  if (!rows[0]) return null;
  return rowToConfig(rows[0]);
}

export async function updateWhatsAppConfig(update: WhatsAppIntegrationConfigUpdate): Promise<WhatsAppIntegrationConfig> {
  const current = await getWhatsAppConfig();
  const metaAccessToken = update.metaAccessToken ?? current?.metaAccessToken ?? '';
  const whatsappPhoneNumberId = update.whatsappPhoneNumberId ?? current?.whatsappPhoneNumberId ?? '';
  const whatsappBusinessAccountId = update.whatsappBusinessAccountId ?? current?.whatsappBusinessAccountId ?? '';
  const apiVersion = update.apiVersion ?? current?.apiVersion ?? 'v21.0';
  const webhookVerifyToken = update.webhookVerifyToken ?? current?.webhookVerifyToken ?? '';
  const defaultSendPhoneNumber =
    update.defaultSendPhoneNumber !== undefined ? update.defaultSendPhoneNumber : current?.defaultSendPhoneNumber ?? null;
  const defaultCountryCode =
    update.defaultCountryCode !== undefined ? update.defaultCountryCode : current?.defaultCountryCode ?? null;
  const enabled = update.enabled !== undefined ? update.enabled : (current?.enabled ?? false);

  await query(
    `UPDATE integration_settings SET
      meta_access_token = $1, whatsapp_phone_number_id = $2, whatsapp_business_account_id = $3,
      api_version = $4, webhook_verify_token = $5, default_send_phone_number = $6, default_country_code = $7,
      whatsapp_enabled = $8, updated_at = NOW()
     WHERE id = 1`,
    [
      metaAccessToken,
      whatsappPhoneNumberId,
      whatsappBusinessAccountId,
      apiVersion,
      webhookVerifyToken,
      defaultSendPhoneNumber,
      defaultCountryCode,
      enabled,
    ]
  );
  return (await getWhatsAppConfig())!;
}

export async function getWhatsAppConfigPublic(): Promise<WhatsAppIntegrationConfigPublic | null> {
  const c = await getWhatsAppConfig();
  if (!c) return null;
  return {
    metaAccessTokenMasked: c.metaAccessToken.length > 0,
    whatsappPhoneNumberId: c.whatsappPhoneNumberId,
    whatsappBusinessAccountId: c.whatsappBusinessAccountId,
    apiVersion: c.apiVersion,
    webhookVerifyTokenMasked: c.webhookVerifyToken.length > 0,
    defaultSendPhoneNumber: c.defaultSendPhoneNumber,
    defaultCountryCode: c.defaultCountryCode,
    enabled: c.enabled,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

export function validateConfigForEnabled(config: WhatsAppIntegrationConfig): string | null {
  if (!config.enabled) return null;
  if (!config.metaAccessToken?.trim()) return 'Token da Meta é obrigatório quando a integração está ativa.';
  if (!config.whatsappPhoneNumberId?.trim()) return 'Phone Number ID é obrigatório quando a integração está ativa.';
  if (!config.apiVersion?.trim()) return 'Versão da API é obrigatória quando a integração está ativa.';
  if (!config.webhookVerifyToken?.trim()) return 'Webhook Verify Token é obrigatório quando a integração está ativa.';
  return null;
}
