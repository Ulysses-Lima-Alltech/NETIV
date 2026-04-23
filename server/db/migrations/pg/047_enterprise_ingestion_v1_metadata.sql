-- Fase 3: metadados operacionais de ingestão v1 + controle de chunks ativos por versao.

ALTER TABLE enterprise_file_versions
  ADD COLUMN IF NOT EXISTS file_kind VARCHAR(48),
  ADD COLUMN IF NOT EXISTS source VARCHAR(64),
  ADD COLUMN IF NOT EXISTS source_priority INT,
  ADD COLUMN IF NOT EXISTS can_be_sent_by_ana BOOLEAN,
  ADD COLUMN IF NOT EXISTS can_be_used_as_knowledge BOOLEAN,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN,
  ADD COLUMN IF NOT EXISTS processing_status VARCHAR(24),
  ADD COLUMN IF NOT EXISTS processing_error TEXT,
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS extracted_text_source VARCHAR(48),
  ADD COLUMN IF NOT EXISTS text_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS chunk_count INT,
  ADD COLUMN IF NOT EXISTS manifest_s3_key TEXT,
  ADD COLUMN IF NOT EXISTS raw_s3_key TEXT,
  ADD COLUMN IF NOT EXISTS extracted_s3_key TEXT,
  ADD COLUMN IF NOT EXISTS normalized_s3_key TEXT,
  ADD COLUMN IF NOT EXISTS failed_s3_key TEXT;

UPDATE enterprise_file_versions v
SET
  file_kind = COALESCE(NULLIF(trim(v.file_kind), ''), 'unknown'),
  source = COALESCE(NULLIF(trim(v.source), ''), CASE
    WHEN COALESCE(v.storage_provider, '') = 'r2' THEN 'legacy_r2_import'
    WHEN COALESCE(v.storage_provider, '') = 's3' THEN 's3_import'
    ELSE 'legacy_local_import'
  END),
  source_priority = COALESCE(v.source_priority, 10),
  can_be_sent_by_ana = COALESCE(v.can_be_sent_by_ana, f.can_be_sent_by_ana, false),
  can_be_used_as_knowledge = COALESCE(v.can_be_used_as_knowledge, f.can_be_used_as_knowledge, true),
  is_active = COALESCE(v.is_active, f.is_active, true),
  processing_status = COALESCE(NULLIF(trim(v.processing_status), ''), 'PENDING'),
  chunk_count = COALESCE(v.chunk_count, 0)
FROM enterprise_files f
WHERE f.id = v.enterprise_file_id;

UPDATE enterprise_file_versions
SET source_priority = 0
WHERE source_priority < 0;

UPDATE enterprise_file_versions
SET chunk_count = 0
WHERE chunk_count < 0;

UPDATE enterprise_file_versions
SET processing_status = 'PENDING'
WHERE processing_status NOT IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'SKIPPED');

ALTER TABLE enterprise_file_versions
  ALTER COLUMN file_kind SET DEFAULT 'unknown',
  ALTER COLUMN file_kind SET NOT NULL,
  ALTER COLUMN source SET DEFAULT 'legacy_r2_import',
  ALTER COLUMN source SET NOT NULL,
  ALTER COLUMN source_priority SET DEFAULT 10,
  ALTER COLUMN source_priority SET NOT NULL,
  ALTER COLUMN can_be_sent_by_ana SET DEFAULT false,
  ALTER COLUMN can_be_sent_by_ana SET NOT NULL,
  ALTER COLUMN can_be_used_as_knowledge SET DEFAULT true,
  ALTER COLUMN can_be_used_as_knowledge SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN processing_status SET DEFAULT 'PENDING',
  ALTER COLUMN processing_status SET NOT NULL,
  ALTER COLUMN chunk_count SET DEFAULT 0,
  ALTER COLUMN chunk_count SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_efv_file_kind') THEN
    ALTER TABLE enterprise_file_versions
      ADD CONSTRAINT chk_efv_file_kind
      CHECK (file_kind IN (
        'canonical_sales_script',
        'faq',
        'product_summary',
        'brochure',
        'price_table',
        'floorplan',
        'legacy_support_material',
        'unknown'
      ));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_efv_processing_status') THEN
    ALTER TABLE enterprise_file_versions
      ADD CONSTRAINT chk_efv_processing_status
      CHECK (processing_status IN ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED', 'SKIPPED'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_efv_source_priority_non_negative') THEN
    ALTER TABLE enterprise_file_versions
      ADD CONSTRAINT chk_efv_source_priority_non_negative
      CHECK (source_priority >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_efv_chunk_count_non_negative') THEN
    ALTER TABLE enterprise_file_versions
      ADD CONSTRAINT chk_efv_chunk_count_non_negative
      CHECK (chunk_count >= 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_efv_text_hash_sha256') THEN
    ALTER TABLE enterprise_file_versions
      ADD CONSTRAINT chk_efv_text_hash_sha256
      CHECK (text_hash IS NULL OR text_hash ~ '^[0-9a-f]{64}$');
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_efv_processing_status
  ON enterprise_file_versions (processing_status, processed_at DESC);

CREATE INDEX IF NOT EXISTS idx_efv_enterprise_file_priority
  ON enterprise_file_versions (enterprise_file_id, is_active, can_be_used_as_knowledge, source_priority DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_efv_source
  ON enterprise_file_versions (source, source_priority DESC, id DESC);

ALTER TABLE enterprise_knowledge_chunks
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN;

UPDATE enterprise_knowledge_chunks
SET is_active = true
WHERE is_active IS NULL;

ALTER TABLE enterprise_knowledge_chunks
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN is_active SET NOT NULL;

ALTER TABLE enterprise_knowledge_chunks
  DROP CONSTRAINT IF EXISTS enterprise_knowledge_chunks_enterprise_file_id_chunk_index_key;

CREATE UNIQUE INDEX IF NOT EXISTS uq_ek_chunks_active_version_chunk
  ON enterprise_knowledge_chunks (enterprise_file_version_id, chunk_index)
  WHERE enterprise_file_version_id IS NOT NULL AND is_active = true;

CREATE INDEX IF NOT EXISTS idx_ek_chunks_active_enterprise
  ON enterprise_knowledge_chunks (enterprise_id, enterprise_file_version_id, chunk_index)
  WHERE is_active = true;
