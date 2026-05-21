-- Add email column to corretores table to support broker matching by email
ALTER TABLE corretores ADD COLUMN IF NOT EXISTS email VARCHAR(255);
CREATE INDEX IF NOT EXISTS idx_corretores_email ON corretores(LOWER(email)) WHERE email IS NOT NULL;
