ALTER TABLE llm_usage_events
  ADD COLUMN IF NOT EXISTS api_key_source TEXT,
  ADD COLUMN IF NOT EXISTS openai_api_key_id TEXT,
  ADD COLUMN IF NOT EXISTS openai_project_id TEXT,
  ADD COLUMN IF NOT EXISTS request_type TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_llm_usage_events_api_key_source') THEN
    ALTER TABLE llm_usage_events
      ADD CONSTRAINT chk_llm_usage_events_api_key_source
      CHECK (
        api_key_source IS NULL
        OR api_key_source IN ('enterprise', 'global_fallback')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_openai_api_key_id
  ON llm_usage_events (openai_api_key_id);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_openai_project_id
  ON llm_usage_events (openai_project_id);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_api_key_source
  ON llm_usage_events (api_key_source);

CREATE TABLE IF NOT EXISTS openai_cost_snapshots (
  id BIGSERIAL PRIMARY KEY,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  openai_api_key_id TEXT NULL,
  openai_project_id TEXT NULL,
  enterprise_id INT NULL REFERENCES enterprises(id) ON DELETE SET NULL,
  amount_usd NUMERIC(12,6) NOT NULL,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  synced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_openai_cost_snapshots_period CHECK (period_end > period_start),
  CONSTRAINT chk_openai_cost_snapshots_amount CHECK (amount_usd >= 0)
);

CREATE INDEX IF NOT EXISTS idx_openai_cost_snapshots_period
  ON openai_cost_snapshots (period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_openai_cost_snapshots_api_key_id
  ON openai_cost_snapshots (openai_api_key_id);

CREATE INDEX IF NOT EXISTS idx_openai_cost_snapshots_project_id
  ON openai_cost_snapshots (openai_project_id);

CREATE INDEX IF NOT EXISTS idx_openai_cost_snapshots_enterprise
  ON openai_cost_snapshots (enterprise_id);