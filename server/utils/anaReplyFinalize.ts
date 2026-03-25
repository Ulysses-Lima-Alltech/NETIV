/** Delay aleatório entre respostas da ANA (ms), não bloqueia outras conversas (uso com await dentro do handler da conversa). */
export function randomAnaReplyDelayMs(): number {
  const min = 5000;
  const max = 50000;
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function sleepMs(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Regras de UX: sem ponto final no fim da mensagem; última frase deve ser pergunta.
 * Se não terminar com "?", acrescenta pergunta curta padrão (sem ponto final).
 */
export function finalizeAnaReplyText(text: string): string {
  let s = (text || '').trim();
  if (!s) return 'Algo mais que eu possa te ajudar';
  while (s.endsWith('.')) s = s.slice(0, -1).trim();
  if (!s.endsWith('?')) {
    s = `${s} Algo mais que eu possa te ajudar`;
  }
  while (s.endsWith('.')) s = s.slice(0, -1).trim();
  return s;
}

/** Conta menções ao nome do cliente no texto (normalizado, trechos curtos). */
export function countCustomerNameMentionsInText(reply: string, customerName: string | null | undefined): number {
  const name = (customerName || '').trim();
  if (name.length < 2) return 0;
  const n = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  const t = reply
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
  if (!n || !t.includes(n)) return 0;
  let count = 0;
  let pos = 0;
  for (;;) {
    const i = t.indexOf(n, pos);
    if (i < 0) break;
    count += 1;
    pos = i + Math.max(1, n.length);
  }
  return count;
}
