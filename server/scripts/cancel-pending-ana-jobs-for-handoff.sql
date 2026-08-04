-- Auditoria: mostra os jobs/estados automaticos da Ana ainda processaveis
-- para conversas atualmente em HANDOFF. Nao altera dados.
WITH handoff_conversations AS (
  SELECT id
  FROM conversations
  WHERE COALESCE(handoff, false) = true
     OR lower(trim(COALESCE(classification, ''))) = 'handoff'
),
retry_jobs AS (
  SELECT 'ana_retry_jobs' AS category, COUNT(*)::bigint AS pending_count
  FROM ana_retry_jobs j
  JOIN handoff_conversations c ON c.id = j.conversation_id
  WHERE j.status IN ('pending', 'processing')
),
visit_followup_jobs AS (
  SELECT 'ana_visit_followup_jobs' AS category, COUNT(*)::bigint AS pending_count
  FROM ana_visit_followup_jobs j
  JOIN handoff_conversations c ON c.id = j.conversation_id
  WHERE j.status IN ('active', 'processing')
),
general_followups AS (
  SELECT 'conversations.ana_followup' AS category, COUNT(*)::bigint AS pending_count
  FROM conversations c
  JOIN handoff_conversations h ON h.id = c.id
  WHERE c.ana_followup_status IN ('idle', 'active')
     OR c.ana_followup_next_at IS NOT NULL
)
SELECT * FROM retry_jobs
UNION ALL SELECT * FROM visit_followup_jobs
UNION ALL SELECT * FROM general_followups
ORDER BY category;

-- Limpeza idempotente: cancela/inutiliza apenas trabalho pendente/processavel.
-- Execute em transacao e rode a auditoria acima antes e depois.
BEGIN;

WITH handoff_conversations AS (
  SELECT id
  FROM conversations
  WHERE COALESCE(handoff, false) = true
     OR lower(trim(COALESCE(classification, ''))) = 'handoff'
),
cancel_retry AS (
  UPDATE ana_retry_jobs j
     SET status = 'failed_non_retryable',
         reason = 'handoff',
         last_error = 'handoff',
         last_error_code = 'handoff',
         locked_at = NULL,
         locked_by = NULL,
         updated_at = NOW()
  FROM handoff_conversations c
  WHERE c.id = j.conversation_id
    AND j.status IN ('pending', 'processing')
  RETURNING j.id
),
cancel_visit AS (
  UPDATE ana_visit_followup_jobs j
     SET status = 'cancelled',
         cancel_reason = 'handoff',
         completed_at = NOW(),
         locked_at = NULL,
         locked_by = NULL,
         updated_at = NOW()
  FROM handoff_conversations c
  WHERE c.id = j.conversation_id
    AND j.status IN ('active', 'processing')
  RETURNING j.id
),
cancel_general AS (
  UPDATE conversations c
     SET ana_followup_status = 'cancelled',
         ana_followup_next_at = NULL,
         ana_followup_cancel_reason = 'handoff',
         reengagement_for_user_message_id = NULL,
         updated_at = NOW()
  FROM handoff_conversations h
  WHERE h.id = c.id
    AND (
      c.ana_followup_status IN ('idle', 'active')
      OR c.ana_followup_next_at IS NOT NULL
    )
  RETURNING c.id
)
SELECT
  (SELECT COUNT(*) FROM cancel_retry) AS ana_retry_jobs_cancelled,
  (SELECT COUNT(*) FROM cancel_visit) AS ana_visit_followup_jobs_cancelled,
  (SELECT COUNT(*) FROM cancel_general) AS general_followups_cancelled;

COMMIT;
