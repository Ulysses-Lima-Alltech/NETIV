-- Autenticação web por username, troca obrigatória de senha e escopo explícito.
-- A transação é controlada pelo executor de migrations.

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS username VARCHAR(120);
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE app_users ALTER COLUMN email DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_app_users_username_lower
  ON app_users (LOWER(username))
  WHERE username IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'app_users_username_format_check'
  ) THEN
    ALTER TABLE app_users ADD CONSTRAINT app_users_username_format_check CHECK (
      username IS NULL OR (
        username = LOWER(BTRIM(username))
        AND username !~ '[[:space:]]'
        AND username ~ '^[a-z0-9._-]+$'
      )
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS app_user_management (
  collaborator_user_id INT PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
  manager_user_id INT NOT NULL REFERENCES app_users(id) ON DELETE RESTRICT,
  created_by_user_id INT REFERENCES app_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT app_user_management_distinct_users CHECK (manager_user_id <> collaborator_user_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_management_manager
  ON app_user_management(manager_user_id);

CREATE TABLE IF NOT EXISTS app_user_enterprises (
  user_id INT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  enterprise_id INT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  assigned_by_user_id INT REFERENCES app_users(id) ON DELETE SET NULL,
  assignment_source VARCHAR(24) NOT NULL DEFAULT 'ADMIN_DIRECT'
    CHECK (assignment_source IN ('ADMIN_DIRECT', 'MANAGER', 'LEGACY')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, enterprise_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_enterprises_enterprise
  ON app_user_enterprises(enterprise_id);

CREATE TABLE IF NOT EXISTS app_user_brokers (
  user_id INT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  broker_id INT NOT NULL REFERENCES corretores(id) ON DELETE CASCADE,
  assigned_by_user_id INT REFERENCES app_users(id) ON DELETE SET NULL,
  assignment_source VARCHAR(24) NOT NULL DEFAULT 'ADMIN_DIRECT'
    CHECK (assignment_source IN ('ADMIN_DIRECT', 'MANAGER', 'LEGACY')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, broker_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_brokers_broker
  ON app_user_brokers(broker_id);

CREATE TABLE IF NOT EXISTS app_user_conversations (
  user_id INT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  conversation_id INT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  assigned_by_user_id INT REFERENCES app_users(id) ON DELETE SET NULL,
  assignment_source VARCHAR(24) NOT NULL DEFAULT 'ADMIN_DIRECT'
    CHECK (assignment_source IN ('ADMIN_DIRECT', 'MANAGER', 'LEGACY')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_conversations_conversation
  ON app_user_conversations(conversation_id);

CREATE TABLE IF NOT EXISTS app_user_contacts (
  user_id INT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  contact_id BIGINT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  assigned_by_user_id INT REFERENCES app_users(id) ON DELETE SET NULL,
  assignment_source VARCHAR(24) NOT NULL DEFAULT 'ADMIN_DIRECT'
    CHECK (assignment_source IN ('ADMIN_DIRECT', 'MANAGER', 'LEGACY')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_contacts_contact_user
  ON app_user_contacts(contact_id, user_id);

CREATE TABLE IF NOT EXISTS app_user_appointments (
  user_id INT NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
  appointment_id INT NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  assigned_by_user_id INT REFERENCES app_users(id) ON DELETE SET NULL,
  assignment_source VARCHAR(24) NOT NULL DEFAULT 'ADMIN_DIRECT'
    CHECK (assignment_source IN ('ADMIN_DIRECT', 'MANAGER', 'LEGACY')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, appointment_id)
);

CREATE INDEX IF NOT EXISTS idx_app_user_appointments_appointment_user
  ON app_user_appointments(appointment_id, user_id);

CREATE TABLE IF NOT EXISTS app_access_audit (
  id BIGSERIAL PRIMARY KEY,
  actor_user_id INT REFERENCES app_users(id) ON DELETE SET NULL,
  target_user_id INT REFERENCES app_users(id) ON DELETE SET NULL,
  action VARCHAR(80) NOT NULL,
  resource_type VARCHAR(80),
  resource_id VARCHAR(160),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_access_audit_target_created
  ON app_access_audit(target_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_access_audit_actor_created
  ON app_access_audit(actor_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS app_sso_token_uses (
  jti VARCHAR(160) PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_app_sso_token_uses_expires
  ON app_sso_token_uses(expires_at);

-- Compatibilidade: transforma o vínculo legado em uma atribuição explícita, sem removê-lo.
INSERT INTO app_user_brokers (user_id, broker_id, assigned_by_user_id, assignment_source)
SELECT id, broker_id, NULL, 'LEGACY'
FROM app_users
WHERE broker_id IS NOT NULL
ON CONFLICT (user_id, broker_id) DO NOTHING;
