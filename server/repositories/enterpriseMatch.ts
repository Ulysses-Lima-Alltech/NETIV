import { listEnterprises } from './enterpriseRepository.js';

export async function tryMatchActiveEnterpriseId(userMessage: string): Promise<number | null> {
  const active = await listEnterprises(true);
  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  const lower = norm(userMessage);
  let best: { id: number; score: number } | null = null;
  for (const p of active) {
    const n = norm(p.name);
    const sl = norm(p.slug || '');
    // Evita match por substring curta ("em", "oi") que polui consultas por localização.
    if (n.length >= 3 && lower.includes(n)) {
      const score = n.length;
      if (!best || score > best.score) best = { id: p.id, score };
    } else if (sl.length >= 3 && lower.includes(sl)) {
      const score = sl.length;
      if (!best || score > best.score) best = { id: p.id, score };
    }
  }
  return best?.id ?? null;
}
