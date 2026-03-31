-- Suporte a storage externo (Cloudflare R2 / S3-compatible) para arquivos de empreendimento.
-- Substitui a dependência do filesystem efêmero local para novos uploads.
-- Registros legados (storage_provider IS NULL) continuam funcionando via storage_path + file_data.

ALTER TABLE enterprise_files
  ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(20),
  ADD COLUMN IF NOT EXISTS storage_key      TEXT,
  ADD COLUMN IF NOT EXISTS bucket_name      TEXT,
  ADD COLUMN IF NOT EXISTS public_url       TEXT;

COMMENT ON COLUMN enterprise_files.storage_provider IS
  'Provedor de storage do arquivo: r2 | local | NULL (legado — tratado como local).';
COMMENT ON COLUMN enterprise_files.storage_key IS
  'Chave do objeto no bucket R2, ex.: empreendimentos/7/1735000000-abc123.pdf. NULL em registros legados.';
COMMENT ON COLUMN enterprise_files.bucket_name IS
  'Nome do bucket R2. NULL em registros legados.';
COMMENT ON COLUMN enterprise_files.public_url IS
  'URL pública do objeto, se o bucket for público ou usar custom domain. NULL se privado.';
