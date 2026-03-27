-- Estado comercial da conversa (etapa, última listagem, inferência de foco) — usado para continuidade em mensagens curtas.
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS commercial_flow_state JSONB NOT NULL DEFAULT '{}'::jsonb;
