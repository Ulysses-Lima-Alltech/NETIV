import { getMessagesByConversationId } from '../repositories/messageRepository.js';

const MAX_MESSAGES_TO_ANALYZE = 20;

/** Legado: scoring heurístico para APIs; persistência de lead fica na Ana (PG). */
export function analyzeLead(_conversationId: number): void {}

export type LeadStage = 'COLD' | 'WARM' | 'HOT';
export type LeadIntentNow = 'LOW' | 'MEDIUM' | 'HIGH';

export interface LeadAnalysisResult {
  leadScore: number;
  leadStage: LeadStage;
  leadIntentNow: LeadIntentNow;
  reason: string;
}

export async function computeLeadAnalysisFromDb(conversationId: number): Promise<LeadAnalysisResult> {
  const rows = await getMessagesByConversationId(conversationId);
  const inboundTexts = rows
    .filter((m) => m.role === 'user')
    .slice(-MAX_MESSAGES_TO_ANALYZE)
    .map((m) => m.content || '');
  return computeLeadAnalysis(inboundTexts);
}

export function computeLeadAnalysis(messages: string[]): LeadAnalysisResult {
  const texts = messages.map((m) => (m || '').trim()).filter(Boolean);
  let score = 0;
  const reasons: string[] = [];
  const INTEREST = ['preço', 'valor', 'quanto custa', 'contratar', 'fechar'];
  const STRONG = ['quero contratar', 'vamos fechar'];
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  for (const text of texts) {
    const n = norm(text);
    if (INTEREST.some((t) => n.includes(norm(t)))) score += 0.25;
    if (STRONG.some((t) => n.includes(norm(t)))) score += 0.5;
  }
  if (texts.length > 5) score += 0.1;
  score = Math.min(1, Math.round(score * 100) / 100);
  let leadStage: LeadStage = 'COLD';
  if (score >= 0.7) leadStage = 'HOT';
  else if (score >= 0.4) leadStage = 'WARM';
  let leadIntentNow: LeadIntentNow = 'LOW';
  if (texts.length && STRONG.some((p) => norm(texts[texts.length - 1]).includes(norm(p)))) leadIntentNow = 'HIGH';
  else if (texts.length >= 2 && score >= 0.25) leadIntentNow = 'MEDIUM';
  reasons.push(`Estágio ${leadStage}`);
  return { leadScore: score, leadStage, leadIntentNow, reason: reasons.join('; ') };
}
