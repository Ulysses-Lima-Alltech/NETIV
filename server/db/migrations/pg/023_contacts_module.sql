CREATE TABLE IF NOT EXISTS contacts (
  id BIGSERIAL PRIMARY KEY,
  full_name TEXT,
  first_name TEXT,
  phone_e164 VARCHAR(32) NOT NULL UNIQUE,
  phone_display VARCHAR(64),
  email TEXT,
  enterprise_interest TEXT,
  notes TEXT,
  source VARCHAR(32) NOT NULL DEFAULT 'manual',
  owner_user_id INT NULL REFERENCES corretores(id) ON DELETE SET NULL,
  owner_assigned_at TIMESTAMPTZ,
  owner_assignment_source VARCHAR(64),
  owner_assigned_by_user_id INT NULL REFERENCES app_users(id) ON DELETE SET NULL,
  last_contact_at TIMESTAMPTZ,
  last_inbound_at TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_contacts_owner_user_id ON contacts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_contacts_last_contact_at ON contacts(last_contact_at DESC NULLS LAST);

CREATE TABLE IF NOT EXISTS contact_import_batches (
  id BIGSERIAL PRIMARY KEY,
  uploaded_by_user_id INT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  owner_user_id INT NULL REFERENCES corretores(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'previewed',
  total_rows INT NOT NULL DEFAULT 0,
  valid_rows INT NOT NULL DEFAULT 0,
  invalid_rows INT NOT NULL DEFAULT 0,
  created_contacts INT NOT NULL DEFAULT 0,
  updated_contacts INT NOT NULL DEFAULT 0,
  claimed_unassigned_contacts INT NOT NULL DEFAULT 0,
  skipped_owned_contacts INT NOT NULL DEFAULT 0,
  duplicate_rows INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS contact_import_rows (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES contact_import_batches(id) ON DELETE CASCADE,
  row_number INT NOT NULL,
  raw_payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  normalized_phone_e164 VARCHAR(32),
  contact_id BIGINT NULL REFERENCES contacts(id) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_import_rows_batch ON contact_import_rows(batch_id, row_number);
CREATE INDEX IF NOT EXISTS idx_contact_import_rows_contact ON contact_import_rows(contact_id);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS contact_id BIGINT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_contact_id_fkey'
  ) THEN
    ALTER TABLE conversations
      ADD CONSTRAINT conversations_contact_id_fkey
      FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_contact_id ON conversations(contact_id);
