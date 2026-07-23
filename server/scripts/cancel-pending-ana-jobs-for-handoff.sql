-- Cancel pending Ana automation for conversations already in persisted Handoff.
UPDATE conversations
   SET reengagement_sent_at = NULL,
       reengagement_for_user_message_id = NULL,
       reengagement_count = 0,
       ana_followup_anchor_assistant_message_id = NULL,
       ana_followup_anchor_assistant_created_at = NULL,
       ana_followup_for_user_message_id = NULL,
       ana_followup_attempt_count = 0,
       ana_followup_last_attempt_at = NULL,
       ana_followup_last_sent_message_id = NULL,
       ana_followup_next_at = NULL,
       ana_followup_status = 'cancelled',
       ana_followup_cancel_reason = 'handoff',
       pending_resolution_choice = false,
       pending_resolution_reason = NULL,
       pending_resolution_intent = NULL,
       pending_resolution_created_at = NULL,
       pending_resolution_payload = NULL,
       handoff_deferred_until = NULL,
       handoff_deferred_broker_id = NULL,
       updated_at = NOW()
 WHERE COALESCE(handoff, false) = true
    OR lower(trim(COALESCE(classification, ''))) = 'handoff';

UPDATE ana_retry_jobs j
   SET status = 'failed_non_retryable',
       reason = 'handoff',
       last_error = 'handoff',
       last_error_code = 'handoff',
       locked_at = NULL,
       locked_by = NULL,
       updated_at = NOW()
  FROM conversations c
 WHERE j.conversation_id = c.id
   AND j.status IN ('pending', 'processing')
   AND (
     COALESCE(c.handoff, false) = true
     OR lower(trim(COALESCE(c.classification, ''))) = 'handoff'
   );

UPDATE ana_visit_followup_jobs j
   SET status = 'cancelled',
       cancel_reason = 'handoff',
       completed_at = NOW(),
       locked_at = NULL,
       locked_by = NULL,
       updated_at = NOW()
  FROM conversations c
 WHERE j.conversation_id = c.id
   AND j.status IN ('active', 'processing')
   AND (
     COALESCE(c.handoff, false) = true
     OR lower(trim(COALESCE(c.classification, ''))) = 'handoff'
   );
