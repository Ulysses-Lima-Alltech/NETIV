/** Quebra texto em blocos para indexação (book / documentos). */
export function splitTextIntoChunks(text: string, maxLen = 1800): string[] {
  const t = String(text || '').trim();
  if (!t) return [];
  const paras = t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const out: string[] = [];
  let buf = '';
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  };
  const pushLong = (p: string) => {
    for (let i = 0; i < p.length; i += maxLen) {
      const piece = p.slice(i, i + maxLen).trim();
      if (piece) out.push(piece);
    }
  };
  for (const p of paras) {
    if (p.length > maxLen) {
      flush();
      pushLong(p);
      continue;
    }
    if (buf.length + p.length + 2 <= maxLen) {
      buf = buf ? `${buf}\n\n${p}` : p;
    } else {
      flush();
      buf = p;
    }
  }
  flush();
  return out;
}
