-- Canonical enterprise aliases for RAG/entity resolution.
-- Safe rollout: structure + idempotent backfill.

CREATE OR REPLACE FUNCTION normalize_enterprise_alias_text(input_text TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT NULLIF(regexp_replace(lower(trim(input_text)), '\s+', ' ', 'g'), '')
$$;

CREATE TABLE IF NOT EXISTS enterprise_aliases (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id INT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  normalized_alias TEXT NOT NULL,
  alias_kind VARCHAR(24) NOT NULL DEFAULT 'DISPLAY',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enterprise_aliases_alias_not_blank') THEN
    ALTER TABLE enterprise_aliases
      ADD CONSTRAINT chk_enterprise_aliases_alias_not_blank
      CHECK (length(trim(alias)) > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enterprise_aliases_alias_kind') THEN
    ALTER TABLE enterprise_aliases
      ADD CONSTRAINT chk_enterprise_aliases_alias_kind
      CHECK (alias_kind IN ('DISPLAY', 'SLUG', 'LEGACY', 'IMPORT'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_enterprise_aliases_enterprise_normalized') THEN
    ALTER TABLE enterprise_aliases
      ADD CONSTRAINT uq_enterprise_aliases_enterprise_normalized
      UNIQUE (enterprise_id, normalized_alias);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_enterprise_aliases_normalized_alias
  ON enterprise_aliases (normalized_alias);

CREATE INDEX IF NOT EXISTS idx_enterprise_aliases_enterprise_id
  ON enterprise_aliases (enterprise_id);

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY enterprise_id
      ORDER BY is_primary DESC, id ASC
    ) AS rn
  FROM enterprise_aliases
  WHERE is_primary = true
)
UPDATE enterprise_aliases ea
SET is_primary = false,
    updated_at = NOW()
FROM ranked r
WHERE ea.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_enterprise_aliases_one_primary
  ON enterprise_aliases (enterprise_id)
  WHERE is_primary = true;

CREATE OR REPLACE FUNCTION trg_set_enterprise_aliases_normalized()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.alias := COALESCE(trim(NEW.alias), '');
  NEW.normalized_alias := normalize_enterprise_alias_text(NEW.alias);

  IF NEW.normalized_alias IS NULL THEN
    RAISE EXCEPTION 'enterprise_aliases.alias cannot be blank';
  END IF;

  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_enterprise_aliases_normalized'
      AND tgrelid = 'enterprise_aliases'::regclass
  ) THEN
    CREATE TRIGGER trg_enterprise_aliases_normalized
      BEFORE INSERT OR UPDATE OF alias
      ON enterprise_aliases
      FOR EACH ROW
      EXECUTE FUNCTION trg_set_enterprise_aliases_normalized();
  END IF;
END $$;

INSERT INTO enterprise_aliases (enterprise_id, alias, normalized_alias, alias_kind, is_primary)
SELECT
  e.id,
  e.name,
  normalize_enterprise_alias_text(e.name),
  'DISPLAY',
  true
FROM enterprises e
WHERE normalize_enterprise_alias_text(e.name) IS NOT NULL
ON CONFLICT (enterprise_id, normalized_alias) DO UPDATE
SET is_primary = true,
    updated_at = NOW();

INSERT INTO enterprise_aliases (enterprise_id, alias, normalized_alias, alias_kind, is_primary)
SELECT
  e.id,
  e.slug,
  normalize_enterprise_alias_text(e.slug),
  'SLUG',
  false
FROM enterprises e
WHERE normalize_enterprise_alias_text(e.slug) IS NOT NULL
ON CONFLICT (enterprise_id, normalized_alias) DO NOTHING;
