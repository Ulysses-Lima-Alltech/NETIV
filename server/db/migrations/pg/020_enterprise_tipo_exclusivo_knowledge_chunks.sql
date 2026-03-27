-- Tipo comercial do empreendimento e flag exclusivo
ALTER TABLE enterprises
  ADD COLUMN IF NOT EXISTS tipo VARCHAR(20) NOT NULL DEFAULT 'APARTAMENTO'
    CHECK (tipo IN ('LOTEAMENTO', 'APARTAMENTO', 'MCMV')),
  ADD COLUMN IF NOT EXISTS exclusivo BOOLEAN NOT NULL DEFAULT false;

-- Chunks de conhecimento (book/documentos) para contexto da Ana
CREATE TABLE IF NOT EXISTS enterprise_knowledge_chunks (
  id SERIAL PRIMARY KEY,
  enterprise_id INT NOT NULL REFERENCES enterprises(id) ON DELETE CASCADE,
  enterprise_file_id INT NOT NULL REFERENCES enterprise_files(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (enterprise_file_id, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_ek_chunks_enterprise ON enterprise_knowledge_chunks(enterprise_id);
