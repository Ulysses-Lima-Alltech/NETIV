-- Encerramento manual (inbox) + controle de reengajamento da Ana (janela 24h WhatsApp)
ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS manual_closed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS manual_closed_by_user_id INT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS manual_closed_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS reengagement_sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS reengagement_for_user_message_id INT NULL REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reengagement_count INT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_conversations_manual_closed_at ON conversations (manual_closed_at) WHERE manual_closed_at IS NOT NULL;

COMMENT ON COLUMN conversations.reengagement_for_user_message_id IS 'Última mensagem inbound do cliente para a qual já foi enviado reengajamento neste ciclo; novo inbound zera.';
