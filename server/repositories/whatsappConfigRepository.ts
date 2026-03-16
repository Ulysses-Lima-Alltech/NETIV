import type {
  WhatsAppIntegrationConfig,
  WhatsAppIntegrationConfigPublic,
  WhatsAppIntegrationConfigUpdate,
} from '../types/settings.js';
import { getDb } from '../db/index.js';

const INTEGRATION_TYPE = 'whatsapp';

type SettingsRow = {
  meta_access_token: string;
  whatsapp_phone_number_id: string;
  whatsapp_business_account_id: string;
  api_version: string;
  webhook_verify_token: string;
  default_send_phone_number: string | null;
  default_country_code: string | null;
  enabled: number;
  created_at: string;
  updated_at: string;
};

function rowToConfig(row: SettingsRow): WhatsAppIntegrationConfig {
  return {
    metaAccessToken: row.meta_access_token,
    whatsappPhoneNumberId: row.whatsapp_phone_number_id,
    whatsappBusinessAccountId: row.whatsapp_business_account_id,
    apiVersion: row.api_version,
    webhookVerifyToken: row.webhook_verify_token,
    defaultSendPhoneNumber: row.default_send_phone_number,
    defaultCountryCode: row.default_country_code ?? null,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT_COLS = `meta_access_token, whatsapp_phone_number_id, whatsapp_business_account_id,
  api_version, webhook_verify_token, default_send_phone_number, default_country_code, enabled, created_at, updated_at`;

export function getWhatsAppConfig(): WhatsAppIntegrationConfig | null {
  const database = getDb();
  const row = database
    .prepare(`SELECT ${SELECT_COLS} FROM integration_settings WHERE integration_type = ? LIMIT 1`)
    .get('whatsapp') as SettingsRow | undefined;
  if (!row) return null;
  return rowToConfig(row);
}

export function updateWhatsAppConfig(update: WhatsAppIntegrationConfigUpdate): WhatsAppIntegrationConfig {
  const database = getDb();
  const current = getWhatsAppConfig();
  const metaAccessToken = update.metaAccessToken ?? current?.metaAccessToken ?? '';
  const whatsappPhoneNumberId = update.whatsappPhoneNumberId ?? current?.whatsappPhoneNumberId ?? '';
  const whatsappBusinessAccountId = update.whatsappBusinessAccountId ?? current?.whatsappBusinessAccountId ?? '';
  const apiVersion = update.apiVersion ?? current?.apiVersion ?? 'v21.0';
  const webhookVerifyToken = update.webhookVerifyToken ?? current?.webhookVerifyToken ?? '';
  const defaultSendPhoneNumber = update.defaultSendPhoneNumber !== undefined ? update.defaultSendPhoneNumber : current?.defaultSendPhoneNumber ?? null;
  const defaultCountryCode = update.defaultCountryCode !== undefined ? update.defaultCountryCode : current?.defaultCountryCode ?? null;
  const enabled = update.enabled !== undefined ? (update.enabled ? 1 : 0) : (current?.enabled ? 1 : 0);

  database
    .prepare(
      `UPDATE integration_settings SET
        meta_access_token = ?, whatsapp_phone_number_id = ?, whatsapp_business_account_id = ?,
        api_version = ?, webhook_verify_token = ?, default_send_phone_number = ?, default_country_code = ?, enabled = ?,
        updated_at = datetime('now')
       WHERE integration_type = ?`
    )
    .run(metaAccessToken, whatsappPhoneNumberId, whatsappBusinessAccountId, apiVersion, webhookVerifyToken, defaultSendPhoneNumber, defaultCountryCode, enabled, 'whatsapp');

  const row = database.prepare(`SELECT ${SELECT_COLS} FROM integration_settings WHERE integration_type = ? LIMIT 1`).get('whatsapp') as SettingsRow;
  return rowToConfig(row);
}

export function getWhatsAppConfigPublic(): WhatsAppIntegrationConfigPublic | null {
  const c = getWhatsAppConfig();
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

/** Validate that when enabled=true, required fields are present (after merge). */
export function validateConfigForEnabled(config: WhatsAppIntegrationConfig): string | null {
  if (!config.enabled) return null;
  if (!config.metaAccessToken?.trim()) return 'Token da Meta é obrigatório quando a integração está ativa.';
  if (!config.whatsappPhoneNumberId?.trim()) return 'Phone Number ID é obrigatório quando a integração está ativa.';
  if (!config.apiVersion?.trim()) return 'Versão da API é obrigatória quando a integração está ativa.';
  if (!config.webhookVerifyToken?.trim()) return 'Webhook Verify Token é obrigatório quando a integração está ativa.';
  return null;
}
