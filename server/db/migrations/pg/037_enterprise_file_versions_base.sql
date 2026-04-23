-- Base de versionamento físico de arquivos de empreendimento (Fase 1).
-- Compatível com cenário atual e preparada para local/r2/s3.

CREATE TABLE IF NOT EXISTS enterprise_file_versions (
  id SERIAL PRIMARY KEY,
  enterprise_file_id INT NOT NULL
);

ALTER TABLE enterprise_file_versions
  ADD COLUMN IF NOT EXISTS version_number INT,
  ADD COLUMN IF NOT EXISTS original_name TEXT,
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(128),
  ADD COLUMN IF NOT EXISTS size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS checksum_sha256 VARCHAR(64),
  ADD COLUMN IF NOT EXISTS file_data BYTEA,
  ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(20),
  ADD COLUMN IF NOT EXISTS storage_key TEXT,
  ADD COLUMN IF NOT EXISTS bucket_name TEXT,
  ADD COLUMN IF NOT EXISTS public_url TEXT,
  ADD COLUMN IF NOT EXISTS extracted_text TEXT,
  ADD COLUMN IF NOT EXISTS change_reason VARCHAR(64),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_by_user_id INT;

UPDATE enterprise_file_versions
SET version_number = 1
WHERE version_number IS NULL OR version_number < 1;

UPDATE enterprise_file_versions
SET
  original_name = COALESCE(NULLIF(trim(original_name), ''), 'arquivo_sem_nome'),
  storage_path = COALESCE(NULLIF(trim(storage_path), ''), 'legacy/unknown'),
  mime_type = COALESCE(NULLIF(trim(mime_type), ''), 'application/octet-stream'),
  size_bytes = COALESCE(size_bytes, 0),
  change_reason = COALESCE(NULLIF(trim(change_reason), ''), 'snapshot'),
  created_at = COALESCE(created_at, NOW())
WHERE original_name IS NULL
   OR trim(original_name) = ''
   OR storage_path IS NULL
   OR trim(storage_path) = ''
   OR mime_type IS NULL
   OR trim(mime_type) = ''
   OR size_bytes IS NULL
   OR change_reason IS NULL
   OR trim(change_reason) = ''
   OR created_at IS NULL;

UPDATE enterprise_file_versions
SET checksum_sha256 = NULLIF(lower(trim(checksum_sha256)), '')
WHERE checksum_sha256 IS NOT NULL;

UPDATE enterprise_file_versions
SET storage_provider = CASE
  WHEN lower(trim(storage_provider)) IN ('local', 'r2', 's3') THEN lower(trim(storage_provider))
  ELSE NULL
END
WHERE storage_provider IS NOT NULL;

ALTER TABLE enterprise_file_versions
  ALTER COLUMN version_number SET DEFAULT 1,
  ALTER COLUMN version_number SET NOT NULL,
  ALTER COLUMN original_name SET NOT NULL,
  ALTER COLUMN storage_path SET NOT NULL,
  ALTER COLUMN mime_type SET NOT NULL,
  ALTER COLUMN size_bytes SET DEFAULT 0,
  ALTER COLUMN size_bytes SET NOT NULL,
  ALTER COLUMN change_reason SET DEFAULT 'snapshot',
  ALTER COLUMN change_reason SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_efv_enterprise_file') THEN
    ALTER TABLE enterprise_file_versions
      ADD CONSTRAINT fk_efv_enterprise_file
      FOREIGN KEY (enterprise_file_id) REFERENCES enterprise_files(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_efv_created_by_user') THEN
    ALTER TABLE enterprise_file_versions
      ADD CONSTRAINT fk_efv_created_by_user
      FOREIGN KEY (created_by_user_id) REFERENCES app_users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_efv_version_number_positive') THEN
    ALTER TABLE enterprise_file_versions
      ADD CONSTRAINT chk_efv_version_number_positive
      CHECK (version_number >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_efv_storage_provider') THEN
    ALTER TABLE enterprise_file_versions
      ADD CONSTRAINT chk_efv_storage_provider
      CHECK (storage_provider IS NULL OR storage_provider IN ('local', 'r2', 's3'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_efv_checksum_sha256') THEN
    ALTER TABLE enterprise_file_versions
      ADD CONSTRAINT chk_efv_checksum_sha256
      CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_efv_change_reason_not_blank') THEN
    ALTER TABLE enterprise_file_versions
      ADD CONSTRAINT chk_efv_change_reason_not_blank
      CHECK (length(trim(change_reason)) > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_efv_file_version_number') THEN
    ALTER TABLE enterprise_file_versions
      ADD CONSTRAINT uq_efv_file_version_number
      UNIQUE (enterprise_file_id, version_number);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_efv_file_id_id') THEN
    ALTER TABLE enterprise_file_versions
      ADD CONSTRAINT uq_efv_file_id_id
      UNIQUE (enterprise_file_id, id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_efv_file_version_desc
  ON enterprise_file_versions (enterprise_file_id, version_number DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_efv_created_at
  ON enterprise_file_versions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_efv_checksum_sha256
  ON enterprise_file_versions (checksum_sha256)
  WHERE checksum_sha256 IS NOT NULL;
