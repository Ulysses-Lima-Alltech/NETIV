ALTER TABLE ana_unclassified_lead_settings
  ADD COLUMN IF NOT EXISTS follow_up_message TEXT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname = 'ana_unclassified_lead_followup_message_length'
  ) THEN
    ALTER TABLE ana_unclassified_lead_settings
      ADD CONSTRAINT ana_unclassified_lead_followup_message_length
      CHECK (follow_up_message IS NULL OR char_length(follow_up_message) <= 2000);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ana_unclassified_lead_followup_campaigns (
  id BIGSERIAL PRIMARY KEY,
  request_id UUID NOT NULL UNIQUE,
  template_key TEXT NOT NULL,
  follow_up_message TEXT NOT NULL,
  preview_fingerprint TEXT NOT NULL,
  consent_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'SENDING',
  total_recipients INT NOT NULL DEFAULT 0,
  sent_recipients INT NOT NULL DEFAULT 0,
  failed_recipients INT NOT NULL DEFAULT 0,
  skipped_recipients INT NOT NULL DEFAULT 0,
  created_by INT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ NULL,
  CONSTRAINT ana_unclassified_lead_followup_campaign_status
    CHECK (status IN ('SENDING', 'COMPLETED', 'PARTIAL_FAILED'))
);

CREATE TABLE IF NOT EXISTS ana_unclassified_lead_followup_recipients (
  id BIGSERIAL PRIMARY KEY,
  campaign_id BIGINT NOT NULL
    REFERENCES ana_unclassified_lead_followup_campaigns(id) ON DELETE CASCADE,
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  last_user_message_at TIMESTAMPTZ NOT NULL,
  planned_channel TEXT NOT NULL CHECK (planned_channel IN ('SERVICE_TEXT', 'MARKETING_TEMPLATE')),
  status TEXT NOT NULL DEFAULT 'PENDING',
  meta_message_id TEXT NULL,
  error_message TEXT NULL,
  sent_at TIMESTAMPTZ NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ana_unclassified_lead_followup_recipient_status
    CHECK (status IN ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'SKIPPED')),
  CONSTRAINT ana_unclassified_lead_followup_recipient_once
    UNIQUE (campaign_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_ana_unclassified_followup_recipients_status
  ON ana_unclassified_lead_followup_recipients (campaign_id, status);
