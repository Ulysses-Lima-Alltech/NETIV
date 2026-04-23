-- Contrato conservador de enterprise_variables.var_key (Fase 1).
-- Whitelist aprovada:
-- preco, metragem, financiamento, endereco, bairro, cidade, estado, lazer, diferenciais, status_obra, observacoes

CREATE OR REPLACE FUNCTION normalize_enterprise_var_key(input_key TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT NULLIF(lower(trim(input_key)), '')
$$;

WITH ranked AS (
  SELECT
    enterprise_id,
    normalize_enterprise_var_key(var_key) AS normalized_key,
    COALESCE(value, '') AS value,
    COALESCE(updated_at, NOW()) AS updated_at,
    ROW_NUMBER() OVER (
      PARTITION BY enterprise_id, normalize_enterprise_var_key(var_key)
      ORDER BY
        CASE WHEN COALESCE(NULLIF(trim(value), ''), '') = '' THEN 1 ELSE 0 END,
        updated_at DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM enterprise_variables
  WHERE normalize_enterprise_var_key(var_key) IS NOT NULL
)
INSERT INTO enterprise_variables (enterprise_id, var_key, value, updated_at)
SELECT
  enterprise_id,
  normalized_key,
  value,
  updated_at
FROM ranked
WHERE rn = 1
ON CONFLICT (enterprise_id, var_key) DO UPDATE
SET
  value = CASE
    WHEN COALESCE(NULLIF(trim(enterprise_variables.value), ''), '') = '' THEN EXCLUDED.value
    WHEN COALESCE(NULLIF(trim(EXCLUDED.value), ''), '') = '' THEN enterprise_variables.value
    WHEN position(EXCLUDED.value IN enterprise_variables.value) > 0 THEN enterprise_variables.value
    ELSE enterprise_variables.value || E'\n' || EXCLUDED.value
  END,
  updated_at = GREATEST(enterprise_variables.updated_at, EXCLUDED.updated_at);

WITH invalid_payload AS (
  SELECT
    enterprise_id,
    string_agg('[chave_invalida] ' || trim(value), E'\n' ORDER BY id) AS payload
  FROM enterprise_variables
  WHERE normalize_enterprise_var_key(var_key) IS NULL
    AND COALESCE(NULLIF(trim(value), ''), '') <> ''
  GROUP BY enterprise_id
)
INSERT INTO enterprise_variables (enterprise_id, var_key, value, updated_at)
SELECT
  enterprise_id,
  'observacoes',
  payload,
  NOW()
FROM invalid_payload
ON CONFLICT (enterprise_id, var_key) DO UPDATE
SET
  value = CASE
    WHEN COALESCE(NULLIF(trim(enterprise_variables.value), ''), '') = '' THEN EXCLUDED.value
    WHEN position(EXCLUDED.value IN enterprise_variables.value) > 0 THEN enterprise_variables.value
    ELSE enterprise_variables.value || E'\n\n' || EXCLUDED.value
  END,
  updated_at = NOW();

DELETE FROM enterprise_variables
WHERE normalize_enterprise_var_key(var_key) IS NULL;

DELETE FROM enterprise_variables
WHERE var_key <> normalize_enterprise_var_key(var_key);

INSERT INTO enterprise_variables (enterprise_id, var_key, value, updated_at)
SELECT
  enterprise_id,
  'financiamento',
  value,
  COALESCE(updated_at, NOW())
FROM enterprise_variables
WHERE var_key = 'condicoes'
  AND COALESCE(NULLIF(trim(value), ''), '') <> ''
ON CONFLICT (enterprise_id, var_key) DO UPDATE
SET
  value = CASE
    WHEN COALESCE(NULLIF(trim(enterprise_variables.value), ''), '') = '' THEN EXCLUDED.value
    WHEN position(EXCLUDED.value IN enterprise_variables.value) > 0 THEN enterprise_variables.value
    ELSE enterprise_variables.value || E'\n' || EXCLUDED.value
  END,
  updated_at = GREATEST(enterprise_variables.updated_at, EXCLUDED.updated_at);

INSERT INTO enterprise_variables (enterprise_id, var_key, value, updated_at)
SELECT
  enterprise_id,
  'status_obra',
  value,
  COALESCE(updated_at, NOW())
FROM enterprise_variables
WHERE var_key = 'disponibilidade'
  AND COALESCE(NULLIF(trim(value), ''), '') <> ''
ON CONFLICT (enterprise_id, var_key) DO UPDATE
SET
  value = CASE
    WHEN COALESCE(NULLIF(trim(enterprise_variables.value), ''), '') = '' THEN EXCLUDED.value
    WHEN position(EXCLUDED.value IN enterprise_variables.value) > 0 THEN enterprise_variables.value
    ELSE enterprise_variables.value || E'\n' || EXCLUDED.value
  END,
  updated_at = GREATEST(enterprise_variables.updated_at, EXCLUDED.updated_at);

DELETE FROM enterprise_variables
WHERE var_key IN ('condicoes', 'disponibilidade');

WITH extras AS (
  SELECT
    enterprise_id,
    string_agg('[' || var_key || '] ' || trim(value), E'\n' ORDER BY updated_at NULLS LAST, id) AS payload
  FROM enterprise_variables
  WHERE var_key NOT IN (
    'preco',
    'metragem',
    'financiamento',
    'endereco',
    'bairro',
    'cidade',
    'estado',
    'lazer',
    'diferenciais',
    'status_obra',
    'observacoes'
  )
    AND COALESCE(NULLIF(trim(value), ''), '') <> ''
  GROUP BY enterprise_id
)
INSERT INTO enterprise_variables (enterprise_id, var_key, value, updated_at)
SELECT
  enterprise_id,
  'observacoes',
  payload,
  NOW()
FROM extras
ON CONFLICT (enterprise_id, var_key) DO UPDATE
SET
  value = CASE
    WHEN COALESCE(NULLIF(trim(enterprise_variables.value), ''), '') = '' THEN EXCLUDED.value
    WHEN position(EXCLUDED.value IN enterprise_variables.value) > 0 THEN enterprise_variables.value
    ELSE enterprise_variables.value || E'\n\n' || EXCLUDED.value
  END,
  updated_at = NOW();

DELETE FROM enterprise_variables
WHERE var_key NOT IN (
  'preco',
  'metragem',
  'financiamento',
  'endereco',
  'bairro',
  'cidade',
  'estado',
  'lazer',
  'diferenciais',
  'status_obra',
  'observacoes'
);

CREATE OR REPLACE FUNCTION trg_enterprise_variables_normalize_var_key()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  k TEXT;
BEGIN
  k := normalize_enterprise_var_key(NEW.var_key);

  IF k IS NULL THEN
    RAISE EXCEPTION 'enterprise_variables.var_key cannot be blank';
  END IF;

  IF k = 'condicoes' THEN
    k := 'financiamento';
  ELSIF k = 'disponibilidade' THEN
    k := 'status_obra';
  END IF;

  NEW.var_key := k;
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_enterprise_variables_normalize_var_key'
      AND tgrelid = 'enterprise_variables'::regclass
  ) THEN
    CREATE TRIGGER trg_enterprise_variables_normalize_var_key
      BEFORE INSERT OR UPDATE OF var_key, value
      ON enterprise_variables
      FOR EACH ROW
      EXECUTE FUNCTION trg_enterprise_variables_normalize_var_key();
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enterprise_variables_var_key_not_blank') THEN
    ALTER TABLE enterprise_variables
      ADD CONSTRAINT chk_enterprise_variables_var_key_not_blank
      CHECK (length(trim(var_key)) > 0);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_enterprise_variables_var_key_contract') THEN
    ALTER TABLE enterprise_variables
      ADD CONSTRAINT chk_enterprise_variables_var_key_contract
      CHECK (
        var_key IN (
          'preco',
          'metragem',
          'financiamento',
          'endereco',
          'bairro',
          'cidade',
          'estado',
          'lazer',
          'diferenciais',
          'status_obra',
          'observacoes'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_enterprise_variables_var_key
  ON enterprise_variables (var_key);
