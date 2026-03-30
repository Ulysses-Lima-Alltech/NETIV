/** Anexos permitidos no envio manual pelo inbox (alinhado à Cloud API). */

export const MANUAL_WHATSAPP_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const ALLOWED_MIMES = new Set(Object.values(EXT_TO_MIME));

export function normalizeManualAttachmentMime(filename: string, mimetype: string | undefined): string | null {
  const m = (mimetype || '').trim().toLowerCase();
  if (m && ALLOWED_MIMES.has(m)) return m;
  const ext = filename.includes('.') ? filename.slice(filename.lastIndexOf('.') + 1).toLowerCase() : '';
  return EXT_TO_MIME[ext] ?? null;
}

export function isManualAttachmentAllowed(filename: string, mimetype: string | undefined, size: number): boolean {
  if (size <= 0 || size > MANUAL_WHATSAPP_ATTACHMENT_MAX_BYTES) return false;
  return normalizeManualAttachmentMime(filename, mimetype) != null;
}
