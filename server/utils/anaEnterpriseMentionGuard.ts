import type { EnterpriseRow } from '../repositories/enterpriseRepository.js';
import type { AnaEnterpriseResolution } from '../repositories/enterpriseMatch.js';
import { normText } from './anaTextNormalize.js';

export function buildNoEnterpriseResolvedReply(userMessage: string): string {
  void userMessage;
  return '';
}

export function buildAmbiguousEnterpriseReply(candidates: AnaEnterpriseResolution['candidates']): string {
  void candidates;
  return '';
}

const ANA_ENTERPRISE_NAME_GENERIC_TOKENS = new Set([
  'residencial',
  'empreendimento',
  'loteamento',
  'loteamentos',
  'condominio',
  'condominios',
  'edificio',
  'parque',
  'jardim',
  'village',
  'park',
  'club',
  'fase',
  'torre',
  'bloco',
]);

export function normalizeEnterpriseMentionGuardText(value: string): string {
  return normText(value)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function enterpriseMentionNeedles(enterpriseName: string): string[] {
  const normalizedName = normalizeEnterpriseMentionGuardText(enterpriseName);
  const needles = new Set<string>();
  if (normalizedName.length >= 4) needles.add(normalizedName);
  for (const token of normalizedName.split(/\s+/).filter(Boolean)) {
    if (token.length < 4) continue;
    if (ANA_ENTERPRISE_NAME_GENERIC_TOKENS.has(token)) continue;
    needles.add(token);
  }
  return Array.from(needles);
}

export function normalizedTextContainsNeedle(text: string, needle: string): boolean {
  if (!text || !needle) return false;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s)${escaped}(\\s|$)`).test(text);
}

export function findUnsupportedEnterpriseMentionInGlobalNoEnterpriseReply(params: {
  replyText: string;
  userMessage: string;
  activeEnterprises: EnterpriseRow[];
}): EnterpriseRow | null {
  const replyNorm = normalizeEnterpriseMentionGuardText(params.replyText);
  const userNorm = normalizeEnterpriseMentionGuardText(params.userMessage);
  if (!replyNorm) return null;
  for (const enterprise of params.activeEnterprises) {
    const needles = enterpriseMentionNeedles(enterprise.name);
    if (needles.length === 0) continue;
    const mentionedInReply = needles.some((needle) => normalizedTextContainsNeedle(replyNorm, needle));
    if (!mentionedInReply) continue;
    const mentionedByUser = needles.some((needle) => normalizedTextContainsNeedle(userNorm, needle));
    if (mentionedByUser) continue;
    return enterprise;
  }
  return null;
}
