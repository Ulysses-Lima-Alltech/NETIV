-- Ajustes aprovados em ana_turn_audit:
-- - information_gap_ticket_id
-- - evidence_schema_version
-- - decision_schema_version

ALTER TABLE ana_turn_audit
  ADD COLUMN IF NOT EXISTS information_gap_ticket_id BIGINT,
  ADD COLUMN IF NOT EXISTS evidence_schema_version INT,
  ADD COLUMN IF NOT EXISTS decision_schema_version INT;

UPDATE ana_turn_audit
SET
  evidence_schema_version = COALESCE(evidence_schema_version, 1),
  decision_schema_version = COALESCE(decision_schema_version, 1)
WHERE evidence_schema_version IS NULL
   OR decision_schema_version IS NULL;

ALTER TABLE ana_turn_audit
  ALTER COLUMN evidence_schema_version SET DEFAULT 1,
  ALTER COLUMN evidence_schema_version SET NOT NULL,
  ALTER COLUMN decision_schema_version SET DEFAULT 1,
  ALTER COLUMN decision_schema_version SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ana_turn_audit_information_gap_ticket') THEN
    ALTER TABLE ana_turn_audit
      ADD CONSTRAINT fk_ana_turn_audit_information_gap_ticket
      FOREIGN KEY (information_gap_ticket_id) REFERENCES information_gap_tickets(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ana_turn_audit_evidence_schema_version') THEN
    ALTER TABLE ana_turn_audit
      ADD CONSTRAINT chk_ana_turn_audit_evidence_schema_version
      CHECK (evidence_schema_version >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ana_turn_audit_decision_schema_version') THEN
    ALTER TABLE ana_turn_audit
      ADD CONSTRAINT chk_ana_turn_audit_decision_schema_version
      CHECK (decision_schema_version >= 1);
  END IF;
END $$;

UPDATE ana_turn_audit a
SET information_gap_ticket_id = t.id,
    updated_at = NOW()
FROM information_gap_tickets t
WHERE a.information_gap_ticket_id IS NULL
  AND (a.id = t.first_turn_audit_id OR a.id = t.last_turn_audit_id);

CREATE INDEX IF NOT EXISTS idx_ana_turn_audit_information_gap_ticket_id
  ON ana_turn_audit (information_gap_ticket_id)
  WHERE information_gap_ticket_id IS NOT NULL;
