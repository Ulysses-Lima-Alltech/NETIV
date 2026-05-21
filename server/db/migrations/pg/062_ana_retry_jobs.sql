CREATE TABLE IF NOT EXISTS ana_retry_jobs (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  trigger_message_id BIGINT NULL REFERENCES messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  last_error TEXT NULL,
  last_error_code TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ana_retry_jobs_status_next_run
  ON ana_retry_jobs (status, next_run_at);

CREATE INDEX IF NOT EXISTS idx_ana_retry_jobs_conversation_id
  ON ana_retry_jobs (conversation_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ana_retry_jobs_pending_trigger
  ON ana_retry_jobs (conversation_id, trigger_message_id)
  WHERE trigger_message_id IS NOT NULL AND status IN ('pending', 'processing');
