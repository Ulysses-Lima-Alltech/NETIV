-- Origem do lead vs empreendimento ativo: histórico de campanha e contexto atual da ANA.

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS enterprise_origin_id INT REFERENCES enterprises(id) ON DELETE SET NULL;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS lead_source_raw JSONB;

CREATE INDEX IF NOT EXISTS idx_conversations_enterprise_origin ON conversations(enterprise_origin_id);

-- Mapeamento explícito e estável: chave → empreendimento (cadastro manual / SQL / futura UI).
CREATE TABLE IF NOT EXISTS lead_source_enterprise_map (
  id SERIAL PRIMARY KEY,
  source_key VARCHAR(256) NOT NULL,
  enterprise_id INT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_lead_source_key UNIQUE (source_key)
);

CREATE INDEX IF NOT EXISTS idx_lead_source_map_enterprise ON lead_source_enterprise_map(enterprise_id);

-- Chaves sugeridas (minúsculas após normalização no código):
--   meta:referral:source_id:<source_id da Meta>
--   meta:referral:ctwa_clid:<ctwa_clid>
--   ou qualquer chave custom (ex.: campanha interna), cadastrada manualmente:
-- INSERT INTO lead_source_enterprise_map (source_key, enterprise_id) VALUES ('minha_campanha_evora', 1);
