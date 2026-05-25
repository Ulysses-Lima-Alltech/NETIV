const BLOCKED_OUTBOUND_SNIPPETS = [
  'Só passando para te lembrar que posso te ajudar com todos os detalhes do Évora.',
  'posso te ajudar com todos os detalhes do Évora',
];

export function isAnaEmergencyBlockedOutboundMessage(text: unknown): boolean {
  const normalized = String(text ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase();

  if (!normalized) return false;

  return BLOCKED_OUTBOUND_SNIPPETS.some((snippet) =>
    normalized.includes(snippet.normalize('NFC').toLowerCase())
  );
}
