import {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  DeleteTranscriptionJobCommand,
  type MediaFormat,
} from '@aws-sdk/client-transcribe';
import { downloadFromKnowledgeS3 } from './s3Storage.js';

const POLL_INTERVAL_MS = 1500;
const MAX_POLL_ATTEMPTS = 30; // ~45s — audio recebido via WhatsApp costuma ser curto (nota de voz)

export interface AudioTranscriptionResult {
  success: boolean;
  text?: string;
  error?: string;
}

function resolveTranscribeRegion(): string {
  return (
    process.env.ANA_TRANSCRIBE_REGION ||
    process.env.ANA_BEDROCK_REGION ||
    process.env.AWS_BEDROCK_REGION ||
    process.env.AWS_REGION ||
    process.env.AWS_DEFAULT_REGION ||
    'us-east-1'
  );
}

const MIME_TO_TRANSCRIBE_FORMAT: Record<string, MediaFormat> = {
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'mp4',
  'audio/m4a': 'mp4',
  'audio/aac': 'mp4',
  'audio/amr': 'amr',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
};

export function isAudioTranscriptionConfigured(): boolean {
  // Amazon Transcribe usa as credenciais/role padrão da AWS (mesmas do
  // Bedrock/S3 já em uso) — não há uma chave dedicada pra checar; a
  // disponibilidade real só se confirma na chamada.
  return true;
}

function mediaFormatFromMimeType(mimeType: string): MediaFormat | null {
  const clean = mimeType.split(';')[0]?.trim().toLowerCase() ?? '';
  return MIME_TO_TRANSCRIBE_FORMAT[clean] ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Transcreve um áudio inbound (nota de voz do WhatsApp) já persistido no S3
 * (mesmo bucket de conhecimento usado por `downloadAndStoreInboundMedia`).
 * Usa Amazon Transcribe — mesmo provedor AWS já usado pra chat (Bedrock) e
 * storage (S3), sem introduzir uma chave/vendor de IA novo só pra isso.
 */
export async function transcribeInboundAudioFromS3(params: {
  bucket: string;
  key: string;
  mimeType: string;
  jobNameSeed: string;
}): Promise<AudioTranscriptionResult> {
  const mediaFormat = mediaFormatFromMimeType(params.mimeType);
  if (!mediaFormat) {
    return { success: false, error: `unsupported_mime_type_for_transcribe:${params.mimeType}` };
  }

  const region = resolveTranscribeRegion();
  const client = new TranscribeClient({ region });
  const jobName = `inbound-audio-${params.jobNameSeed}-${Date.now()}`.replace(/[^0-9A-Za-z._-]/g, '-').slice(0, 200);
  const outputKey = `inbound-media-transcripts/${params.key}.json`;

  try {
    await client.send(
      new StartTranscriptionJobCommand({
        TranscriptionJobName: jobName,
        LanguageCode: 'pt-BR',
        MediaFormat: mediaFormat,
        Media: { MediaFileUri: `s3://${params.bucket}/${params.key}` },
        OutputBucketName: params.bucket,
        OutputKey: outputKey,
      })
    );
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }

  try {
    for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt += 1) {
      await sleep(POLL_INTERVAL_MS);
      const status = await client.send(new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }));
      const jobStatus = status.TranscriptionJob?.TranscriptionJobStatus;

      if (jobStatus === 'COMPLETED') {
        const resultBuffer = await downloadFromKnowledgeS3(outputKey, { bucket: params.bucket });
        void client.send(new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName })).catch(() => {});
        if (!resultBuffer) return { success: false, error: 'transcribe_output_download_failed' };

        const parsed = JSON.parse(resultBuffer.toString('utf-8')) as {
          results?: { transcripts?: Array<{ transcript?: string }> };
        };
        const text = (parsed.results?.transcripts?.[0]?.transcript ?? '').trim();
        if (!text) return { success: false, error: 'empty_transcription' };
        return { success: true, text };
      }

      if (jobStatus === 'FAILED') {
        void client.send(new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName })).catch(() => {});
        return { success: false, error: `transcribe_job_failed: ${status.TranscriptionJob?.FailureReason ?? 'unknown'}` };
      }
    }

    void client.send(new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName })).catch(() => {});
    return { success: false, error: 'transcribe_job_timeout' };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}
