ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS pending_resolution_choice BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pending_resolution_reason TEXT NULL,
  ADD COLUMN IF NOT EXISTS pending_resolution_intent TEXT NULL,
  ADD COLUMN IF NOT EXISTS pending_resolution_created_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS pending_resolution_payload JSONB NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_pending_resolution_choice
  ON conversations (pending_resolution_choice)
  WHERE pending_resolution_choice = true;
