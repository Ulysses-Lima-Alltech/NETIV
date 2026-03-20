-- Modelo B: lead_temperature nullable, sem default; temperatura só quando definida de verdade.
-- Idempotente no boot: DDL repetível; backfill de dados roda só uma vez (tabela de controle).

CREATE TABLE IF NOT EXISTS _netiv_migration_applied (
  id TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE conversations ALTER COLUMN lead_temperature DROP NOT NULL;
ALTER TABLE conversations ALTER COLUMN lead_temperature DROP DEFAULT;

-- Uma vez: Novo + apenas 'frio' legado (indistinguível do DEFAULT antigo) → NULL
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _netiv_migration_applied WHERE id = '013_novo_frio_to_null') THEN
    UPDATE conversations
    SET lead_temperature = NULL
    WHERE classification = 'Novo'
      AND lead_temperature = 'frio';
    INSERT INTO _netiv_migration_applied (id) VALUES ('013_novo_frio_to_null');
  END IF;
END $$;
