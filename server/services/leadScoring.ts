const HOT_LEAD_KEYWORDS = [
  'preço',
  'valor',
  'comprar',
  'contratar',
  'orçamento',
  'fechar',
  'interesse',
  'como contratar',
  'quanto custa',
];

export function detectLeadScore(message: string): number {
  if (!message?.trim()) return 0;
  const normalized = message.toLowerCase().trim();
  let score = 0;
  let matchCount = 0;
  for (const keyword of HOT_LEAD_KEYWORDS) {
    if (normalized.includes(keyword)) {
      matchCount += 1;
      score += 0.2;
    }
  }
  if (matchCount >= 2) score += 0.15;
  if (matchCount >= 3) score += 0.1;
  return Math.min(1, Math.round(score * 100) / 100);
}
