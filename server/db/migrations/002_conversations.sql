-- Conversations: one per contact/channel (e.g. WhatsApp number).
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  external_id TEXT NOT NULL,
  contact_phone TEXT,
  contact_name TEXT,
  meta_phone_number_id TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel, external_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_channel_external ON conversations(channel, external_id);
CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
