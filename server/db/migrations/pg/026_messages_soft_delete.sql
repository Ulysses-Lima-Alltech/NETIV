-- Soft delete de mensagens (exclusão interna NETIV, não WhatsApp)
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS deleted_by_user_id INT NULL REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS delete_scope VARCHAR(32) NULL;

-- Índice para queries que filtram apenas mensagens não apagadas
CREATE INDEX IF NOT EXISTS idx_messages_deleted_at ON messages (deleted_at)
  WHERE deleted_at IS NULL;
