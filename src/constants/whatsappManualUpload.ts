/** Alinhado a `server/utils/manualWhatsappAttachment.ts` e à Cloud API. */

export const W_MANUAL_BODY_MAX = 100 * 1024 * 1024;
export const W_MANUAL_DOCUMENT_MAX = 100 * 1024 * 1024;
export const W_MANUAL_VIDEO_MAX = 16 * 1024 * 1024;
export const W_MANUAL_IMAGE_MAX = 5 * 1024 * 1024;

export type WManualKind = 'image' | 'video' | 'document';

function kindFromFile(file: File): WManualKind {
  const t = (file.type || '').toLowerCase();
  const n = file.name.toLowerCase();
  if (t.startsWith('video/') || n.endsWith('.mp4') || n.endsWith('.3gp')) return 'video';
  if (t.startsWith('image/') || /\.(jpe?g|png|webp)$/i.test(n)) return 'image';
  return 'document';
}

function maxForKind(k: WManualKind): number {
  switch (k) {
    case 'image':
      return W_MANUAL_IMAGE_MAX;
    case 'video':
      return W_MANUAL_VIDEO_MAX;
    default:
      return W_MANUAL_DOCUMENT_MAX;
  }
}

/** Validação antes do upload (mesma lógica do backend). */
export function validateManualUploadFile(file: File): { ok: true } | { ok: false; message: string } {
  if (file.size > W_MANUAL_BODY_MAX) {
    return {
      ok: false,
      message: `Arquivo muito grande. O limite do servidor é ${W_MANUAL_BODY_MAX / (1024 * 1024)} MB.`,
    };
  }
  const k = kindFromFile(file);
  const max = maxForKind(k);
  if (file.size > max) {
    if (k === 'video') {
      return { ok: false, message: `Vídeo muito grande. O limite é ${W_MANUAL_VIDEO_MAX / (1024 * 1024)} MB (WhatsApp).` };
    }
    if (k === 'image') {
      return { ok: false, message: `Imagem muito grande. O limite é ${W_MANUAL_IMAGE_MAX / (1024 * 1024)} MB (WhatsApp).` };
    }
    return { ok: false, message: `Arquivo muito grande. O limite para documentos é ${W_MANUAL_DOCUMENT_MAX / (1024 * 1024)} MB.` };
  }
  return { ok: true };
}
