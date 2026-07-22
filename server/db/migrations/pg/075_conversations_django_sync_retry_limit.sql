-- ════════════════════════════════════════════════════════════════════
-- LIMITE DE TENTATIVAS + DEAD-LETTER para o outbox NETIV → Django
--
-- Problema: djangoSyncWorker.ts reenviava um lead a cada 10s PARA SEMPRE
-- quando o Django rejeitava (422 sem mapeamento, 5xx, timeout, etc).
-- Isso gerava flood de requisições/logs e podia travar leads novos atrás
-- na fila (head-of-line blocking), já que o SELECT sempre pega os 50
-- mais antigos pendentes.
--
-- Solução: contar tentativas por lead. Ao atingir o limite, marcar como
-- "dead letter" (django_sync_dead_letter = TRUE) e excluir do SELECT de
-- pendentes. Sem esse lead no lote, o worker passa a processar os
-- próximos da fila normalmente.
-- ════════════════════════════════════════════════════════════════════

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS django_sync_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS django_sync_last_attempt_at TIMESTAMPTZ NULL,
  ADD COLUMN IF NOT EXISTS django_sync_last_error TEXT NULL,
  ADD COLUMN IF NOT EXISTS django_sync_dead_letter BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN conversations.django_sync_attempts IS
  'Quantas vezes o worker tentou enviar este lead ao Django sem sucesso desde o último reset/sync.';
COMMENT ON COLUMN conversations.django_sync_last_error IS
  'Última mensagem de erro (status HTTP ou exceção) recebida ao tentar sincronizar.';
COMMENT ON COLUMN conversations.django_sync_dead_letter IS
  'TRUE = excedeu o limite de tentativas. Parou de ser reenviado automaticamente. '
  'Reset manual necessário (ver server/scripts/resurrectDeadLetterLead.ts) após corrigir o mapeamento no Django.';

-- Recria o índice parcial incluindo a exclusão de dead-letter.
DROP INDEX IF EXISTS idx_conversations_pending_django_sync;
CREATE INDEX IF NOT EXISTS idx_conversations_pending_django_sync
  ON conversations (id)
  WHERE enterprise_id IS NOT NULL
    AND django_sync_dead_letter = FALSE
    AND (
      synced_to_django_at IS NULL
      OR synced_to_django_enterprise_id IS DISTINCT FROM enterprise_id
    );
