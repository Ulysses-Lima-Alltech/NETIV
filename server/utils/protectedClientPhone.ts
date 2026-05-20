export const PROTECTED_CLIENT_PHONE_CANONICAL = '5512992367544';

export function normalizePhoneDigits(value: string | null | undefined): string {
  return String(value ?? '').replace(/\D/g, '');
}

export function isProtectedClientPhone(value: string | null | undefined): boolean {
  const digits = normalizePhoneDigits(value);
  if (!digits) return false;
  return digits === PROTECTED_CLIENT_PHONE_CANONICAL || digits.endsWith('12992367544');
}
