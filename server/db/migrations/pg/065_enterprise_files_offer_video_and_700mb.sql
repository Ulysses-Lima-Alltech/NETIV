ALTER TABLE enterprise_files
  ADD COLUMN IF NOT EXISTS can_be_offered_by_ana BOOLEAN NOT NULL DEFAULT false;

UPDATE enterprise_files
SET can_be_offered_by_ana = false
WHERE can_be_offered_by_ana IS NULL;

DO $$
DECLARE
  c RECORD;
BEGIN
  FOR c IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'enterprise_files'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%category%'
  LOOP
    EXECUTE format('ALTER TABLE enterprise_files DROP CONSTRAINT IF EXISTS %I', c.conname);
  END LOOP;
END $$;

ALTER TABLE enterprise_files
  ADD CONSTRAINT enterprise_files_category_check
  CHECK (category IN ('book', 'base_ana', 'foto', 'video', 'mapa_localizacao', 'tabela_comercial', 'outro', 'unidades'));
