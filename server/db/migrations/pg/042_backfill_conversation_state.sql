-- Backfill do estado canônico a partir de conversations.commercial_flow_state.
-- Mantém commercial_flow_state por compatibilidade.

INSERT INTO conversation_state (
  conversation_id,
  state_schema_version,
  commercial_state_json,
  memory_state_json,
  retrieval_state_json,
  policy_state_json,
  created_at,
  updated_at
)
SELECT
  c.id,
  1,
  CASE
    WHEN c.commercial_flow_state IS NOT NULL AND jsonb_typeof(c.commercial_flow_state) = 'object'
      THEN c.commercial_flow_state
    ELSE '{}'::jsonb
  END,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  COALESCE(c.created_at, NOW()),
  COALESCE(c.updated_at, NOW())
FROM conversations c
ON CONFLICT (conversation_id) DO UPDATE
SET commercial_state_json = CASE
      WHEN (conversation_state.commercial_state_json = '{}'::jsonb OR conversation_state.commercial_state_json IS NULL)
           AND EXCLUDED.commercial_state_json <> '{}'::jsonb
        THEN EXCLUDED.commercial_state_json
      ELSE conversation_state.commercial_state_json
    END,
    updated_at = GREATEST(conversation_state.updated_at, EXCLUDED.updated_at);
