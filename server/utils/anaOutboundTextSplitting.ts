import { normalizeAnaLocalTextForRules } from './anaEvoraGreetingAndFollowup.js';
import { sanitizeAnaClientVisibleReplyText } from './anaReplyFinalize.js';

export function countEvoraRegionCoreSignals(text: string): number {
  const n = normalizeAnaLocalTextForRules(text || '');
  if (!n) return 0;
  const checks = [
    /\batibaia\b/.test(n),
    /\bpedreira\b/.test(n) && /\brio abaixo\b/.test(n),
    /\bdom pedro i\b/.test(n),
    /\b50\b/.test(n) && /\bminutos\b/.test(n) && /\bsao paulo\b/.test(n),
    /\b(qualidade de vida|natureza|perfil mais tranquilo|contato com natureza)\b/.test(n),
  ];
  return checks.filter(Boolean).length;
}

export function dedupeMessageParts(parts: string[], logContext: { conversationId: number; stage: string }): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const accepted: string[] = [];

  const tokenize = (value: string): string[] =>
    normalizeAnaLocalTextForRules(value)
      .replace(/[.!?,;:()/\\[\]{}"'`´~^*+-]+/g, ' ')
      .split(/\s+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 3);

  const jaccard = (a: string[], b: string[]): number => {
    if (a.length === 0 || b.length === 0) return 0;
    const sa = new Set(a);
    const sb = new Set(b);
    let inter = 0;
    for (const token of sa) {
      if (sb.has(token)) inter += 1;
    }
    const union = new Set([...sa, ...sb]).size;
    return union === 0 ? 0 : inter / union;
  };

  const isNearDuplicate = (candidate: string, existing: string): boolean => {
    const cNorm = normalizeAnaLocalTextForRules(candidate).replace(/[.!?]+$/g, '').trim();
    const eNorm = normalizeAnaLocalTextForRules(existing).replace(/[.!?]+$/g, '').trim();
    if (!cNorm || !eNorm) return false;
    if (cNorm === eNorm) return true;
    if ((cNorm.includes(eNorm) || eNorm.includes(cNorm)) && Math.min(cNorm.length, eNorm.length) >= 24) {
      return true;
    }
    return jaccard(tokenize(cNorm), tokenize(eNorm)) >= 0.9;
  };

  for (const raw of parts) {
    const clean = (raw || '').trim();
    if (!clean) continue;
    const key = normalizeAnaLocalTextForRules(clean).replace(/[.!?]+$/g, '').trim();
    const regionCoreDuplicate = accepted.some((prev) => {
      const prevCore = countEvoraRegionCoreSignals(prev);
      const nextCore = countEvoraRegionCoreSignals(clean);
      return prevCore >= 4 && nextCore >= 4;
    });
    if (regionCoreDuplicate) {
      console.log('[ANA_REGION_DUPLICATE_MESSAGE_BLOCKED]', {
        conversationId: logContext.conversationId,
        blockedMessagePreview: clean.slice(0, 160),
      });
      continue;
    }
    if (seen.has(key) || accepted.some((prev) => isNearDuplicate(clean, prev))) {
      console.log('[ANA_DUPLICATE_RESPONSE_PART_SUPPRESSED]', {
        conversationId: logContext.conversationId,
        stage: logContext.stage,
        suppressedPreview: clean.slice(0, 120),
      });
      continue;
    }
    seen.add(key);
    accepted.push(clean);
    out.push(clean);
  }
  return out;
}

export function scrubClientVisibleBrandLeak(text: string): string {
  return String(text || '')
    .replace(/\bANA\s*[-–—]\s*NETIV\s*[-–—]\s*QMAPE\b/gi, 'Ana')
    .replace(/\bNETIV\s*[-–—]\s*QMAPE\b/gi, '')
    .replace(/\bQMAPE\s*[-–—]\s*NETIV\b/gi, '')
    .replace(/\bNETIV\b/gi, '')
    .replace(/\bQMAPE\b/gi, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function splitRhetoricalSeparatorsForWhatsApp(part: string): string[] {
  const source = scrubClientVisibleBrandLeak(part)
    .replace(/^[ \t]*[-–—]\s+/gm, '')
    .trim();
  if (!source) return [];
  const pieces: string[] = [];
  let current = '';
  const separator = /\s+(?:—|–|-)\s+/g;
  let lastIndex = 0;
  for (const match of source.matchAll(separator)) {
    const before = source.slice(lastIndex, match.index).trim();
    const afterStart = (match.index ?? 0) + match[0].length;
    if (current) current = `${current} ${before}`.trim();
    else current = before;
    const nextSeparatorIndex = source.slice(afterStart).search(separator);
    const after =
      nextSeparatorIndex >= 0
        ? source.slice(afterStart, afterStart + nextSeparatorIndex).trim()
        : source.slice(afterStart).trim();
    const leftIsShortOpener = current.length <= 16 && /^\p{L}+\.?$/u.test(current);
    if (leftIsShortOpener && after) {
      current = `${current.replace(/[.]$/g, '')},`;
    } else if (current) {
      pieces.push(current);
      current = '';
    }
    lastIndex = afterStart;
  }
  const tail = source.slice(lastIndex).trim();
  const finalPiece = [current, tail].filter(Boolean).join(' ').replace(/\s+,/g, ',').trim();
  if (finalPiece) pieces.push(finalPiece);
  return pieces.length > 0 ? pieces : [source];
}

export function startsWithLowercaseLetter(text: string): boolean {
  if (/^https?:\/\//i.test(String(text || '').trim())) return false;
  const first = String(text || '').trim().match(/\p{L}/u)?.[0] ?? '';
  return Boolean(first && first === first.toLocaleLowerCase('pt-BR') && first !== first.toLocaleUpperCase('pt-BR'));
}

export function uppercaseFirstLetter(text: string): string {
  const raw = String(text || '').trim();
  const match = raw.match(/\p{L}/u);
  if (!match || match.index == null) return raw;
  const idx = match.index;
  return `${raw.slice(0, idx)}${match[0].toLocaleUpperCase('pt-BR')}${raw.slice(idx + match[0].length)}`;
}

export function isShortOpeningPart(text: string): boolean {
  const clean = String(text || '').trim();
  const withoutPunctuation = clean.replace(/[.!?]+$/g, '').trim();
  if (!withoutPunctuation) return false;
  if (withoutPunctuation.length > 32 || withoutPunctuation.split(/\s+/).length > 4) return false;
  return /^(entendo|perfeito|certo|claro|legal|ótimo|otimo|faz sentido|combinado|sim|ok)\b/i.test(withoutPunctuation);
}

export function repairAnaOutboundSplitParts(parts: string[]): string[] {
  const out: string[] = [];
  for (const raw of parts) {
    const part = sanitizeAnaClientVisibleReplyText(raw);
    if (!part) continue;
    if (out.length === 0 && startsWithLowercaseLetter(part)) {
      out.push(uppercaseFirstLetter(part));
      continue;
    }
    if (out.length > 0 && startsWithLowercaseLetter(part)) {
      const previous = out[out.length - 1] ?? '';
      if (isShortOpeningPart(previous)) {
        out[out.length - 1] = `${previous.replace(/[.!?]+$/g, '')}, ${part}`.replace(/\s{2,}/g, ' ').trim();
        continue;
      }
      out.push(uppercaseFirstLetter(part));
      continue;
    }
    out.push(part);
  }
  return out;
}

export function splitAnaOutboundMessages(text: string): string[] {
  const rawParts = String(text || '')
    .split(/\r?\n+/)
    .flatMap((part) => splitRhetoricalSeparatorsForWhatsApp(part))
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return repairAnaOutboundSplitParts(rawParts);
}
