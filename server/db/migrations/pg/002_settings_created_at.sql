DO $$
BEGIN
  ALTER TABLE integration_settings ADD COLUMN created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;
