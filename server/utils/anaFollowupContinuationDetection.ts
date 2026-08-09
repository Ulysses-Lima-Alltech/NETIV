import { normText } from './anaTextNormalize.js';

export function looksLikeStandaloneNameReply(message: string): boolean {
  const t = (message || '').trim();
  if (!t || t.length > 40 || t.includes('?') || t.includes('@')) return false;
  return /^[\p{L}]+(?:\s+[\p{L}]+){0,2}$/u.test(t);
}

export function isAppointmentContextualQuestion(message: string): boolean {
  const n = normText(message);
  if (!n) return false;
  return (
    /\b(quem eu procuro|quem procuro|com quem falo|quem me atende)\b/.test(n) ||
    /\b(onde eu chego|onde chego|qual o endereco|qual endereco|qual o endereço|endereco|endereço)\b/.test(n) ||
    /\b(estacionamento|tem vaga|tem estacionamento)\b/.test(n)
  );
}

export function isShortGenericFollowUpMessage(message: string): boolean {
  const n = normText(message);
  if (!n) return false;
  if (n.length > 48) return false;
  return (
    n === 'sim' ||
    n === 'continua' ||
    /\b(quero mais detalhes|me fala mais|me fale mais|mais detalhes|quero saber mais|mais informacoes|mais informa[cç][aã]o)\b/.test(
      n
    )
  );
}

export function isAffirmativeShortReply(message: string): boolean {
  const n = normText(message).replace(/[.!?]+$/g, '').trim();
  return /^(sim|quero|quero sim|ok|pode ser|pode sim|claro|perfeito|fechado|ta bom|t[aá] bom)$/.test(n);
}

export function isPendingFollowupContinuationRequest(message: string): boolean {
  const n = normText(message);
  if (!n) return false;
  return (
    /\b(vc disse que ia falar mais|voce disse que ia falar mais|você disse que ia falar mais)\b/.test(n) ||
    /\b(fala mais|me explica melhor|voce falou que ia explicar|você falou que ia explicar|quero saber mais)\b/.test(n)
  );
}

export function extractFollowupTopicsFromAssistantQuestion(message: string | null | undefined): string[] {
  const raw = (message || '').trim();
  const n = normText(raw);
  if (!n || !/\?/.test(raw)) return [];
  const topics: string[] = [];
  if (/\b(lazer|area de lazer|areas de lazer|piscina|academia|playground|quadra)\b/.test(n)) topics.push('lazer');
  if (/\b(seguranca|portaria|controle de acesso|monitoramento)\b/.test(n)) topics.push('seguranca');
  if (/\b(localizacao|onde fica|bairro|regiao|acesso|endereco)\b/.test(n)) topics.push('localizacao');
  if (/\b(valores?|preco|quanto custa|r\$)\b/.test(n)) topics.push('valores');
  if (/\b(formas? de pagamento|pagamento|entrada|parcela|parcelamento|financiamento)\b/.test(n)) {
    topics.push('pagamento');
  }
  return [...new Set(topics)];
}

export function followupTopicLabel(topic: string): string {
  if (topic === 'lazer') return 'lazer';
  if (topic === 'seguranca') return 'seguranca';
  if (topic === 'localizacao') return 'localizacao';
  if (topic === 'valores') return 'valores';
  if (topic === 'formas_pagamento') return 'formas de pagamento';
  if (topic === 'pagamento') return 'formas de pagamento';
  return topic;
}
