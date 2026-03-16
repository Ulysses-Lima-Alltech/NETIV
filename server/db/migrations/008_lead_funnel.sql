-- Lead classification: colunas em conversations.
ALTER TABLE conversations ADD COLUMN lead_stage TEXT NOT NULL DEFAULT 'COLD';
ALTER TABLE conversations ADD COLUMN lead_score REAL NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN lead_intent_now TEXT NOT NULL DEFAULT 'LOW';
ALTER TABLE conversations ADD COLUMN lead_reason TEXT;
ALTER TABLE conversations ADD COLUMN lead_last_analyzed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_conversations_lead_stage ON conversations(lead_stage);
