-- Preserva classificação anterior ao entrar em handoff para restaurar ao voltar para ANA.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS classification_before_handoff VARCHAR(32);
