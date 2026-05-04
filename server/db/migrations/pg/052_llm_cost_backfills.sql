CREATE TABLE IF NOT EXISTS llm_cost_backfills (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  label TEXT NOT NULL,
  start_at TIMESTAMPTZ NOT NULL,
  end_at TIMESTAMPTZ NOT NULL,
  total_cost_usd NUMERIC(12,6) NOT NULL,
  allocation_method TEXT NOT NULL DEFAULT 'effort_messages_audit',
  source TEXT NOT NULL DEFAULT 'manual_billing',
  notes TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  tracked_cost_handling TEXT NOT NULL DEFAULT 'additive',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT chk_llm_cost_backfills_period CHECK (end_at > start_at),
  CONSTRAINT chk_llm_cost_backfills_total_cost CHECK (total_cost_usd >= 0)
);

CREATE INDEX IF NOT EXISTS idx_llm_cost_backfills_period
  ON llm_cost_backfills (start_at, end_at);

CREATE INDEX IF NOT EXISTS idx_llm_cost_backfills_is_active
  ON llm_cost_backfills (is_active);
