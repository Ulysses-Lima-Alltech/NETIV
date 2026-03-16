-- Integration settings: one row per integration type (e.g. whatsapp).
CREATE TABLE IF NOT EXISTS integration_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  integration_type TEXT NOT NULL DEFAULT 'whatsapp',
  meta_access_token TEXT NOT NULL DEFAULT '',
  whatsapp_phone_number_id TEXT NOT NULL DEFAULT '',
  whatsapp_business_account_id TEXT NOT NULL DEFAULT '',
  api_version TEXT NOT NULL DEFAULT 'v21.0',
  webhook_verify_token TEXT NOT NULL DEFAULT '',
  default_send_phone_number TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(integration_type)
);

INSERT OR IGNORE INTO integration_settings (
  id, integration_type, meta_access_token, whatsapp_phone_number_id,
  whatsapp_business_account_id, api_version, webhook_verify_token,
  default_send_phone_number, enabled, updated_at
) VALUES (
  1, 'whatsapp', '', '', '', 'v21.0', '', NULL, 0, datetime('now')
);
