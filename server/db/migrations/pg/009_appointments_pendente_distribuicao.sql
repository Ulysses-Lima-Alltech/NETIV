-- Status PENDENTE_DISTRIBUICAO para agendamentos sem corretor elegível
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'appointments' AND constraint_name = 'appointments_status_check'
  ) THEN
    ALTER TABLE appointments DROP CONSTRAINT appointments_status_check;
  END IF;
  ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
    CHECK (status IN ('PENDENTE_CONFIRMACAO', 'CONFIRMADO', 'CANCELADO', 'REALIZADO', 'NO_SHOW', 'PENDENTE_DISTRIBUICAO'));
EXCEPTION WHEN OTHERS THEN
  -- Se o constraint tiver outro nome ou não existir, tenta alternativas
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname LIKE '%appointments%status%' AND conrelid = 'appointments'::regclass
  ) THEN
    EXECUTE (
      SELECT 'ALTER TABLE appointments DROP CONSTRAINT ' || quote_ident(conname)
      FROM pg_constraint WHERE conname LIKE '%appointments%status%' AND conrelid = 'appointments'::regclass LIMIT 1
    );
  END IF;
  ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
    CHECK (status IN ('PENDENTE_CONFIRMACAO', 'CONFIRMADO', 'CANCELADO', 'REALIZADO', 'NO_SHOW', 'PENDENTE_DISTRIBUICAO'));
END $$;
