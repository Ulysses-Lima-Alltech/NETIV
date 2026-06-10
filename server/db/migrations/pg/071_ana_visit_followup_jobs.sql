CREATE TABLE IF NOT EXISTS ana_visit_followup_jobs (
  id BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active',
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  next_run_at TIMESTAMPTZ NOT NULL,
  next_attempt_index INTEGER NOT NULL DEFAULT 1,
  last_attempt_index INTEGER NOT NULL DEFAULT 0,
  anchor_assistant_message_id BIGINT NULL REFERENCES messages(id) ON DELETE SET NULL,
  last_sent_message_id BIGINT NULL REFERENCES messages(id) ON DELETE SET NULL,
  cancel_reason TEXT NULL,
  completed_at TIMESTAMPTZ NULL,
  locked_at TIMESTAMPTZ NULL,
  locked_by TEXT NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ana_visit_followup_jobs_status'
  ) THEN
    ALTER TABLE ana_visit_followup_jobs
      ADD CONSTRAINT chk_ana_visit_followup_jobs_status
      CHECK (status IN ('active', 'processing', 'completed', 'cancelled', 'failed'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ana_visit_followup_jobs_attempts'
  ) THEN
    ALTER TABLE ana_visit_followup_jobs
      ADD CONSTRAINT chk_ana_visit_followup_jobs_attempts
      CHECK (
        next_attempt_index BETWEEN 1 AND 11
        AND last_attempt_index BETWEEN 0 AND 10
        AND next_attempt_index >= last_attempt_index + 1
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ana_visit_followup_jobs_status_next_run
  ON ana_visit_followup_jobs (status, next_run_at);

CREATE INDEX IF NOT EXISTS idx_ana_visit_followup_jobs_conversation_id
  ON ana_visit_followup_jobs (conversation_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ana_visit_followup_jobs_active_conversation
  ON ana_visit_followup_jobs (conversation_id)
  WHERE status IN ('active', 'processing');

CREATE TABLE IF NOT EXISTS ana_visit_followup_attempts (
  id BIGSERIAL PRIMARY KEY,
  job_id BIGINT NOT NULL REFERENCES ana_visit_followup_jobs(id) ON DELETE CASCADE,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  attempt_index INTEGER NOT NULL CHECK (attempt_index BETWEEN 1 AND 10),
  message_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'claimed',
  meta_message_id TEXT NULL,
  assistant_message_id BIGINT NULL REFERENCES messages(id) ON DELETE SET NULL,
  error TEXT NULL,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, attempt_index)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_ana_visit_followup_attempts_status'
  ) THEN
    ALTER TABLE ana_visit_followup_attempts
      ADD CONSTRAINT chk_ana_visit_followup_attempts_status
      CHECK (status IN ('claimed', 'sent', 'failed', 'skipped'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ana_visit_followup_attempts_conversation_id
  ON ana_visit_followup_attempts (conversation_id);

