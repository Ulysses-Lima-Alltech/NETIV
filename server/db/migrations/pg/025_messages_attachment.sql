-- Metadados de mídia/arquivo nas mensagens (histórico inbox + correlatos WhatsApp).

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS message_kind VARCHAR(24) NOT NULL DEFAULT 'text';

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS attachment_json JSONB;

COMMENT ON COLUMN messages.message_kind IS 'text | document | image';
COMMENT ON COLUMN messages.attachment_json IS 'nome, mime, tamanho, media id Meta, legenda, etc.';
