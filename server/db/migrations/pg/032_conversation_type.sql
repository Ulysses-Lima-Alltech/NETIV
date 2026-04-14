ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS conversation_type TEXT NOT NULL DEFAULT 'CLIENT';

UPDATE conversations
SET conversation_type = 'CLIENT'
WHERE conversation_type IS NULL OR trim(conversation_type) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_conversations_conversation_type'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT chk_conversations_conversation_type
      CHECK (conversation_type IN ('CLIENT', 'CORRETOR', 'ADMIN'));
  END IF;
END $$;
