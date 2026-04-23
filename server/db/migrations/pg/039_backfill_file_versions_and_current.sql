-- Backfill initial version rows and align enterprise_files.current_version_id.
-- Also adds compatibility trigger for new file inserts.

INSERT INTO enterprise_file_versions (
  enterprise_file_id,
  version_number,
  original_name,
  storage_path,
  mime_type,
  size_bytes,
  extracted_text,
  file_data,
  storage_provider,
  storage_key,
  bucket_name,
  public_url,
  change_reason,
  created_at
)
SELECT
  ef.id,
  1,
  ef.original_name,
  ef.storage_path,
  ef.mime_type,
  ef.size_bytes,
  ef.extracted_text,
  ef.file_data,
  ef.storage_provider,
  ef.storage_key,
  ef.bucket_name,
  ef.public_url,
  'initial_backfill',
  COALESCE(ef.created_at, NOW())
FROM enterprise_files ef
WHERE NOT EXISTS (
  SELECT 1
  FROM enterprise_file_versions v
  WHERE v.enterprise_file_id = ef.id
)
ON CONFLICT (enterprise_file_id, version_number) DO NOTHING;

WITH latest AS (
  SELECT DISTINCT ON (v.enterprise_file_id)
    v.enterprise_file_id,
    v.id
  FROM enterprise_file_versions v
  ORDER BY v.enterprise_file_id, v.version_number DESC, v.id DESC
)
UPDATE enterprise_files ef
SET current_version_id = latest.id
FROM latest
WHERE ef.id = latest.enterprise_file_id
  AND ef.current_version_id IS DISTINCT FROM latest.id;

UPDATE enterprise_files ef
SET current_version_id = NULL
WHERE ef.current_version_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM enterprise_file_versions v
    WHERE v.id = ef.current_version_id
      AND v.enterprise_file_id = ef.id
  );

CREATE OR REPLACE FUNCTION trg_enterprise_files_seed_initial_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_id INT;
BEGIN
  IF NEW.current_version_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO enterprise_file_versions (
    enterprise_file_id,
    version_number,
    original_name,
    storage_path,
    mime_type,
    size_bytes,
    extracted_text,
    file_data,
    storage_provider,
    storage_key,
    bucket_name,
    public_url,
    change_reason,
    created_at
  )
  VALUES (
    NEW.id,
    1,
    NEW.original_name,
    NEW.storage_path,
    NEW.mime_type,
    NEW.size_bytes,
    NEW.extracted_text,
    NEW.file_data,
    NEW.storage_provider,
    NEW.storage_key,
    NEW.bucket_name,
    NEW.public_url,
    'auto_insert_seed',
    COALESCE(NEW.created_at, NOW())
  )
  ON CONFLICT (enterprise_file_id, version_number) DO UPDATE
  SET enterprise_file_id = EXCLUDED.enterprise_file_id
  RETURNING id INTO v_id;

  UPDATE enterprise_files
  SET current_version_id = v_id
  WHERE id = NEW.id
    AND current_version_id IS NULL;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_enterprise_files_seed_initial_version'
      AND tgrelid = 'enterprise_files'::regclass
  ) THEN
    CREATE TRIGGER trg_enterprise_files_seed_initial_version
      AFTER INSERT
      ON enterprise_files
      FOR EACH ROW
      EXECUTE FUNCTION trg_enterprise_files_seed_initial_version();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_enterprise_files_current_version') THEN
    ALTER TABLE enterprise_files
      ADD CONSTRAINT fk_enterprise_files_current_version
      FOREIGN KEY (id, current_version_id)
      REFERENCES enterprise_file_versions (enterprise_file_id, id);
  END IF;
END $$;
