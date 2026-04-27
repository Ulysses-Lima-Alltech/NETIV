ALTER TABLE ana_turn_audit
  ADD COLUMN IF NOT EXISTS contact_id BIGINT,
  ADD COLUMN IF NOT EXISTS diagnostics_json JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ana_turn_audit_contact') THEN
    ALTER TABLE ana_turn_audit
      ADD CONSTRAINT fk_ana_turn_audit_contact
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ana_turn_audit_contact_created_at
  ON ana_turn_audit (contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ana_diagnostics (
  id BIGSERIAL PRIMARY KEY,
  diagnostic_type VARCHAR(64) NOT NULL,
  provider VARCHAR(32) NOT NULL,
  model VARCHAR(128),
  ok BOOLEAN NOT NULL DEFAULT false,
  status INT,
  classified_error VARCHAR(64),
  sanitized_message TEXT,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ana_diagnostics_created_at
  ON ana_diagnostics (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ana_diagnostics_type_created_at
  ON ana_diagnostics (diagnostic_type, created_at DESC);
