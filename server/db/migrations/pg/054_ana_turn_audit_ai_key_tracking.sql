ALTER TABLE ana_turn_audit
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS model TEXT,
  ADD COLUMN IF NOT EXISTS api_key_source TEXT,
  ADD COLUMN IF NOT EXISTS openai_api_key_id TEXT,
  ADD COLUMN IF NOT EXISTS openai_project_id TEXT,
  ADD COLUMN IF NOT EXISTS input_tokens INT,
  ADD COLUMN IF NOT EXISTS output_tokens INT,
  ADD COLUMN IF NOT EXISTS cached_input_tokens INT,
  ADD COLUMN IF NOT EXISTS request_type TEXT,
  ADD COLUMN IF NOT EXISTS llm_status TEXT,
  ADD COLUMN IF NOT EXISTS llm_http_status INT,
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ana_turn_audit_api_key_source') THEN
    ALTER TABLE ana_turn_audit
      ADD CONSTRAINT chk_ana_turn_audit_api_key_source
      CHECK (
        api_key_source IS NULL
        OR api_key_source IN ('enterprise', 'global_fallback')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_ana_turn_audit_llm_status') THEN
    ALTER TABLE ana_turn_audit
      ADD CONSTRAINT chk_ana_turn_audit_llm_status
      CHECK (
        llm_status IS NULL
        OR llm_status IN ('success', 'blocked', 'skipped', 'error')
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ana_turn_audit_api_key_source
  ON ana_turn_audit (api_key_source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ana_turn_audit_openai_api_key_id
  ON ana_turn_audit (openai_api_key_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ana_turn_audit_openai_project_id
  ON ana_turn_audit (openai_project_id, created_at DESC);