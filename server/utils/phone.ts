export function normalizePhoneE164(input: string | null | undefined): string | null {
  const digits = String(input ?? '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length < 10) return null;
  if (digits.startsWith('55')) return digits;
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}

export function toFirstName(fullName: string | null | undefined): string | null {
  const n = String(fullName ?? '').trim();
  if (!n) return null;
  return n.split(/\s+/)[0] || null;
}
