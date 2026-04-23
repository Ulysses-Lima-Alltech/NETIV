-- Pointer to current canonical version for each enterprise file.
-- FK is added only after backfill in migration 039.

ALTER TABLE enterprise_files
  ADD COLUMN IF NOT EXISTS current_version_id INT;

CREATE INDEX IF NOT EXISTS idx_enterprise_files_current_version_id
  ON enterprise_files (current_version_id)
  WHERE current_version_id IS NOT NULL;
