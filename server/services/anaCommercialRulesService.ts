import { ANA_COMMERCIAL_RULES, type AnaCommercialIntent } from '../config/anaCommercialRules.js';

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitCommercialRuleMessages(lines: readonly string[]): string[] {
  return lines
    .map((line) => line.trim())
    .filter(Boolean);
}

export function isEvoraEnterpriseName(enterpriseName: string | null | undefined): boolean {
  const n = normalizeText(enterpriseName);
  return n === ANA_COMMERCIAL_RULES.enterpriseKey || n.includes(ANA_COMMERCIAL_RULES.enterpriseKey);
}

export function isVisitSchedulingRefusal(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  return /\b(nao quero agendar|nao quero visita|nao quero marcar|nao quero horario|nao quero isso|ja falei|so quero detalhes|quero detalhes|me passa os detalhes|quero saber dos lotes|quero lote plano|lotes planos)\b/.test(n);
}

export function isUserIrritated(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  return /\b(ta doida|caramba|ja falei|nao e isso|vc nao entendeu|voce nao entendeu)\b/.test(n);
}

export function shouldUseShortRecoveryPrompt(userMessage: string): boolean {
  const n = normalizeText(userMessage);
  return n.length <= 5 || /\b(ta|oi|ok|hm|aff)\b/.test(n);
}

function detectIntent(userMessage: string): Exclude<AnaCommercialIntent, 'first_contact'> | null {
  const n = normalizeText(userMessage);
  if (!n) return null;

  if (/\b(metro quadrado|m2|m\u00b2|valor do metro|preco do metro)\b/.test(n)) return 'valor_metro_quadrado';
  if (/\b(tipo de lote|tipos de lote|lotes planos|lote plano|detalhes do lote|detalhes de lote|opcoes de lote|opcoes de lotes|metragem|quero detalhes|quero mais detalhes)\b/.test(n)) return 'detalhes_lotes';
  if (/\b(visita|visitar|stand|conhecer o empreendimento)\b/.test(n)) return 'oferta_visita';
  if (/\b(tem plano|planos|pagamento|parcelamento|parcelas|financiamento|juros|120x|48x)\b/.test(n)) return 'formas_pagamento';
  if (/\b(localizacao|regiao|atibaia|bragantina|sao paulo|dom pedro|lucas nogueira)\b/.test(n)) return 'localizacao_regiao';
  if (/\b(endereco|onde fica|bairro|rio abaixo|pedreira)\b/.test(n)) return 'endereco';
  if (/\b(invest|valorizacao|rentabilidade|retorno)\b/.test(n)) return 'investimento';
  if (/\b(condominio|valor do condominio|taxa condominial)\b/.test(n)) return 'valor_condominio';
  if (/\b(lazer|piscina|academia|playground|coworking|beach tennis|campo society|fireplace|espaco zen)\b/.test(n)) return 'areas_lazer';

  return null;
}

export type ResolvedAnaCommercialRule = {
  ruleId: AnaCommercialIntent;
  messages: string[];
  replySource: 'commercial_rules_first_contact' | 'commercial_rules_intent';
};

export function resolveAnaCommercialRule(params: {
  enterpriseName: string | null | undefined;
  userMessage: string;
  isFirstAnaReply: boolean;
}): ResolvedAnaCommercialRule | null {
  if (!isEvoraEnterpriseName(params.enterpriseName)) return null;

  if (params.isFirstAnaReply) {
    return {
      ruleId: 'first_contact',
      messages: splitCommercialRuleMessages(ANA_COMMERCIAL_RULES.firstContactMessages),
      replySource: 'commercial_rules_first_contact',
    };
  }

  const intent = detectIntent(params.userMessage);
  if (!intent) return null;

  return {
    ruleId: intent,
    messages: splitCommercialRuleMessages(ANA_COMMERCIAL_RULES.byIntent[intent]),
    replySource: 'commercial_rules_intent',
  };
}

export function resolveAnaCommercialFollowupMessage(params: {
  enterpriseName: string | null | undefined;
  cycleCount: number;
}): string | null {
  if (!isEvoraEnterpriseName(params.enterpriseName)) return null;
  const idx = Math.max(0, Math.min(params.cycleCount, ANA_COMMERCIAL_RULES.followupWhileNoResponseMessages.length - 1));
  return ANA_COMMERCIAL_RULES.followupWhileNoResponseMessages[idx] ?? null;
}

export function computeCommercialFollowupEligibleAtUtc(lastUserMessageAt: Date, cycleCount: number): Date | null {
  if (cycleCount < 0 || cycleCount >= ANA_COMMERCIAL_RULES.followupWhileNoResponseMessages.length) {
    return null;
  }
  const minuteOffset = cycleCount + 1;
  return new Date(lastUserMessageAt.getTime() + minuteOffset * 60_000);
}
