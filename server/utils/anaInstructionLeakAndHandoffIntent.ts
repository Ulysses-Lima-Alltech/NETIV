import { normText } from './anaTextNormalize.js';

const HANDOFF_INTENT_REGEX_PATTERNS: RegExp[] = [
  /\bcorretor(?:a)?\b/,
  /\bconsultor(?:a)?\b/,
  /\bquero\s+corretor(?:a)?\b/,
  /\bquero\s+falar\s+com\s+(?:um|uma)?\s*(?:corretor(?:a)?|consultor(?:a)?)\b/,
  /\bfalar\s+com\s+(?:um|uma)?\s*(?:corretor(?:a)?|consultor(?:a)?)\b/,
  /\bme\s+(?:passa|encaminha|transfere)\s+(?:pra|para)?\s*(?:um|uma)?\s*(?:corretor(?:a)?|consultor(?:a)?)\b/,
  /\batendimento\s+humano\b/,
  /\bquero\s+falar\s+com\s+(?:uma)?\s*pessoa\b/,
];

export function containsForbiddenMissingDetailFallbackText(text: string): boolean {
  const n = normText(text || '');
  if (!n) return false;
  const patterns = [
    new RegExp(['nao tenho esse', 'detalhe confirmado', 'por aqui'].join('\\s+')),
    new RegExp([
      ['o', 'corretor', 'consegue'].join('\\s+'),
      ['te', 'passar'].join('\\s+'),
      'certinho',
    ].join('\\s+')),
    new RegExp(['quer que eu te', 'encaminhe ou prefere', 'agendar uma visita'].join('\\s+')),
  ];
  return patterns.some((pattern) => pattern.test(n));
}

export function normalizeIntentText(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function toFirstName(value: string | null | undefined): string | null {
  const raw = (value || '').trim();
  if (!raw) return null;
  const first = raw.split(/\s+/)[0]?.trim() || '';
  return first.length >= 2 ? first : null;
}

export function isWeakEntregaAnswer(text: string): boolean {
  const n = normText(text || '');
  if (!n) return true;
  if (/^previs[aã]o de entrega\s*:?\s*$/.test(n)) return true;
  if (/^a previs[aã]o de entrega\s*:?\s*$/.test(n)) return true;
  return false;
}

const ANA_INTERNAL_LEAK_PATTERNS: RegExp[] = [
  /finalizar com pergunta aberta e natural/i,
  /sem resposta fixa deterministica/i,
  /resposta fixa deterministica/i,
  /pergunta aberta e natural/i,
  /\bfinalizar com\b/i,
  /\binstrucao interna\b/i,
  /\bprompt\b/i,
  /\bsistema\b/i,
  /\bjson\b/i,
  /\bferramenta\b/i,
];

const ANA_INTERNAL_SANITIZE_PATTERNS: RegExp[] = [
  /finalizar\s+com\s+pergunta\s+aberta(?:\s+e\s+natural)?[,]?\s*/gi,
  /sem\s+resposta\s+fixa\s+determin[ií]stic[ao]\.?[,]?\s*/gi,
  /sem\s+resposta\s+fixa\s+determin[\wÃÂáàâãéêíóôõúç]*[,]?\s*/gi,
  /resposta\s+fixa\s+determin[ií]stic[ao]\.?[,]?\s*/gi,
  /resposta\s+fixa\s+determin[\wÃÂáàâãéêíóôõúç]*[,]?\s*/gi,
  /instrucao interna[,]?\s*/gi,
  /\bprompt\b[,]?\s*/gi,
  /\bsistema\b[,]?\s*/gi,
  /\bjson\b[,]?\s*/gi,
  /\bferramenta\b[,]?\s*/gi,
];

export function sanitizeInternalInstructionLeakText(text: string): { text: string; changed: boolean } {
  let out = text || '';
  for (const pattern of ANA_INTERNAL_SANITIZE_PATTERNS) out = out.replace(pattern, ' ');
  out = out.replace(/\s{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return { text: out, changed: out !== (text || '').trim() };
}

export function hasAnaInternalInstructionLeak(text: string): boolean {
  const normalized = normText(text || '');
  if (!normalized) return false;
  return ANA_INTERNAL_LEAK_PATTERNS.some((re) => re.test(normalized));
}

export function hasExplicitHandoffIntent(message: string): boolean {
  const normalized = normalizeIntentText(message);
  if (!normalized) return false;
  return HANDOFF_INTENT_REGEX_PATTERNS.some((re) => re.test(normalized));
}
