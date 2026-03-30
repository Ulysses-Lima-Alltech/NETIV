/** Limites alinhados à WhatsApp Cloud API (upload de mídia) + teto do body no servidor. */

/** Teto do multipart no multer (corpo da requisição). */
export const MANUAL_UPLOAD_BODY_LIMIT_BYTES = 100 * 1024 * 1024;

/** Documentos (PDF, Office, etc.) — Cloud API. */
export const MANUAL_MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

/** Vídeo — Cloud API. */
export const MANUAL_MAX_VIDEO_BYTES = 16 * 1024 * 1024;

/** Imagem (JPEG/PNG/WebP) — Cloud API para mensagens `image`. */
export const MANUAL_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ManualMediaKind = 'image' | 'video' | 'document';

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
};

const ALLOWED_MIMES = new Set(Object.values(EXT_TO_MIME));

export function normalizeManualAttachmentMime(filename: string, mimetype: string | undefined): string | null {
  const m = (mimetype || '').trim().toLowerCase();
  if (m && ALLOWED_MIMES.has(m)) return m;
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase() : '';
  return EXT_TO_MIME[ext] ?? null;
}

export function classifyManualMediaKind(filename: string, mimetype: string | undefined): ManualMediaKind | null {
  const mime = normalizeManualAttachmentMime(filename, mimetype);
  if (!mime) return null;
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('image/')) return 'image';
  return 'document';
}

export function maxBytesForManualMediaKind(kind: ManualMediaKind): number {
  switch (kind) {
    case 'image':
      return MANUAL_MAX_IMAGE_BYTES;
    case 'video':
      return MANUAL_MAX_VIDEO_BYTES;
    case 'document':
      return MANUAL_MAX_DOCUMENT_BYTES;
  }
}

export function isManualAttachmentAllowed(filename: string, mimetype: string | undefined, size: number): boolean {
  const kind = classifyManualMediaKind(filename, mimetype);
  if (!kind) return false;
  if (size <= 0 || size > MANUAL_UPLOAD_BODY_LIMIT_BYTES) return false;
  return size <= maxBytesForManualMediaKind(kind);
}

/** Mensagem para 400 quando tipo/tamanho inválido após passar pelo multer. */
export function manualAttachmentRejectionMessage(filename: string, mimetype: string | undefined, size: number): string {
  const kind = classifyManualMediaKind(filename, mimetype);
  if (!kind) {
    return 'Anexo não suportado. Use PDF, imagens (JPG, PNG, WEBP), ou vídeo MP4/3GP.';
  }
  if (size > MANUAL_UPLOAD_BODY_LIMIT_BYTES) {
    return 'Arquivo excede o limite de 100 MB.';
  }
  const max = maxBytesForManualMediaKind(kind);
  if (size > max) {
    if (kind === 'video') return `Vídeo muito grande. O limite é ${MANUAL_MAX_VIDEO_BYTES / (1024 * 1024)} MB (WhatsApp).`;
    if (kind === 'image') return `Imagem muito grande. O limite é ${MANUAL_MAX_IMAGE_BYTES / (1024 * 1024)} MB (WhatsApp).`;
    return `Arquivo muito grande. O limite para documentos é ${MANUAL_MAX_DOCUMENT_BYTES / (1024 * 1024)} MB.`;
  }
  return 'Anexo não suportado.';
}
