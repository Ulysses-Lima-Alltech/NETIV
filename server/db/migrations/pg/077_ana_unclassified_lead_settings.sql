CREATE TABLE IF NOT EXISTS ana_unclassified_lead_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  initial_message TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ana_unclassified_lead_message_length
    CHECK (initial_message IS NULL OR char_length(initial_message) <= 2000)
);

INSERT INTO ana_unclassified_lead_settings (id, initial_message)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;
