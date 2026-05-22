CREATE TABLE IF NOT EXISTS mobile_users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(120) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name VARCHAR(255) NOT NULL,
  phone VARCHAR(32),
  role VARCHAR(16) NOT NULL CHECK (role IN ('CORRETOR', 'GESTOR', 'ADM')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mobile_users_active ON mobile_users(is_active) WHERE is_active = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_mobile_users_username_lower ON mobile_users(LOWER(username));

CREATE TABLE IF NOT EXISTS mobile_user_enterprises (
  id SERIAL PRIMARY KEY,
  user_id INT NOT NULL REFERENCES mobile_users(id) ON DELETE CASCADE,
  enterprise_id INT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  can_manage BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, enterprise_id)
);

CREATE INDEX IF NOT EXISTS idx_mobile_user_enterprises_user ON mobile_user_enterprises(user_id);
CREATE INDEX IF NOT EXISTS idx_mobile_user_enterprises_enterprise ON mobile_user_enterprises(enterprise_id);
