CREATE TABLE IF NOT EXISTS openai_cost_settings (
  id BIGSERIAL PRIMARY KEY,
  provider TEXT NOT NULL DEFAULT 'openai',
  openai_costs_api_key TEXT NULL,
  openai_costs_api_key_id TEXT NULL,
  openai_project_id TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  last_sync_at TIMESTAMPTZ NULL,
  last_sync_status TEXT NULL,
  last_sync_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_openai_cost_settings_provider
  ON openai_cost_settings (provider);

INSERT INTO openai_cost_settings (
  provider,
  enabled,
  created_at,
  updated_at
)
VALUES (
  'openai',
  true,
  NOW(),
  NOW()
)
ON CONFLICT (provider) DO NOTHING;
