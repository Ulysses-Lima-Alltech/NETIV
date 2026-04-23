CREATE TABLE IF NOT EXISTS ana_turn_audit (
  id BIGSERIAL PRIMARY KEY,
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id INT NULL REFERENCES messages(id) ON DELETE SET NULL,
  enterprise_id INT NULL REFERENCES enterprises(id) ON DELETE SET NULL,
  user_message TEXT NOT NULL,
  resolved_intent TEXT,
  resolved_product_type TEXT,
  primary_axis VARCHAR(48),
  response_mode VARCHAR(16),
  evidence_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  decision_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  guards_applied_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  outbound_status VARCHAR(32) NOT NULL DEFAULT 'silent',
  blocked_reason TEXT,
  missing_information_flag_created BOOLEAN NOT NULL DEFAULT false,
  missing_information_subject TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ana_turn_audit_response_mode'
  ) THEN
    ALTER TABLE ana_turn_audit
      ADD CONSTRAINT chk_ana_turn_audit_response_mode
      CHECK (response_mode IS NULL OR response_mode IN ('short', 'structured'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ana_turn_audit_outbound_status'
  ) THEN
    ALTER TABLE ana_turn_audit
      ADD CONSTRAINT chk_ana_turn_audit_outbound_status
      CHECK (outbound_status IN ('sent', 'blocked', 'silent', 'material_sent', 'material_failed', 'send_failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ana_turn_audit_conversation_created_at
  ON ana_turn_audit(conversation_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ana_turn_audit_message_id
  ON ana_turn_audit(message_id);

CREATE INDEX IF NOT EXISTS idx_ana_turn_audit_missing_information
  ON ana_turn_audit(missing_information_flag_created, created_at DESC);
