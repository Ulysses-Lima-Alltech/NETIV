-- Handoff agendado após confirmação (janela de 5 min para reagendar sem ir para humano).
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_deferred_until TIMESTAMPTZ NULL;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS handoff_deferred_broker_id INT NULL REFERENCES corretores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_handoff_defer_due
  ON conversations (handoff_deferred_until)
  WHERE handoff_deferred_until IS NOT NULL;
