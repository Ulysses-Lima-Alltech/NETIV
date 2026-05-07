ALTER TABLE ana_turn_audit
  ADD COLUMN IF NOT EXISTS enterprise_resolution_source VARCHAR(32),
  ADD COLUMN IF NOT EXISTS resolved_enterprise_id INT NULL,
  ADD COLUMN IF NOT EXISTS resolved_enterprise_name TEXT,
  ADD COLUMN IF NOT EXISTS enterprise_candidates JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rag_was_loaded BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reason_when_no_enterprise TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ana_turn_audit_resolved_enterprise') THEN
    ALTER TABLE ana_turn_audit
      ADD CONSTRAINT fk_ana_turn_audit_resolved_enterprise
      FOREIGN KEY (resolved_enterprise_id) REFERENCES enterprises(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ana_turn_audit_enterprise_resolution_source') THEN
    ALTER TABLE ana_turn_audit
      ADD CONSTRAINT chk_ana_turn_audit_enterprise_resolution_source
      CHECK (
        enterprise_resolution_source IS NULL
        OR enterprise_resolution_source IN (
          'message_alias',
          'conversation',
          'campaign',
          'contact',
          'unresolved',
          'ambiguous'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ana_turn_audit_enterprise_resolution_source
  ON ana_turn_audit (enterprise_resolution_source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ana_turn_audit_resolved_enterprise_id
  ON ana_turn_audit (resolved_enterprise_id, created_at DESC);
