-- Persistência dos bytes do arquivo de empreendimento no banco.
-- Resolve o problema de filesystem efêmero (Render, containers sem volume montado):
-- o arquivo físico pode sumir após restart/redeploy, mas os bytes ficam no PostgreSQL
-- e são restaurados automaticamente em disco no próximo pedido de envio.

ALTER TABLE enterprise_files
  ADD COLUMN IF NOT EXISTS file_data BYTEA;

COMMENT ON COLUMN enterprise_files.file_data IS
  'Bytes do arquivo físico. Permite restaurar em disco após restart/redeploy em environments com FS efêmero (ex: Render sem Persistent Disk). NULL em registros anteriores à migration 027.';
