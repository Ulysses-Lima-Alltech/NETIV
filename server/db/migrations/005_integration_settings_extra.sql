-- Integration settings: add provider, default_country_code, created_at.
ALTER TABLE integration_settings ADD COLUMN provider TEXT;
UPDATE integration_settings SET provider = COALESCE(integration_type, 'whatsapp_meta') WHERE provider IS NULL;
ALTER TABLE integration_settings ADD COLUMN default_country_code TEXT;
ALTER TABLE integration_settings ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
UPDATE integration_settings SET created_at = datetime('now') WHERE created_at = '';
