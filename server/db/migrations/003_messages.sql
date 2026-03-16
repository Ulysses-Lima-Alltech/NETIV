-- Messages: stores all inbound/outbound messages for conversations.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  meta_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'sent',
  body_text TEXT,
  raw_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_meta_message_id ON messages(meta_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
