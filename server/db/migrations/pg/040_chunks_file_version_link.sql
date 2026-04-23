-- Link chunks to file versions (without removing legacy enterprise_file_id linkage).

ALTER TABLE enterprise_knowledge_chunks
  ADD COLUMN IF NOT EXISTS enterprise_file_version_id INT;

UPDATE enterprise_knowledge_chunks ekc
SET enterprise_file_version_id = ef.current_version_id
FROM enterprise_files ef
WHERE ef.id = ekc.enterprise_file_id
  AND ef.current_version_id IS NOT NULL
  AND ekc.enterprise_file_version_id IS DISTINCT FROM ef.current_version_id;

UPDATE enterprise_knowledge_chunks ekc
SET enterprise_file_version_id = NULL
WHERE ekc.enterprise_file_version_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM enterprise_file_versions v
    WHERE v.id = ekc.enterprise_file_version_id
      AND v.enterprise_file_id = ekc.enterprise_file_id
  );

CREATE INDEX IF NOT EXISTS idx_ek_chunks_file_version_id
  ON enterprise_knowledge_chunks (enterprise_file_version_id);

CREATE INDEX IF NOT EXISTS idx_ek_chunks_file_version_pair
  ON enterprise_knowledge_chunks (enterprise_file_id, enterprise_file_version_id, chunk_index);

CREATE OR REPLACE FUNCTION trg_set_ekc_file_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.enterprise_file_version_id IS NULL THEN
    SELECT ef.current_version_id
      INTO NEW.enterprise_file_version_id
    FROM enterprise_files ef
    WHERE ef.id = NEW.enterprise_file_id;
  END IF;

  IF NEW.enterprise_file_version_id IS NOT NULL THEN
    PERFORM 1
    FROM enterprise_file_versions v
    WHERE v.id = NEW.enterprise_file_version_id
      AND v.enterprise_file_id = NEW.enterprise_file_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION
        'enterprise_file_version_id % does not belong to enterprise_file_id %',
        NEW.enterprise_file_version_id, NEW.enterprise_file_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_set_ekc_file_version'
      AND tgrelid = 'enterprise_knowledge_chunks'::regclass
  ) THEN
    CREATE TRIGGER trg_set_ekc_file_version
      BEFORE INSERT OR UPDATE OF enterprise_file_id, enterprise_file_version_id
      ON enterprise_knowledge_chunks
      FOR EACH ROW
      EXECUTE FUNCTION trg_set_ekc_file_version();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_ekc_file_version_pair') THEN
    ALTER TABLE enterprise_knowledge_chunks
      ADD CONSTRAINT fk_ekc_file_version_pair
      FOREIGN KEY (enterprise_file_id, enterprise_file_version_id)
      REFERENCES enterprise_file_versions (enterprise_file_id, id);
  END IF;
END $$;
