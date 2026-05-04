CREATE TABLE IF NOT EXISTS llm_usage_events (
  id BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  purpose TEXT NOT NULL,
  model_reason TEXT NULL,
  conversation_id BIGINT NULL,
  contact_id BIGINT NULL,
  enterprise_id BIGINT NULL,
  inbound_message_id BIGINT NULL,
  outbound_message_id BIGINT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  cached_input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(12,6) NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT TRUE,
  error_code TEXT NULL,
  latency_ms INTEGER NULL,
  request_id TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_created_at
  ON llm_usage_events (created_at);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_conversation_id
  ON llm_usage_events (conversation_id);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_contact_id
  ON llm_usage_events (contact_id);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_enterprise_id
  ON llm_usage_events (enterprise_id);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_model
  ON llm_usage_events (model);

CREATE INDEX IF NOT EXISTS idx_llm_usage_events_purpose
  ON llm_usage_events (purpose);
