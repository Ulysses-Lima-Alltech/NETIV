ALTER TABLE whatsapp_batch_scheduled_sends
  ADD COLUMN IF NOT EXISTS event_name TEXT,
  ADD COLUMN IF NOT EXISTS event_request_id UUID,
  ADD COLUMN IF NOT EXISTS event_fingerprint TEXT,
  ADD COLUMN IF NOT EXISTS event_send_mode TEXT,
  ADD COLUMN IF NOT EXISTS event_art_bytes BYTEA,
  ADD COLUMN IF NOT EXISTS event_art_mime_type TEXT,
  ADD COLUMN IF NOT EXISTS event_art_filename TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_dispatch_event_request
  ON whatsapp_batch_scheduled_sends (event_request_id)
  WHERE event_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_dispatch_events_schedule
  ON whatsapp_batch_scheduled_sends (scheduled_at, id)
  WHERE event_name IS NOT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS is_event_lead BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE whatsapp_batch_scheduled_send_recipients
  ADD COLUMN IF NOT EXISTS customer_name TEXT;

COMMENT ON COLUMN conversations.is_event_lead IS
  'Lead de disparo pelo modal da Agenda. Exibido no Inbox interno e nunca sincronizado ao Django.';

DROP INDEX IF EXISTS idx_conversations_pending_django_sync;
CREATE INDEX IF NOT EXISTS idx_conversations_pending_django_sync
  ON conversations (id)
  WHERE enterprise_id IS NOT NULL
    AND django_sync_dead_letter = FALSE
    AND is_event_lead = FALSE
    AND (
      synced_to_django_at IS NULL
      OR synced_to_django_enterprise_id IS DISTINCT FROM enterprise_id
    );

CREATE INDEX IF NOT EXISTS idx_conversations_event_leads
  ON conversations (last_message_at DESC, id DESC)
  WHERE is_event_lead = TRUE;
