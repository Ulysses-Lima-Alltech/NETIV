UPDATE conversations
SET
  assigned_broker_id = NULL,
  assigned_broker_at = NULL,
  broker_notified_at = NULL,
  broker_notification_status = NULL,
  broker_notification_error = NULL,
  broker_notification_template = NULL,
  broker_push_notified_at = NULL,
  broker_push_notification_status = NULL,
  broker_push_notification_error = NULL,
  updated_at = NOW()
WHERE COALESCE(handoff, false) = false
  AND COALESCE(classification, '') <> 'Handoff';
