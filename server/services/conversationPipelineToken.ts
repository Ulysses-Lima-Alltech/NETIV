/** Token por conversa: nova mensagem do usuário invalida envio pendente da rodada anterior. */
const pipelineTokens = new Map<number, number>();

export function bumpConversationPipelineToken(conversationId: number): number {
  const n = (pipelineTokens.get(conversationId) ?? 0) + 1;
  pipelineTokens.set(conversationId, n);
  return n;
}

export function getConversationPipelineToken(conversationId: number): number {
  return pipelineTokens.get(conversationId) ?? 0;
}

export function isPipelineStale(conversationId: number, token: number | undefined): boolean {
  if (token === undefined) return false;
  return getConversationPipelineToken(conversationId) !== token;
}
