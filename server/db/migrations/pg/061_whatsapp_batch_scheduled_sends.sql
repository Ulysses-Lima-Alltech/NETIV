CREATE TABLE IF NOT EXISTS whatsapp_batch_scheduled_sends (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id INT NULL REFERENCES enterprises(id) ON DELETE SET NULL,
  template_key TEXT NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  conversation_type TEXT NOT NULL DEFAULT 'CLIENT',
  post_send_mode TEXT NOT NULL DEFAULT 'ANA',
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  created_by INT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ NULL,
  finished_at TIMESTAMPTZ NULL,
  error_message TEXT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_whatsapp_batch_scheduled_sends_conversation_type'
  ) THEN
    ALTER TABLE whatsapp_batch_scheduled_sends
      ADD CONSTRAINT chk_whatsapp_batch_scheduled_sends_conversation_type
      CHECK (conversation_type IN ('CLIENT', 'ADMIN'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_whatsapp_batch_scheduled_sends_post_send_mode'
  ) THEN
    ALTER TABLE whatsapp_batch_scheduled_sends
      ADD CONSTRAINT chk_whatsapp_batch_scheduled_sends_post_send_mode
      CHECK (post_send_mode IN ('ANA', 'HANDOFF'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_whatsapp_batch_scheduled_sends_status'
  ) THEN
    ALTER TABLE whatsapp_batch_scheduled_sends
      ADD CONSTRAINT chk_whatsapp_batch_scheduled_sends_status
      CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'PARTIAL_FAILED', 'FAILED', 'CANCELED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_batch_scheduled_sends_status_schedule
  ON whatsapp_batch_scheduled_sends (status, scheduled_at);

CREATE TABLE IF NOT EXISTS whatsapp_batch_scheduled_send_recipients (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES whatsapp_batch_scheduled_sends(id) ON DELETE CASCADE,
  row_number INT NOT NULL,
  phone TEXT NOT NULL,
  name TEXT NULL,
  variables_json JSONB NULL,
  assigned_broker_id INT NULL REFERENCES corretores(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  conversation_id INT NULL REFERENCES conversations(id) ON DELETE SET NULL,
  sent_at TIMESTAMPTZ NULL,
  error_message TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_whatsapp_batch_scheduled_send_recipients_status'
  ) THEN
    ALTER TABLE whatsapp_batch_scheduled_send_recipients
      ADD CONSTRAINT chk_whatsapp_batch_scheduled_send_recipients_status
      CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELED'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_whatsapp_batch_scheduled_send_recipients_batch_status
  ON whatsapp_batch_scheduled_send_recipients (batch_id, status);

