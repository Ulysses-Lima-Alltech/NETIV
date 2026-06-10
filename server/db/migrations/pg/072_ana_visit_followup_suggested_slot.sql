ALTER TABLE ana_visit_followup_jobs
  ADD COLUMN IF NOT EXISTS suggested_visit_start_at TIMESTAMPTZ NULL;

ALTER TABLE ana_visit_followup_jobs
  ADD COLUMN IF NOT EXISTS suggested_visit_end_at TIMESTAMPTZ NULL;

ALTER TABLE ana_visit_followup_jobs
  ADD COLUMN IF NOT EXISTS suggested_broker_id INT NULL REFERENCES corretores(id) ON DELETE SET NULL;

ALTER TABLE ana_visit_followup_jobs
  ADD COLUMN IF NOT EXISTS suggested_slot_label TEXT NULL;

ALTER TABLE ana_visit_followup_jobs
  ADD COLUMN IF NOT EXISTS timezone TEXT NULL;

ALTER TABLE ana_visit_followup_jobs
  ADD COLUMN IF NOT EXISTS suggestion_status TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_ana_visit_followup_jobs_suggested_visit_start
  ON ana_visit_followup_jobs (suggested_visit_start_at)
  WHERE suggested_visit_start_at IS NOT NULL;
