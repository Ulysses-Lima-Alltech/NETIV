-- Garante colunas criadas pela 005 caso o runner anterior tenha falhado no meio.
ALTER TABLE integration_settings ADD COLUMN default_country_code TEXT;
ALTER TABLE integration_settings ADD COLUMN created_at TEXT NOT NULL DEFAULT '';
UPDATE integration_settings SET created_at = datetime('now') WHERE created_at = '';
