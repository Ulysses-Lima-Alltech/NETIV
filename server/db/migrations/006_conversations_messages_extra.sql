-- Conversations: add last_message_at.
ALTER TABLE conversations ADD COLUMN last_message_at TEXT;
UPDATE conversations SET last_message_at = updated_at WHERE last_message_at IS NULL;

-- Messages: add type, content, error_message, sent_at, delivered_at, read_at, updated_at.
ALTER TABLE messages ADD COLUMN type TEXT NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN content TEXT;
UPDATE messages SET content = body_text WHERE content IS NULL;
ALTER TABLE messages ADD COLUMN error_message TEXT;
ALTER TABLE messages ADD COLUMN sent_at TEXT;
ALTER TABLE messages ADD COLUMN delivered_at TEXT;
ALTER TABLE messages ADD COLUMN read_at TEXT;
ALTER TABLE messages ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE messages SET updated_at = datetime('now') WHERE updated_at = '';
