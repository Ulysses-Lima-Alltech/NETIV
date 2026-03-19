-- Campos para Agenda: recebimento habilitado e último atribuído
ALTER TABLE corretores ADD COLUMN IF NOT EXISTS receiving_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE corretores ADD COLUMN IF NOT EXISTS last_assigned_at TIMESTAMPTZ NULL;
