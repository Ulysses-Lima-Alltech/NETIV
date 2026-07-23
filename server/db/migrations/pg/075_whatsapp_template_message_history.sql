-- Historico canonico de templates WhatsApp enviados por lote.
-- Mantem content/attachment_json para compatibilidade com o Inbox existente e
-- adiciona rastreabilidade/status sem duplicar os bytes da midia.

-- O executor aplica cada migration em uma transacao. Evita aguardar locks
-- indefinidamente e aborta/rollbacka a migration se a janela ficar insegura.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '15min';

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS message_origin VARCHAR(64) NULL,
  ADD COLUMN IF NOT EXISTS template_json JSONB NULL,
  ADD COLUMN IF NOT EXISTS delivery_status VARCHAR(24) NOT NULL DEFAULT 'sent',
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS failed_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS failure_json JSONB NULL,
  ADD COLUMN IF NOT EXISTS batch_id BIGINT NULL REFERENCES whatsapp_batch_scheduled_sends(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_recipient_id BIGINT NULL REFERENCES whatsapp_batch_scheduled_send_recipients(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS batch_row_number INT NULL,
  ADD COLUMN IF NOT EXISTS enterprise_id INT NULL REFERENCES enterprises(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_idempotency_key
  ON messages (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_messages_batch_recipient
  ON messages (batch_id, batch_recipient_id)
  WHERE batch_id IS NOT NULL;

ALTER TABLE whatsapp_batch_scheduled_sends
  ADD COLUMN IF NOT EXISTS send_mode VARCHAR(16) NOT NULL DEFAULT 'SCHEDULED';

ALTER TABLE whatsapp_batch_scheduled_send_recipients
  ADD COLUMN IF NOT EXISTS message_id INT NULL REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS meta_message_id VARCHAR(128) NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_messages_delivery_status'
      AND conrelid = 'messages'::regclass
  ) THEN
    ALTER TABLE messages
      ADD CONSTRAINT chk_messages_delivery_status
      CHECK (delivery_status IN ('pending', 'accepted', 'sent', 'delivered', 'read', 'failed'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'chk_whatsapp_batch_send_mode'
      AND conrelid = 'whatsapp_batch_scheduled_sends'::regclass
  ) THEN
    ALTER TABLE whatsapp_batch_scheduled_sends
      ADD CONSTRAINT chk_whatsapp_batch_send_mode
      CHECK (send_mode IN ('IMMEDIATE', 'SCHEDULED'));
  END IF;
END $$;

COMMENT ON COLUMN messages.template_json IS
  'Snapshot canonico do template: nome/id/idioma/categoria/body/parametros/header/botoes.';
COMMENT ON COLUMN messages.attachment_json IS
  'Metadados seguros; bytes de template permanecem em whatsapp_template_media_settings.';
COMMENT ON COLUMN messages.idempotency_key IS
  'Identidade estavel do envio; para lote usa whatsapp-batch-recipient:<recipient_id>.';
