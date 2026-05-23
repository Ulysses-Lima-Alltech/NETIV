ALTER TABLE mobile_users
  ADD COLUMN IF NOT EXISTS corretor_id INT NULL REFERENCES corretores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mobile_users_corretor_id
  ON mobile_users(corretor_id)
  WHERE corretor_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_users_corretor_id_unique
  ON mobile_users(corretor_id)
  WHERE corretor_id IS NOT NULL;
