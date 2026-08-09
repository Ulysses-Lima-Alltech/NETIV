export function normalizeListItemForCompare(raw: string): string {
  return (raw || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(de|da|do|das|dos|e|com)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function dedupeListItems(items: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const clean = item.replace(/[.]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    const key = normalizeListItemForCompare(clean);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  return out;
}

export function extractReplyListItems(text: string | null | undefined): string[] {
  const raw = (text || '').trim();
  if (!raw) return [];
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets = lines
    .map((line) => line.match(/^(?:[-*•]|\d+[.)])\s+(.+)$/u))
    .filter((m): m is RegExpMatchArray => m != null)
    .map((m) => m[1]!.trim());
  if (bullets.length > 0) return dedupeListItems(bullets);

  const inlineLine = lines.find((line) => /\b(incluem|inclui|conta com)\b/i.test(line) && /[,;|]/.test(line));
  if (!inlineLine) return [];
  const normalized = inlineLine.replace(/^.*?:\s*/u, '');
  const parts = normalized
    .split(/[;,|]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return dedupeListItems(parts);
}
