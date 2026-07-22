// server/services/djangoSyncWorker.ts
//
// Worker do outbox: a cada tick (10s), busca conversas pendentes de envio
// ao Django (qmape-netiv-sync), envia e carimba o sucesso.
//
// PADRÃO: transactional outbox + idempotent consumer.
// O webhook do Django deduplica por netiv_conversation_id, então é seguro
// reenviar — mas o carimbo evita reenvio desnecessário.

import { query } from '../db/pg.js';
import { notifyDjangoLead } from './djangoWebhook.js';
import type { ConversationRow } from '../repositories/conversationRepository.js';

declare const process: {
  env: Record<string, string | undefined>;
};

/** Quantas conversas processar por tick. Limite duro pra não sobrecarregar. */
const BATCH_SIZE = 50;

/** Pausa entre POSTs ao Django pra suavizar rajada (ms). */
const PER_REQUEST_DELAY_MS = 100;

/**
 * Máximo de tentativas (qualquer tipo de falha: 422, 5xx, timeout, erro de
 * conexão) antes de marcar o lead como dead-letter e parar de reenviar.
 * Cada tentativa = 1 tick (10s) → padrão de 30 tentativas ≈ 5 minutos.
 * Ajustável via env var pra não precisar recompilar em incidentes.
 */
const MAX_SYNC_ATTEMPTS = Number(process.env.DJANGO_SYNC_MAX_ATTEMPTS ?? 30);

/** Lock em memória — impede sobreposição se um tick demorar mais de 10s. */
let isRunning = false;

interface PendingRow extends ConversationRow {
  contact_full_name: string | null;
  contact_first_name: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Busca até BATCH_SIZE conversas pendentes de sincronização.
 * "Pendente" = tem enterprise_id E (nunca foi enviada OU enterprise_id mudou).
 *
 * O JOIN em contacts traz full_name pra usar como fallback do nome do cliente
 * (já que conv.customer_name pode estar null quando a Ana não capturou nome).
 */
async function selectPending(): Promise<PendingRow[]> {
  const { rows } = await query<PendingRow>(
    `SELECT c.*, ct.full_name AS contact_full_name, ct.first_name AS contact_first_name
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
      WHERE c.enterprise_id IS NOT NULL
        AND c.conversation_type = 'CLIENT'
        AND c.django_sync_dead_letter = FALSE
        AND (
          c.synced_to_django_at IS NULL
          OR c.synced_to_django_enterprise_id IS DISTINCT FROM c.enterprise_id
        )
      ORDER BY c.updated_at ASC
      LIMIT $1`,
    [BATCH_SIZE]
  );
  return rows;
}

/**
 * Marca uma conversa como sincronizada com sucesso para o enterprise_id atual.
 * Se o enterprise_id mudar de novo no futuro, o índice parcial vai trazer
 * a linha de volta no próximo SELECT.
 */
async function markSynced(conversationId: number, enterpriseId: number): Promise<void> {
  await query(
    `UPDATE conversations
        SET synced_to_django_at = NOW(),
            synced_to_django_enterprise_id = $2,
            django_sync_attempts = 0,
            django_sync_last_error = NULL,
            django_sync_dead_letter = FALSE,
            updated_at = NOW()
      WHERE id = $1`,
    [conversationId, enterpriseId]
  );
}

/**
 * Registra uma tentativa falhada. Incrementa o contador atomicamente no
 * banco (evita race condition) e decide, na mesma query, se o lead deve
 * virar dead-letter (attempts >= MAX_SYNC_ATTEMPTS).
 * Retorna o número de tentativas acumuladas e se acabou de virar dead-letter.
 */
async function markAttemptFailed(
  conversationId: number,
  errorMessage: string | undefined
): Promise<{ attempts: number; becameDeadLetter: boolean }> {
  const { rows } = await query<{ django_sync_attempts: number; django_sync_dead_letter: boolean }>(
    `UPDATE conversations
        SET django_sync_attempts = django_sync_attempts + 1,
            django_sync_last_attempt_at = NOW(),
            django_sync_last_error = $2,
            django_sync_dead_letter = (django_sync_attempts + 1) >= $3
      WHERE id = $1
      RETURNING django_sync_attempts, django_sync_dead_letter`,
    [conversationId, errorMessage?.slice(0, 500) ?? null, MAX_SYNC_ATTEMPTS]
  );
  const row = rows[0];
  return {
    attempts: row?.django_sync_attempts ?? 0,
    becameDeadLetter: row?.django_sync_dead_letter ?? false,
  };
}

/**
 * Processa um único lead pendente: envia ao Django e, se 2xx, carimba.
 * Em qualquer outro status (5xx, timeout, 422 sem mapeamento, etc),
 * NÃO carimba — o lead volta a aparecer no próximo SELECT e é reenviado
 * no próximo tick. Comportamento: "tenta pra sempre" (decisão B).
 */
async function processOne(row: PendingRow): Promise<{ ok: boolean; status?: number }> {
  const result = await notifyDjangoLead(row, {
    whatsappDisplayName: row.whatsapp_display_name ?? null,
    contactFullName: row.contact_full_name ?? null,
    contactFirstName: row.contact_first_name ?? null,
  });

  if (result.ok && row.enterprise_id != null) {
    await markSynced(row.id, row.enterprise_id);
    return result;
  }

  const errorMessage = result.error ?? (result.status ? `HTTP ${result.status}` : 'sem detalhe');
  const { attempts, becameDeadLetter } = await markAttemptFailed(row.id, errorMessage);

  if (becameDeadLetter) {
    console.error(
      `[django sync] lead ${row.id} (enterprise_id=${row.enterprise_id}) movido para DEAD-LETTER ` +
      `após ${attempts} tentativas. Último erro: ${errorMessage}. ` +
      `Corrija o mapeamento/erro no Django e resete manualmente (ver server/scripts/resurrectDeadLetterLead.ts).`
    );
  }

  return result;
}

/**
 * Uma execução do worker. Chamada pelo setInterval no index.ts.
 * Protegida por flag isRunning pra evitar sobreposição.
 */
export async function runDjangoSyncWorker(): Promise<void> {
  if (isRunning) {
    // Tick anterior ainda não terminou — pula este. Acontece em casos
    // raros de Django muito lento. O próximo tick (10s adiante) tenta.
    return;
  }
  isRunning = true;

  try {
    const pending = await selectPending();
    if (pending.length === 0) return;

    let okCount = 0;
    let failCount = 0;

    for (const row of pending) {
      try {
        const r = await processOne(row);
        if (r.ok) okCount++;
        else failCount++;
      } catch (err) {
        failCount++;
        console.error('[django sync] erro no lead', row.id, err instanceof Error ? err.message : err);
      }
      // Pausa entre POSTs pra suavizar rajada (50 leads × 100ms = 5s).
      await sleep(PER_REQUEST_DELAY_MS);
    }

    console.log(
      `[django sync] tick concluído. enviados=${okCount} falhas=${failCount} ` +
      `pendentes_no_lote=${pending.length} max_tentativas=${MAX_SYNC_ATTEMPTS}`
    );
  } finally {
    isRunning = false;
  }
}
