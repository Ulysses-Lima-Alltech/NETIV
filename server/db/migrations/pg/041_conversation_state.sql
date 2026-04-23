-- Estado canônico por conversa (tabela separada).
-- Não remove e não altera conversations.commercial_flow_state.

CREATE TABLE IF NOT EXISTS conversation_state (
  conversation_id INT PRIMARY KEY
);

ALTER TABLE conversation_state
  ADD COLUMN IF NOT EXISTS state_schema_version INT,
  ADD COLUMN IF NOT EXISTS commercial_state_json JSONB,
  ADD COLUMN IF NOT EXISTS memory_state_json JSONB,
  ADD COLUMN IF NOT EXISTS retrieval_state_json JSONB,
  ADD COLUMN IF NOT EXISTS policy_state_json JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;

UPDATE conversation_state
SET
  state_schema_version = GREATEST(COALESCE(state_schema_version, 1), 1),
  commercial_state_json = CASE
    WHEN commercial_state_json IS NULL OR jsonb_typeof(commercial_state_json) <> 'object' THEN '{}'::jsonb
    ELSE commercial_state_json
  END,
  memory_state_json = CASE
    WHEN memory_state_json IS NULL OR jsonb_typeof(memory_state_json) <> 'object' THEN '{}'::jsonb
    ELSE memory_state_json
  END,
  retrieval_state_json = CASE
    WHEN retrieval_state_json IS NULL OR jsonb_typeof(retrieval_state_json) <> 'object' THEN '{}'::jsonb
    ELSE retrieval_state_json
  END,
  policy_state_json = CASE
    WHEN policy_state_json IS NULL OR jsonb_typeof(policy_state_json) <> 'object' THEN '{}'::jsonb
    ELSE policy_state_json
  END,
  created_at = COALESCE(created_at, NOW()),
  updated_at = COALESCE(updated_at, NOW())
WHERE state_schema_version IS NULL
   OR state_schema_version < 1
   OR commercial_state_json IS NULL
   OR memory_state_json IS NULL
   OR retrieval_state_json IS NULL
   OR policy_state_json IS NULL
   OR created_at IS NULL
   OR updated_at IS NULL
   OR jsonb_typeof(commercial_state_json) <> 'object'
   OR jsonb_typeof(memory_state_json) <> 'object'
   OR jsonb_typeof(retrieval_state_json) <> 'object'
   OR jsonb_typeof(policy_state_json) <> 'object';

ALTER TABLE conversation_state
  ALTER COLUMN state_schema_version SET DEFAULT 1,
  ALTER COLUMN state_schema_version SET NOT NULL,
  ALTER COLUMN commercial_state_json SET DEFAULT '{}'::jsonb,
  ALTER COLUMN commercial_state_json SET NOT NULL,
  ALTER COLUMN memory_state_json SET DEFAULT '{}'::jsonb,
  ALTER COLUMN memory_state_json SET NOT NULL,
  ALTER COLUMN retrieval_state_json SET DEFAULT '{}'::jsonb,
  ALTER COLUMN retrieval_state_json SET NOT NULL,
  ALTER COLUMN policy_state_json SET DEFAULT '{}'::jsonb,
  ALTER COLUMN policy_state_json SET NOT NULL,
  ALTER COLUMN created_at SET DEFAULT NOW(),
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET DEFAULT NOW(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_conversation_state_conversation') THEN
    ALTER TABLE conversation_state
      ADD CONSTRAINT fk_conversation_state_conversation
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversation_state_schema_version') THEN
    ALTER TABLE conversation_state
      ADD CONSTRAINT chk_conversation_state_schema_version
      CHECK (state_schema_version >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversation_state_commercial_json_obj') THEN
    ALTER TABLE conversation_state
      ADD CONSTRAINT chk_conversation_state_commercial_json_obj
      CHECK (jsonb_typeof(commercial_state_json) = 'object');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversation_state_memory_json_obj') THEN
    ALTER TABLE conversation_state
      ADD CONSTRAINT chk_conversation_state_memory_json_obj
      CHECK (jsonb_typeof(memory_state_json) = 'object');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversation_state_retrieval_json_obj') THEN
    ALTER TABLE conversation_state
      ADD CONSTRAINT chk_conversation_state_retrieval_json_obj
      CHECK (jsonb_typeof(retrieval_state_json) = 'object');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_conversation_state_policy_json_obj') THEN
    ALTER TABLE conversation_state
      ADD CONSTRAINT chk_conversation_state_policy_json_obj
      CHECK (jsonb_typeof(policy_state_json) = 'object');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION trg_conversation_state_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := COALESCE(NEW.created_at, NOW());
    NEW.updated_at := COALESCE(NEW.updated_at, NEW.created_at);
  ELSE
    NEW.updated_at := NOW();
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger
    WHERE tgname = 'trg_conversation_state_touch_updated_at'
      AND tgrelid = 'conversation_state'::regclass
  ) THEN
    CREATE TRIGGER trg_conversation_state_touch_updated_at
      BEFORE INSERT OR UPDATE
      ON conversation_state
      FOR EACH ROW
      EXECUTE FUNCTION trg_conversation_state_touch_updated_at();
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversation_state_updated_at
  ON conversation_state (updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversation_state_commercial_gin
  ON conversation_state
  USING GIN (commercial_state_json jsonb_path_ops);
