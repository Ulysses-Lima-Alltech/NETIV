-- ════════════════════════════════════════════════════════════════════
-- OUTBOX para sincronização NETIV → Django (qmape-netiv-sync)
--
-- Padrão: transactional outbox embutido na própria tabela conversations.
-- O worker `djangoSyncWorker.ts` faz polling a cada 10s e processa
-- conversas com enterprise_id preenchido que ainda não foram enviadas
-- (ou cujo enterprise_id mudou desde o último envio).
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS synced_to_django_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS synced_to_django_enterprise_id INT NULL;

COMMENT ON COLUMN conversations.synced_to_django_at IS
  'Quando o lead foi enviado com sucesso ao webhook do Django. NULL = pendente.';
COMMENT ON COLUMN conversations.synced_to_django_enterprise_id IS
  'Qual enterprise_id estava sincronizado no último envio bem-sucedido. '
  'Se diferente do enterprise_id atual, o worker reenvia.';

-- Índice parcial: só linhas pendentes ficam indexadas (super leve).
-- Linha "pendente" = tem empreendimento E (nunca foi enviada OU mudou).
CREATE INDEX IF NOT EXISTS idx_conversations_pending_django_sync
  ON conversations (id)
  WHERE enterprise_id IS NOT NULL
    AND (
      synced_to_django_at IS NULL
      OR synced_to_django_enterprise_id IS DISTINCT FROM enterprise_id
    );

-- BACKFILL: marca tudo que já existe como "já sincronizado".
-- A partir do deploy, só leads NOVOS ou com enterprise_id alterado
-- caem no loop. Evita rajada de envio na 1ª execução.
UPDATE conversations
   SET synced_to_django_at = NOW(),
       synced_to_django_enterprise_id = enterprise_id
 WHERE enterprise_id IS NOT NULL
   AND synced_to_django_at IS NULL;
