/** Palavras que não devem ser capturadas como nome próprio. */
const NAME_BLOCKLIST = new Set(
  [
    'cliente',
    'obrigado',
    'obrigada',
    'whatsapp',
    'apartamento',
    'loteamento',
    'mcmv',
    'empreendimento',
    'visita',
    'bom',
    'boa',
    'tarde',
    'noite',
    'dia',
    'sim',
    'nao',
    'não',
    'ok',
  ].map((s) => s.toLowerCase())
);

function titleCaseWords(s: string): string {
  return s
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function sanitizeNameCandidate(raw: string): string | null {
  let s = raw.replace(/^[,\s:]+|[\s,:]+$/g, '').trim();
  const beforePunct = s.split(/[.!?;]/)[0] ?? s;
  s = beforePunct.trim();
  if (s.length < 2 || s.length > 48) return null;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;
  if (words.some((w) => w.length > 22)) return null;
  if (words.some((w) => /\d/.test(w))) return null;
  for (const w of words) {
    if (NAME_BLOCKLIST.has(w.toLowerCase())) return null;
  }
  return titleCaseWords(s);
}

/**
 * Extrai nome informado pelo cliente de forma conservadora (regex + heurística curta).
 * Não usar nome de perfil do WhatsApp — só texto explícito do usuário.
 */
export function extractCustomerNameFromUserUtterance(text: string): string | null {
  const t = text.trim();
  if (t.length < 2 || t.length > 200) return null;

  const patterns: RegExp[] = [
    /meu\s+nome\s+[eé]\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,46})/i,
    /me\s+chamo\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,46})/i,
    /\bsou\s+(?:o|a)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,46})/i,
    /pode\s+me\s+chamar\s+de\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,30})/i,
    /pode\s+chamar(?:\s+de|\s+me)?\s+de\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,30})/i,
    /chama(?:\s+me)?\s+de\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s.'-]{1,30})/i,
  ];

  for (const re of patterns) {
    const m = t.match(re);
    if (m?.[1]) {
      const name = sanitizeNameCandidate(m[1]);
      if (name) return name;
    }
  }

  const compact = t.replace(/\.$/, '').trim();
  if (
    compact.length >= 2 &&
    compact.length <= 36 &&
    !compact.includes('?') &&
    !compact.includes('@') &&
    /^[A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,2}$/.test(compact)
  ) {
    return sanitizeNameCandidate(compact);
  }

  return null;
}
