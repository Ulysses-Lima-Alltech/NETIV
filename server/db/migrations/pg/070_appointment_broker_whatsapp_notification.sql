ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS appointment_broker_notified_at TIMESTAMPTZ NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS appointment_broker_notification_status TEXT NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS appointment_broker_notification_error TEXT NULL;

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS appointment_broker_notification_template TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_appointments_broker_notification_status
  ON appointments (appointment_broker_notification_status);
