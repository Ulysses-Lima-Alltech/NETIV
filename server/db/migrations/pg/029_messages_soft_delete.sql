-- Soft delete de mensagens (exclusão interna NETIV, não WhatsApp)
-- Sem FK para users: tabela users não existe neste banco (usa app_users).
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id INT NULL,
  ADD COLUMN IF NOT EXISTS delete_scope VARCHAR(32) NULL;

-- Índice útil para queries de mensagens não apagadas por conversa
CREATE INDEX IF NOT EXISTS idx_messages_not_deleted
  ON messages (conversation_id, created_at, id)
  WHERE deleted_at IS NULL;
