import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';

interface KnowledgeS3Cfg {
  bucket: string;
  region: string;
  endpoint?: string;
  forcePathStyle: boolean;
  accessKeyId?: string;
  secretAccessKey?: string;
}

function parseBool(input: string | undefined): boolean {
  if (!input) return false;
  const normalized = input.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function getKnowledgeS3Cfg(): KnowledgeS3Cfg | null {
  const bucket = (process.env.KNOWLEDGE_S3_BUCKET ?? '').trim();
  if (!bucket) return null;

  const region = (process.env.KNOWLEDGE_S3_REGION ?? '').trim() || 'us-east-1';
  const endpoint = (process.env.KNOWLEDGE_S3_ENDPOINT ?? '').trim() || undefined;
  const accessKeyId = (process.env.KNOWLEDGE_S3_ACCESS_KEY_ID ?? '').trim() || undefined;
  const secretAccessKey = (process.env.KNOWLEDGE_S3_SECRET_ACCESS_KEY ?? '').trim() || undefined;

  if ((accessKeyId && !secretAccessKey) || (!accessKeyId && secretAccessKey)) {
    throw new Error('KNOWLEDGE_S3_ACCESS_KEY_ID e KNOWLEDGE_S3_SECRET_ACCESS_KEY devem ser informados juntos.');
  }

  return {
    bucket,
    region,
    endpoint,
    forcePathStyle: parseBool(process.env.KNOWLEDGE_S3_FORCE_PATH_STYLE),
    accessKeyId,
    secretAccessKey,
  };
}

function makeKnowledgeS3Client(cfg: KnowledgeS3Cfg): S3Client {
  return new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials:
      cfg.accessKeyId && cfg.secretAccessKey
        ? {
            accessKeyId: cfg.accessKeyId,
            secretAccessKey: cfg.secretAccessKey,
          }
        : undefined,
  });
}

export function isKnowledgeS3Configured(): boolean {
  return getKnowledgeS3Cfg() !== null;
}

export function getKnowledgeS3Bucket(): string {
  const cfg = getKnowledgeS3Cfg();
  if (!cfg) throw new Error('KNOWLEDGE_S3_BUCKET não configurado.');
  return cfg.bucket;
}

export type KnowledgeS3PutResult =
  | { ok: true; bucket: string; key: string }
  | { ok: false; bucket: string; key: string; error: string };

export async function putObjectToKnowledgeS3(
  key: string,
  body: Buffer | string,
  contentType: string,
  metadata?: Record<string, string>
): Promise<KnowledgeS3PutResult> {
  const cfg = getKnowledgeS3Cfg();
  if (!cfg) {
    return {
      ok: false,
      bucket: '',
      key,
      error: 'KNOWLEDGE_S3_BUCKET não configurado.',
    };
  }

  const input: PutObjectCommandInput = {
    Bucket: cfg.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    Metadata: metadata,
  };

  try {
    const client = makeKnowledgeS3Client(cfg);
    await client.send(new PutObjectCommand(input));
    return { ok: true, bucket: cfg.bucket, key };
  } catch (error) {
    return {
      ok: false,
      bucket: cfg.bucket,
      key,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function streamToBuffer(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function downloadFromKnowledgeS3(key: string): Promise<Buffer | null> {
  const cfg = getKnowledgeS3Cfg();
  if (!cfg) return null;

  try {
    const client = makeKnowledgeS3Client(cfg);
    const response = await client.send(
      new GetObjectCommand({
        Bucket: cfg.bucket,
        Key: key,
      })
    );
    if (!response.Body) return null;
    return streamToBuffer(response.Body as AsyncIterable<Uint8Array>);
  } catch {
    return null;
  }
}

