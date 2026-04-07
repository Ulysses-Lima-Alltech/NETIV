ALTER TABLE enterprise_knowledge_chunks
  ADD COLUMN IF NOT EXISTS knowledge_block VARCHAR(32) NOT NULL DEFAULT 'facts',
  ADD COLUMN IF NOT EXISTS block_priority SMALLINT NOT NULL DEFAULT 50,
  ADD COLUMN IF NOT EXISTS city_hint VARCHAR(120) NULL,
  ADD COLUMN IF NOT EXISTS enterprise_hint VARCHAR(180) NULL,
  ADD COLUMN IF NOT EXISTS intent_tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS temporal_status VARCHAR(24) NOT NULL DEFAULT 'atemporal',
  ADD COLUMN IF NOT EXISTS source_confidence SMALLINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ekc_knowledge_block'
  ) THEN
    ALTER TABLE enterprise_knowledge_chunks
      ADD CONSTRAINT chk_ekc_knowledge_block
      CHECK (knowledge_block IN ('facts', 'commercial_intent', 'variable_data', 'ana_rules'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'chk_ekc_temporal_status'
  ) THEN
    ALTER TABLE enterprise_knowledge_chunks
      ADD CONSTRAINT chk_ekc_temporal_status
      CHECK (temporal_status IN ('atemporal', 'current', 'time_sensitive', 'expired'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ek_chunks_enterprise_block
  ON enterprise_knowledge_chunks(enterprise_id, knowledge_block, chunk_index);

CREATE INDEX IF NOT EXISTS idx_ek_chunks_city_hint
  ON enterprise_knowledge_chunks(enterprise_id, city_hint);
