ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS ana_followup_anchor_assistant_message_id BIGINT NULL REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ana_followup_anchor_assistant_created_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS ana_followup_for_user_message_id BIGINT NULL REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ana_followup_attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ana_followup_last_attempt_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS ana_followup_last_sent_message_id BIGINT NULL REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ana_followup_next_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS ana_followup_status TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN IF NOT EXISTS ana_followup_cancel_reason TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversations_ana_followup_attempt_count'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT chk_conversations_ana_followup_attempt_count
      CHECK (ana_followup_attempt_count >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversations_ana_followup_status'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT chk_conversations_ana_followup_status
      CHECK (ana_followup_status IN ('idle', 'active', 'cancelled'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_ana_followup_due
  ON conversations (ana_followup_status, ana_followup_next_at)
  WHERE ana_followup_status IN ('idle', 'active');

COMMENT ON COLUMN conversations.ana_followup_anchor_assistant_message_id IS
  'Mensagem da Ana que ancora a cadência oficial de follow-up enquanto o cliente não responde.';
COMMENT ON COLUMN conversations.ana_followup_for_user_message_id IS
  'Última mensagem inbound do cliente que originou o ciclo de follow-up atual.';
COMMENT ON COLUMN conversations.ana_followup_next_at IS
  'Próxima tentativa da cadência oficial da Ana.';

ALTER TABLE ana_visit_followup_jobs
  DROP CONSTRAINT IF EXISTS chk_ana_visit_followup_jobs_attempts;

ALTER TABLE ana_visit_followup_jobs
  ADD CONSTRAINT chk_ana_visit_followup_jobs_attempts
  CHECK (
    next_attempt_index >= 1
    AND last_attempt_index >= 0
    AND next_attempt_index >= last_attempt_index + 1
  );

ALTER TABLE ana_visit_followup_attempts
  DROP CONSTRAINT IF EXISTS ana_visit_followup_attempts_attempt_index_check;

ALTER TABLE ana_visit_followup_attempts
  DROP CONSTRAINT IF EXISTS chk_ana_visit_followup_attempts_attempt_index;

ALTER TABLE ana_visit_followup_attempts
  ADD CONSTRAINT chk_ana_visit_followup_attempts_attempt_index
  CHECK (attempt_index >= 1);
