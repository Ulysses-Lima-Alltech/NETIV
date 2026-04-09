-- Mapeamento entre usuários do Netiv e corretores/brokers do Django
-- Adiciona campos para vincular app_users com corretores e usuários Django

ALTER TABLE app_users ADD COLUMN IF NOT EXISTS broker_id INT REFERENCES corretores(id) ON DELETE SET NULL;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS django_user_id INT;

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_app_users_broker_id ON app_users(broker_id) WHERE broker_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_app_users_django_user_id ON app_users(django_user_id) WHERE django_user_id IS NOT NULL;
