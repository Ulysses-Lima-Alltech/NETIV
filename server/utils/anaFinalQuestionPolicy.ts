export type AnaCommittedQuestionType =
  | 'contextual_followup'
  | 'broker_or_visit_offer'
  | 'visit_offer'
  | 'broker_offer'
  | 'clarification'
  | null;

export interface AnaFinalQuestionCheckResult {
  hasFinalQuestion: boolean;
  repeatedQuestion: boolean;
  forbiddenQuestion: boolean;
  lastAssistantQuestionText: string | null;
  reasons: string[];
}

const FINAL_QUESTION_FORBIDDEN_PATTERNS: RegExp[] = [
  /\bmorar,\s*investir\s*ou\s*construir\b/,
  /\btem algum ponto especifico que voce quer que eu detalhe melhor\??/,
  /\bme conta,?\s*qual ponto voce quer entender primeiro\??/,
  /\bdesculpe,\s*parece que sua resposta nao esta clara\b/,
  /\bencaminhamento para o corretor responsavel ou agendamento de visita\b/,
  /\bvoce quer ver valores, entrada, pagamento, localizacao ou visita\??/,
];

const QUESTION_WORD_START_PATTERN =
  /^(voce|voces|qual|quais|quando|onde|como|quanto|quantos|tem|ha|prefere|quer|pode|posso|gostaria|me fala|me conta)\b/;
const BROKER_PATTERN = /\b(corretor|consultor|atendimento humano|atendente|encaminh)\b/;
const VISIT_PATTERN = /\b(visita|agendar|agendamento|marcar visita|conhecer o stand|ir ate o local)\b/;

const QUESTION_STOPWORDS = new Set([
  'a',
  'ao',
  'aos',
  'as',
  'com',
  'da',
  'das',
  'de',
  'do',
  'dos',
  'e',
  'em',
  'na',
  'nas',
  'no',
  'nos',
  'o',
  'os',
  'ou',
  'para',
  'por',
  'que',
  'se',
  'te',
  'um',
  'uma',
  'voce',
  'voces',
]);

function norm(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeForSimilarity(value: string): string[] {
  return norm(value)
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 2 && !QUESTION_STOPWORDS.has(token));
}

function splitSentenceLikeParts(text: string): string[] {
  const compact = String(text ?? '').replace(/\r/g, '').replace(/\n+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  if (!compact) return [];
  const parts = compact.match(/[^.!?]+[.!?]?/g);
  return (parts ?? [compact]).map((part) => part.trim()).filter(Boolean);
}

function isInterrogativeWithoutQuestionMark(sentence: string): boolean {
  const raw = String(sentence ?? '').trim();
  if (!raw) return false;
  if (/\?$/.test(raw)) return true;
  return QUESTION_WORD_START_PATTERN.test(norm(raw));
}

function sanitizeQuestionTail(question: string): string {
  const raw = String(question ?? '').trim();
  if (!raw) return raw;
  return raw.replace(/\s{2,}/g, ' ').trim();
}

export function extractLastQuestionSentenceFromReply(text: string): string | null {
  const raw = String(text ?? '').trim();
  if (!raw) return null;

  const explicitQuestionParts = splitSentenceLikeParts(raw).filter((part) => /\?/.test(part));
  const explicitLast = explicitQuestionParts[explicitQuestionParts.length - 1] ?? null;
  if (explicitLast) return sanitizeQuestionTail(explicitLast);

  const parts = splitSentenceLikeParts(raw);
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const current = parts[i] ?? '';
    if (!current) continue;
    if (!isInterrogativeWithoutQuestionMark(current)) continue;
    const trimmed = current.replace(/[.!]+$/g, '').trim();
    if (!trimmed) continue;
    return `${trimmed}?`;
  }
  return null;
}

export function inferCommittedQuestionType(questionText: string | null): AnaCommittedQuestionType {
  const normalized = norm(questionText ?? '');
  if (!normalized) return null;

  const hasBroker = BROKER_PATTERN.test(normalized);
  const hasVisit = VISIT_PATTERN.test(normalized);

  if (hasBroker && hasVisit) return 'broker_or_visit_offer';
  if (hasVisit) return 'visit_offer';
  if (hasBroker) return 'broker_offer';
  if (QUESTION_WORD_START_PATTERN.test(normalized)) return 'contextual_followup';
  return 'clarification';
}

export function mergeRecentQuestions(
  existingQuestions: string[] | null | undefined,
  nextQuestion: string | null,
  limit = 8
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const question of existingQuestions ?? []) {
    const text = String(question ?? '').trim();
    const key = norm(text);
    if (!key || seen.has(key)) continue;
    out.push(text);
    seen.add(key);
  }

  if (nextQuestion) {
    const text = String(nextQuestion).trim();
    const key = norm(text);
    if (key && !seen.has(key)) {
      out.push(text);
      seen.add(key);
    }
  }

  if (out.length <= limit) return out;
  return out.slice(out.length - limit);
}

export function isForbiddenFinalQuestion(questionText: string | null): boolean {
  const normalized = norm(questionText ?? '');
  if (!normalized) return false;
  return FINAL_QUESTION_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function questionsAreEquivalent(a: string | null | undefined, b: string | null | undefined): boolean {
  const normA = norm(a);
  const normB = norm(b);
  if (!normA || !normB) return false;
  if (normA === normB) return true;
  if (normA.includes(normB) || normB.includes(normA)) {
    const minLen = Math.min(normA.length, normB.length);
    if (minLen >= 24) return true;
  }

  const tokensA = new Set(tokenizeForSimilarity(normA));
  const tokensB = new Set(tokenizeForSimilarity(normB));
  if (tokensA.size === 0 || tokensB.size === 0) return false;

  let intersection = 0;
  for (const token of tokensA) if (tokensB.has(token)) intersection += 1;
  const union = tokensA.size + tokensB.size - intersection;
  if (union <= 0) return false;
  const jaccard = intersection / union;
  return jaccard >= 0.74;
}

function hasQuestionAtTail(replyText: string): boolean {
  const raw = String(replyText ?? '').trim();
  if (!raw) return false;
  return /\?\s*$/.test(raw);
}

export function evaluateFinalQuestionCheck(args: {
  replyText: string;
  recentQuestions?: string[] | null;
}): AnaFinalQuestionCheckResult {
  const lastAssistantQuestionText = extractLastQuestionSentenceFromReply(args.replyText);
  const hasFinalQuestion = hasQuestionAtTail(args.replyText) && lastAssistantQuestionText != null;
  const forbiddenQuestion = isForbiddenFinalQuestion(lastAssistantQuestionText);

  const recent = (args.recentQuestions ?? []).map((question) => String(question ?? '').trim()).filter(Boolean);
  const repeatedQuestion =
    lastAssistantQuestionText != null
      ? recent.some((previous) => questionsAreEquivalent(previous, lastAssistantQuestionText))
      : false;

  const reasons: string[] = [];
  if (!hasFinalQuestion) reasons.push('missing_final_question');
  if (repeatedQuestion) reasons.push('repeated_final_question');
  if (forbiddenQuestion) reasons.push('forbidden_final_question');

  return {
    hasFinalQuestion,
    repeatedQuestion,
    forbiddenQuestion,
    lastAssistantQuestionText,
    reasons,
  };
}
