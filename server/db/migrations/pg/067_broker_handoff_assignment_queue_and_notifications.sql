CREATE TABLE IF NOT EXISTS broker_assignment_queue_state (
  id BIGSERIAL PRIMARY KEY,
  enterprise_id BIGINT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  last_assigned_broker_id BIGINT NULL REFERENCES corretores(id) ON DELETE SET NULL,
  last_assigned_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (enterprise_id)
);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assigned_broker_id INT NULL REFERENCES corretores(id) ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS assigned_broker_at TIMESTAMPTZ NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS handoff_reason TEXT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS handoff_requested_at TIMESTAMPTZ NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS broker_notified_at TIMESTAMPTZ NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS broker_notification_status TEXT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS broker_notification_error TEXT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS broker_notification_template TEXT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS broker_push_notified_at TIMESTAMPTZ NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS broker_push_notification_status TEXT NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS broker_push_notification_error TEXT NULL;

CREATE TABLE IF NOT EXISTS mobile_user_device_tokens (
  id BIGSERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES mobile_users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  platform TEXT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_user_device_tokens_user_active
  ON mobile_user_device_tokens (user_id, active);

