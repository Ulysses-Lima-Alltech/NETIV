-- 050_app_users_team_scope.sql
-- Adiciona escopo por equipe (vindo do SSO QMAPE) na tabela de usuários.
--
-- Estratégia: TODAS as colunas têm default seguro que preserva o comportamento antigo.
--   - scope_kind = 'all'           → quem é criado HOJE continua "vendo tudo"
--   - allowed_enterprise_ids = '{}' → array vazio, mas não é usado enquanto a flag estiver desligada
--
-- O default só passa a importar quando TEAM_SCOPE_ENFORCED=true.

ALTER TABLE app_users
  ADD COLUMN qmape_company_id        INTEGER,
  ADD COLUMN qmape_company_name      VARCHAR(255),
  ADD COLUMN qmape_central_id        INTEGER,
  ADD COLUMN scope_kind              VARCHAR(20) NOT NULL DEFAULT 'all'
    CHECK (scope_kind IN ('all', 'company')),
  ADD COLUMN allowed_enterprise_ids  INTEGER[]   NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_app_users_qmape_company
  ON app_users(qmape_company_id);
