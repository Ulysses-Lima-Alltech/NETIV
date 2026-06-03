-- Mantem uma unica base canonica ativa para o Evora quando a v1.2 ja esta carregada.
-- A v1.2 passa a ser a fonte de conhecimento prioritaria; Exemplos.txt deixa de competir.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'enterprise_files'
      AND column_name IN ('can_be_used_as_knowledge', 'is_active')
    GROUP BY table_name
    HAVING COUNT(DISTINCT column_name) = 2
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'enterprise_file_versions'
      AND column_name IN ('can_be_used_as_knowledge', 'is_active', 'source_priority')
    GROUP BY table_name
    HAVING COUNT(DISTINCT column_name) = 3
  ) THEN
    WITH evora_enterprises AS (
      SELECT id
      FROM enterprises
      WHERE lower(name) LIKE '%evora%' OR lower(name) LIKE '%' || chr(233) || 'vora%'
    ),
    canonical_files AS (
      SELECT f.id, f.current_version_id
      FROM enterprise_files f
      JOIN evora_enterprises e ON e.id = f.enterprise_id
      WHERE lower(f.original_name) = 'base_unica_ana_evora_v1_2.txt'
    ),
    legacy_examples AS (
      SELECT f.id, f.current_version_id
      FROM enterprise_files f
      JOIN evora_enterprises e ON e.id = f.enterprise_id
      WHERE lower(f.original_name) = 'exemplos.txt'
        AND EXISTS (
          SELECT 1
          FROM canonical_files c
          JOIN enterprise_files cf ON cf.id = c.id
          WHERE cf.enterprise_id = f.enterprise_id
        )
    )
    UPDATE enterprise_files f
    SET
      is_active = true,
      can_be_used_as_knowledge = true
    FROM canonical_files c
    WHERE f.id = c.id;

    WITH evora_enterprises AS (
      SELECT id
      FROM enterprises
      WHERE lower(name) LIKE '%evora%' OR lower(name) LIKE '%' || chr(233) || 'vora%'
    ),
    canonical_files AS (
      SELECT f.id, f.current_version_id
      FROM enterprise_files f
      JOIN evora_enterprises e ON e.id = f.enterprise_id
      WHERE lower(f.original_name) = 'base_unica_ana_evora_v1_2.txt'
    )
    UPDATE enterprise_file_versions v
    SET
      is_active = true,
      can_be_used_as_knowledge = true,
      source_priority = GREATEST(COALESCE(source_priority, 0), 1200)
    FROM canonical_files c
    WHERE v.id = c.current_version_id;

    WITH evora_enterprises AS (
      SELECT id
      FROM enterprises
      WHERE lower(name) LIKE '%evora%' OR lower(name) LIKE '%' || chr(233) || 'vora%'
    ),
    canonical_files AS (
      SELECT f.enterprise_id
      FROM enterprise_files f
      JOIN evora_enterprises e ON e.id = f.enterprise_id
      WHERE lower(f.original_name) = 'base_unica_ana_evora_v1_2.txt'
    ),
    legacy_examples AS (
      SELECT f.id, f.current_version_id
      FROM enterprise_files f
      JOIN canonical_files c ON c.enterprise_id = f.enterprise_id
      WHERE lower(f.original_name) = 'exemplos.txt'
    )
    UPDATE enterprise_files f
    SET can_be_used_as_knowledge = false
    FROM legacy_examples l
    WHERE f.id = l.id;

    WITH evora_enterprises AS (
      SELECT id
      FROM enterprises
      WHERE lower(name) LIKE '%evora%' OR lower(name) LIKE '%' || chr(233) || 'vora%'
    ),
    canonical_files AS (
      SELECT f.enterprise_id
      FROM enterprise_files f
      JOIN evora_enterprises e ON e.id = f.enterprise_id
      WHERE lower(f.original_name) = 'base_unica_ana_evora_v1_2.txt'
    ),
    legacy_examples AS (
      SELECT f.id, f.current_version_id
      FROM enterprise_files f
      JOIN canonical_files c ON c.enterprise_id = f.enterprise_id
      WHERE lower(f.original_name) = 'exemplos.txt'
    )
    UPDATE enterprise_file_versions v
    SET
      can_be_used_as_knowledge = false,
      source_priority = LEAST(COALESCE(source_priority, 0), 10)
    FROM legacy_examples l
    WHERE v.id = l.current_version_id;
  END IF;
END $$;
