/**
 * Backfill de mídia recebida do cliente ANTES do fix de download inbound
 * (ver webhookProcessor.ts, downloadAndStoreInboundMedia). Essas mensagens
 * ficaram só com o texto placeholder "[Mensagem image]" (ou audio/video/
 * document) e nenhum anexo real.
 *
 * O media_id da Meta nunca foi salvo na própria linha de `messages`, mas o
 * payload bruto do webhook foi (webhook_events.payload, por meta_message_id)
 * -- de lá dá pra recuperar o media_id original e rodar o mesmo fluxo de
 * download/upload usado pra mensagens novas.
 *
 * Reimplementa a lógica de downloadAndStoreInboundMedia (webhookProcessor.ts)
 * de propósito, em vez de importar o módulo direto: webhookProcessor.ts
 * importa conversationEngine.ts/anaGraph, com efeitos colaterais de módulo
 * pesados (workers, sockets) que travam quando rodados fora do processo
 * principal do servidor. As duas funções de baixo nível reutilizadas aqui
 * (downloadInboundMedia, putObjectToKnowledgeS3) são leves e standalone.
 *
 * Uso:
 *   npx tsx scripts/backfillInboundMediaAttachments.ts            (dry-run, só lista)
 *   npx tsx scripts/backfillInboundMediaAttachments.ts --apply    (baixa e grava de verdade)
 */
import 'dotenv/config';
import { query } from '../db/pg.js';
import { downloadInboundMedia } from '../services/whatsappMetaService.js';
import { putObjectToKnowledgeS3, isKnowledgeS3Configured } from '../services/s3Storage.js';
import type { MessageAttachmentPayload, MessageKindDb } from '../repositories/messageRepository.js';

interface CandidateRow {
  id: number;
  conversation_id: number;
  meta_message_id: string | null;
  content: string | null;
  created_at: Date;
}

interface RawWebhookMessage {
  type?: string;
  image?: { id?: string; caption?: string };
  audio?: { id?: string };
  video?: { id?: string };
  document?: { id?: string; filename?: string };
}

const MIME_EXTENSION_FALLBACK: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/amr': 'amr',
  'audio/aac': 'aac',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
};

function guessFileExtension(mimeType: string): string {
  const clean = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_EXTENSION_FALLBACK[clean] ?? clean.split('/')[1] ?? 'bin';
}

function parseArgs(): { apply: boolean; limit: number } {
  const args = process.argv.slice(2);
  return {
    apply: args.includes('--apply'),
    limit: (() => {
      const idx = args.findIndex((a) => a === '--limit');
      const raw = idx >= 0 ? args[idx + 1] : null;
      const n = raw ? parseInt(raw, 10) : NaN;
      return Number.isFinite(n) && n > 0 ? n : 500;
    })(),
  };
}

async function findCandidates(limit: number): Promise<CandidateRow[]> {
  const { rows } = await query<CandidateRow>(
    `SELECT id, conversation_id, meta_message_id, content, created_at
     FROM messages
     WHERE content ~ '^\\[Mensagem (image|audio|video|document)\\]$'
       AND attachment_json IS NULL
       AND meta_message_id IS NOT NULL
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

async function findWebhookMessage(metaMessageId: string): Promise<RawWebhookMessage | null> {
  const { rows } = await query<{ payload: string }>(
    `SELECT payload FROM webhook_events WHERE meta_message_id = $1 ORDER BY created_at ASC LIMIT 1`,
    [metaMessageId]
  );
  const raw = rows[0]?.payload;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      entry?: Array<{ changes?: Array<{ value?: { messages?: RawWebhookMessage[] } }> }>;
    };
    const messages = parsed.entry?.[0]?.changes?.[0]?.value?.messages;
    return (messages?.find((m: RawWebhookMessage & { id?: string }) => (m as { id?: string }).id === metaMessageId) ??
      messages?.[0] ??
      null);
  } catch {
    return null;
  }
}

/** Mesma lógica de webhookProcessor.ts::downloadAndStoreInboundMedia, reimplementada standalone. */
async function downloadAndStore(
  msg: RawWebhookMessage,
  conversationId: number
): Promise<{ messageKind: MessageKindDb; attachment: MessageAttachmentPayload } | null> {
  const type = msg.type;
  const mediaId =
    type === 'image' ? msg.image?.id
    : type === 'audio' ? msg.audio?.id
    : type === 'video' ? msg.video?.id
    : type === 'document' ? msg.document?.id
    : null;
  if (!mediaId) return null;

  const messageKind: MessageKindDb | null =
    type === 'image' ? 'image' : type === 'audio' ? 'audio' : type === 'video' ? 'video' : type === 'document' ? 'document' : null;
  if (!messageKind) return null;

  const download = await downloadInboundMedia(mediaId);
  if (!download.success || !download.buffer) {
    console.log(`  download falhou: ${download.error}`);
    return null;
  }

  const mimeType = download.mimeType || 'application/octet-stream';
  const fileName = msg.document?.filename || `${type}-${mediaId}.${guessFileExtension(mimeType)}`;
  const storageKey = `inbound-media/${conversationId}/${mediaId}-${fileName}`;

  const uploaded = await putObjectToKnowledgeS3(storageKey, download.buffer, mimeType);
  if (!uploaded.ok) {
    console.log(`  upload falhou: ${uploaded.error}`);
    return null;
  }

  return {
    messageKind,
    attachment: {
      fileName,
      mimeType,
      sizeBytes: download.fileSize,
      whatsappMediaId: mediaId,
      caption: msg.image?.caption ?? null,
      storageKey,
    },
  };
}

async function main() {
  const { apply, limit } = parseArgs();
  if (!isKnowledgeS3Configured()) {
    console.error('[BACKFILL_INBOUND_MEDIA] KNOWLEDGE_S3_BUCKET não configurado — abortando.');
    process.exit(1);
  }

  const candidates = await findCandidates(limit);
  console.log(`[BACKFILL_INBOUND_MEDIA] ${candidates.length} mensagens candidatas (limit=${limit}, apply=${apply})`);

  let downloaded = 0;
  let skippedNoWebhookEvent = 0;
  let skippedDownloadFailed = 0;
  let skippedNoMediaId = 0;

  for (const row of candidates) {
    if (!row.meta_message_id) continue;
    const msg = await findWebhookMessage(row.meta_message_id);
    if (!msg) {
      skippedNoWebhookEvent += 1;
      console.log(`[SKIP] messageId=${row.id} sem webhook_events correspondente`);
      continue;
    }
    const mediaId =
      msg.type === 'image' ? msg.image?.id
      : msg.type === 'audio' ? msg.audio?.id
      : msg.type === 'video' ? msg.video?.id
      : msg.type === 'document' ? msg.document?.id
      : null;
    if (!mediaId) {
      skippedNoMediaId += 1;
      console.log(`[SKIP] messageId=${row.id} sem media id no payload (type=${msg.type})`);
      continue;
    }

    if (!apply) {
      console.log(`[DRY_RUN] messageId=${row.id} conversationId=${row.conversation_id} type=${msg.type} mediaId=${mediaId}`);
      continue;
    }

    console.log(`[APPLY] messageId=${row.id} conversationId=${row.conversation_id} type=${msg.type} mediaId=${mediaId}`);
    const media = await downloadAndStore(msg, row.conversation_id);
    if (!media) {
      skippedDownloadFailed += 1;
      console.log(`[FAIL] messageId=${row.id} download/upload falhou (media expirada ou S3 indisponível)`);
      continue;
    }

    const newContent = media.attachment.caption ?? null;
    await query(
      `UPDATE messages SET content = $1, message_kind = $2, attachment_json = $3::jsonb WHERE id = $4`,
      [newContent, media.messageKind, JSON.stringify(media.attachment), row.id]
    );
    downloaded += 1;
    console.log(`[OK] messageId=${row.id} messageKind=${media.messageKind} storageKey=${media.attachment.storageKey}`);
  }

  console.log('[BACKFILL_INBOUND_MEDIA] resumo', {
    total: candidates.length,
    downloaded,
    skippedNoWebhookEvent,
    skippedNoMediaId,
    skippedDownloadFailed,
    apply,
  });
  process.exit(0);
}

main().catch((e) => {
  console.error('[BACKFILL_INBOUND_MEDIA] erro fatal', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
