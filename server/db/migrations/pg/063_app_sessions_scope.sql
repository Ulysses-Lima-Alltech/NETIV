-- Migration 063: Adicionar colunas de escopo de carteira à tabela app_sessions
-- Isso permite que operadores vejam apenas as conversas da sua carteira

ALTER TABLE app_sessions
  ADD COLUMN scope_kind TEXT NULL,
  ADD COLUMN scope_conv_ids BIGINT[] NULL,
  ADD COLUMN scope_total_size INT NULL;

-- Índices para performance de queries com escopo
CREATE INDEX idx_app_sessions_scope_kind ON app_sessions(scope_kind) WHERE scope_kind IS NOT NULL;
CREATE INDEX idx_app_sessions_scope_conv_ids ON app_sessions USING GIN(scope_conv_ids) WHERE scope_conv_ids IS NOT NULL;

-- Comentário para documentação
COMMENT ON COLUMN app_sessions.scope_kind IS 'Tipo de escopo da sessão (ex: broker_portfolio). NULL = sem restrição (vê tudo)';
COMMENT ON COLUMN app_sessions.scope_conv_ids IS 'Array de IDs de conversa permitidos para esta sessão. Usado com scope_kind=broker_portfolio';
COMMENT ON COLUMN app_sessions.scope_total_size IS 'Tamanho total da carteira (para banner "Mostrando X de Y"). Usado com scope_kind=broker_portfolio';
