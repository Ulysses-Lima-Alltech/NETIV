/**
 * Cloudflare R2 storage — API S3-compatible via @aws-sdk/client-s3.
 *
 * Variáveis de ambiente (todas configuradas no Render):
 *   CLOUDFLARE_R2_ENDPOINT          — URL do endpoint S3 do R2
 *                                     ex.: https://<accountId>.r2.cloudflarestorage.com
 *                                     (se ausente, calculado a partir de CLOUDFLARE_R2_ACCOUNT_ID)
 *   CLOUDFLARE_R2_ACCOUNT_ID        — Account ID do Cloudflare (opcional se ENDPOINT definido)
 *   CLOUDFLARE_R2_ACCESS_KEY_ID     — Access Key gerada no R2
 *   CLOUDFLARE_R2_SECRET_ACCESS_KEY — Secret Access Key
 *   CLOUDFLARE_R2_BUCKET            — Nome do bucket
 *   CLOUDFLARE_R2_PUBLIC_BASE_URL   — (opcional) Custom domain para URL pública dos objetos
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

interface R2Cfg {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
}

function getR2Cfg(): R2Cfg | null {
  const accessKeyId = (process.env.CLOUDFLARE_R2_ACCESS_KEY_ID ?? '').trim();
  const secretAccessKey = (process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY ?? '').trim();
  const bucket = (process.env.CLOUDFLARE_R2_BUCKET ?? '').trim();
  if (!accessKeyId || !secretAccessKey || !bucket) return null;

  // Aceita endpoint explícito (preferido) ou constrói a partir do accountId.
  const explicitEndpoint = (process.env.CLOUDFLARE_R2_ENDPOINT ?? '').trim();
  const accountId = (process.env.CLOUDFLARE_R2_ACCOUNT_ID ?? '').trim();
  const endpoint = explicitEndpoint || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');
  if (!endpoint) return null;

  return {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl: (process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL ?? '').trim() || undefined,
  };
}

export function isR2Configured(): boolean {
  return getR2Cfg() !== null;
}

function makeClient(cfg: R2Cfg): S3Client {
  return new S3Client({
    region: 'auto',
    endpoint: cfg.endpoint,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

// ─── Upload ─────────────────────────────────────────────────────────────────

export type R2UploadResult =
  | { ok: true; key: string; bucket: string; publicUrl: string | null }
  | { ok: false; error: string };

export async function uploadToR2(
  key: string,
  buffer: Buffer,
  mime: string
): Promise<R2UploadResult> {
  const cfg = getR2Cfg();
  if (!cfg) return { ok: false, error: 'R2 não configurado (variáveis de ambiente ausentes).' };

  console.log('[R2_UPLOAD_START]', { key, bucket: cfg.bucket, mime, bytes: buffer.length });
  try {
    const client = makeClient(cfg);
    await client.send(
      new PutObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
        Body: buffer,
        ContentType: mime,
        ContentLength: buffer.length,
      })
    );
    const publicUrl = cfg.publicBaseUrl
      ? `${cfg.publicBaseUrl.replace(/\/$/, '')}/${key}`
      : null;
    console.log('[R2_UPLOAD_SUCCESS]', { key, bucket: cfg.bucket, bytes: buffer.length, publicUrl });
    return { ok: true, key, bucket: cfg.bucket, publicUrl };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[R2_UPLOAD_FAILED]', { key, bucket: cfg.bucket, error });
    return { ok: false, error };
  }
}

// ─── Download ────────────────────────────────────────────────────────────────

export async function downloadFromR2(key: string): Promise<Buffer | null> {
  const cfg = getR2Cfg();
  if (!cfg) {
    console.error('[R2_GET_OBJECT_FAILED]', { key, reason: 'R2 não configurado' });
    return null;
  }
  console.log('[R2_GET_OBJECT_START]', { key, bucket: cfg.bucket });
  try {
    const client = makeClient(cfg);
    const res = await client.send(new GetObjectCommand({ Bucket: cfg.bucket, Key: key }));
    if (!res.Body) {
      console.error('[R2_GET_OBJECT_FAILED]', { key, bucket: cfg.bucket, reason: 'Body vazio' });
      return null;
    }
    const chunks: Uint8Array[] = [];
    for await (const chunk of res.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }
    const buf = Buffer.concat(chunks);
    console.log('[R2_GET_OBJECT_SUCCESS]', { key, bucket: cfg.bucket, bytes: buf.length });
    return buf;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error('[R2_GET_OBJECT_FAILED]', { key, bucket: cfg.bucket, error });
    return null;
  }
}

// ─── Delete ──────────────────────────────────────────────────────────────────

export async function deleteFromR2(key: string): Promise<void> {
  const cfg = getR2Cfg();
  if (!cfg) return;
  try {
    const client = makeClient(cfg);
    await client.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    console.log('[R2_DELETE_SUCCESS]', { key, bucket: cfg.bucket });
  } catch (e) {
    console.error('[R2_DELETE_FAILED]', {
      key,
      bucket: cfg?.bucket,
      error: e instanceof Error ? e.message : String(e),
    });
  }
}
