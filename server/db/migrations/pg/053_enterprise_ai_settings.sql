ALTER TABLE integration_settings
  ADD COLUMN IF NOT EXISTS openai_api_key_id TEXT,
  ADD COLUMN IF NOT EXISTS openai_project_id TEXT;

CREATE TABLE IF NOT EXISTS enterprise_ai_settings (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id INT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'openai',
  openai_api_key TEXT NULL,
  openai_api_key_id TEXT NULL,
  openai_project_id TEXT NULL,
  openai_base_url TEXT NULL,
  model_hot_lead TEXT NULL,
  model_cold_lead TEXT NULL,
  ai_enabled BOOLEAN NOT NULL DEFAULT true,
  emergency_block_enabled BOOLEAN NOT NULL DEFAULT false,
  emergency_block_message TEXT NULL,
  cost_tracking_enabled BOOLEAN NOT NULL DEFAULT true,
  use_global_defaults BOOLEAN NOT NULL DEFAULT true,
  last_connection_test_at TIMESTAMPTZ NULL,
  last_connection_test_status TEXT NULL,
  last_connection_test_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_enterprise_ai_settings_enterprise UNIQUE (enterprise_id)
);

CREATE INDEX IF NOT EXISTS idx_enterprise_ai_settings_provider
  ON enterprise_ai_settings (provider);

INSERT INTO enterprise_ai_settings (
  enterprise_id,
  provider,
  use_global_defaults,
  ai_enabled,
  emergency_block_enabled,
  cost_tracking_enabled,
  created_at,
  updated_at
)
SELECT
  e.id,
  'openai',
  true,
  true,
  false,
  true,
  NOW(),
  NOW()
FROM enterprises e
LEFT JOIN enterprise_ai_settings s
  ON s.enterprise_id = e.id
WHERE s.enterprise_id IS NULL;