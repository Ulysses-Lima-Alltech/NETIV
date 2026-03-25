-- Permissões por arquivo: base de conhecimento vs envio ao cliente pela Ana.
-- Idempotente: este arquivo é reaplicado a cada subida do servidor.

ALTER TABLE enterprise_files
  ADD COLUMN IF NOT EXISTS can_be_used_as_knowledge BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS can_be_sent_by_ana BOOLEAN NOT NULL DEFAULT false;

-- Espelha a antiga flag global só enquanto a coluna existir (primeira execução).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'enterprises' AND column_name = 'allow_material_sending'
  ) THEN
    UPDATE enterprise_files ef
    SET can_be_sent_by_ana = CASE WHEN e.allow_material_sending = false THEN false ELSE true END
    FROM enterprises e
    WHERE ef.enterprise_id = e.id;
  END IF;
END $$;

ALTER TABLE enterprise_files ALTER COLUMN can_be_sent_by_ana SET DEFAULT false;

DROP INDEX IF EXISTS idx_enterprise_files_cat;
CREATE INDEX IF NOT EXISTS idx_enterprise_files_cat
  ON enterprise_files (enterprise_id, category)
  WHERE is_active = true AND can_be_sent_by_ana = true;

ALTER TABLE enterprises DROP COLUMN IF EXISTS allow_material_sending;
