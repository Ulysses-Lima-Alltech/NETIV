import { getDb } from '../db/index.js';
import { getMessagesByConversationId } from '../repositories/messageRepository.js';

const MAX_MESSAGES_TO_ANALYZE = 20;

/**
 * Busca últimas mensagens inbound da conversa, analisa e persiste lead_stage/score/intent.
 */
export function analyzeLead(conversationId: number): void {
  const rows = getMessagesByConversationId(conversationId);
  const inboundTexts = rows
    .filter((m) => m.direction === 'inbound')
    .slice(-MAX_MESSAGES_TO_ANALYZE)
    .map((m) => m.content || m.body_text || '');
  const result = computeLeadAnalysis(inboundTexts);
  const db = getDb();
  db.prepare(
    `UPDATE conversations SET
      lead_stage = ?, lead_score = ?, lead_intent_now = ?, lead_reason = ?, lead_last_analyzed_at = datetime('now')
     WHERE id = ?`
  ).run(result.leadStage, result.leadScore, result.leadIntentNow, result.reason, conversationId);
}

export type LeadStage = 'COLD' | 'WARM' | 'HOT';
export type LeadIntentNow = 'LOW' | 'MEDIUM' | 'HIGH';

const INTEREST_TERMS = [
  'preço',
  'valor',
  'quanto custa',
  'orçamento',
  'contratar',
  'fechar',
  'pagar',
  'plano',
  'assinatura',
  'proposta',
];

const STRONG_INTENT_PHRASES = [
  'quero contratar',
  'vamos fechar',
  'quero pagar',
  'manda proposta',
];

const MESSAGE_COUNT_BONUS_THRESHOLD = 5;
const MESSAGE_COUNT_BONUS = 0.1;
const INTEREST_TERM_SCORE = 0.25;
const STRONG_INTENT_SCORE = 0.5;

function normalize(text: string): string {
  return text.toLowerCase().trim().normalize('NFD').replace(/\p{Diacritic}/gu, '');
}

function messageContainsInterestTerms(text: string): boolean {
  const n = normalize(text);
  return INTEREST_TERMS.some((t) => n.includes(normalize(t)));
}

function messageContainsStrongIntent(text: string): boolean {
  const n = normalize(text);
  return STRONG_INTENT_PHRASES.some((p) => n.includes(normalize(p)));
}

export interface LeadAnalysisResult {
  leadScore: number;
  leadStage: LeadStage;
  leadIntentNow: LeadIntentNow;
  reason: string;
}

/**
 * Analisa uma lista de textos de mensagens (inbound) e retorna classificação.
 * Determinístico e rápido.
 */
export function computeLeadAnalysis(messages: string[]): LeadAnalysisResult {
  const texts = messages.map((m) => (m || '').trim()).filter(Boolean);
  let score = 0;
  const reasons: string[] = [];

  for (const text of texts) {
    if (messageContainsInterestTerms(text)) {
      score += INTEREST_TERM_SCORE;
    }
    if (messageContainsStrongIntent(text)) {
      score += STRONG_INTENT_SCORE;
    }
  }

  if (texts.length > MESSAGE_COUNT_BONUS_THRESHOLD) {
    score += MESSAGE_COUNT_BONUS;
    reasons.push(`+${MESSAGE_COUNT_BONUS} (>${MESSAGE_COUNT_BONUS_THRESHOLD} msgs)`);
  }

  score = Math.min(1, Math.round(score * 100) / 100);

  let leadStage: LeadStage = 'COLD';
  if (score >= 0.7) leadStage = 'HOT';
  else if (score >= 0.4) leadStage = 'WARM';
  reasons.push(`Estágio ${leadStage} (score ${score})`);

  let leadIntentNow: LeadIntentNow = 'LOW';
  const lastText = texts[texts.length - 1] || '';
  if (texts.length > 0 && messageContainsStrongIntent(lastText)) {
    leadIntentNow = 'HIGH';
    reasons.push('Intenção HIGH: última msg com intenção de compra');
  } else if (texts.length >= 2 && score >= 0.25) {
    leadIntentNow = 'MEDIUM';
    reasons.push('Intenção MEDIUM: conversa ativa com interesse');
  } else {
    reasons.push('Intenção LOW');
  }

  const reason = reasons.join('; ') || 'Análise heurística';

  return {
    leadScore: score,
    leadStage,
    leadIntentNow,
    reason,
  };
}
