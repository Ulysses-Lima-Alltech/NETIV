/**
 * Pré-detecção de fluxo de agendamento (antes do LLM).
 * Evita triagem genérica e fallback de incompreensão quando a intenção já está no histórico.
 */

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const SCHEDULE_SNIPPETS = [
  'agendar',
  'marcar visita',
  'marcar uma visita',
  'quero visita',
  'agendamento',
  'agendar visita',
  'reservar visita',
  'confirmar visita',
  'confirmar o horario',
  'confirmar horario',
  'confirmar horário',
  'marcar um horario',
  'marcar um horário',
  'combinar visita',
  'visita no ',
  'visita na ',
  'visita para ',
];

const RESCHEDULE_SNIPPETS = [
  'mudar agendamento',
  'mudar o agendamento',
  'mudar visita',
  'mudar o horario',
  'mudar horario',
  'mudar horário',
  'alterar agendamento',
  'alterar horario',
  'alterar horário',
  'alterar visita',
  'alterar o horario',
  'trocar horario',
  'trocar horário',
  'trocar a visita',
  'remarcar',
  'reagendar',
  'adiar',
  'outro horario',
  'outro horário',
  'mudar para ',
  'passar para ',
];

/** Junta falas recentes do usuário (inclui rajada atual já persistida em `rows`). */
export function buildUserUtterancesContext(
  rows: { role: string; content: string | null }[],
  maxLines = 16
): string {
  const lines = rows
    .filter((r) => r.role === 'user' && (r.content || '').trim())
    .map((r) => (r.content || '').trim());
  return lines.slice(-maxLines).join('\n');
}

export function detectScheduleIntent(n: string): boolean {
  return SCHEDULE_SNIPPETS.some((p) => n.includes(p));
}

export function detectRescheduleIntent(n: string): boolean {
  return RESCHEDULE_SNIPPETS.some((p) => n.includes(p));
}

/** Indícios de tópico visita/agenda no texto (histórico + atual). */
export function hasAppointmentTopicHint(n: string): boolean {
  return /\b(agendar|visita|marcar|horario|horário|agendamento|confirmar|combinar)\b/.test(n);
}

const TIMEISH =
  /\b(\d{1,2}h\b|\d{1,2}:\d{2}|amanha\b|hoje\b|segunda|terca|terça|quarta|quinta|sexta|sabado|sábado|domingo)\b/;

/** Mensagem curta só com data/hora (complemento típico ao pedido de visita). */
export function looksLikeTimeOrDateFragment(n: string): boolean {
  if (n.length > 96) return false;
  return TIMEISH.test(n);
}

/** Cliente contesta ou pede correção de data (continuação do fluxo, não triagem). */
export function detectDateContestation(n: string): boolean {
  const x = norm(n);
  if (/\b(data|dia)\s+(errad|incorret)/.test(x)) return true;
  if (/\bainda\s+estamos\s+em\s+/.test(x)) return true;
  if (/\bque\s+dia\s+e\s+(segunda|terca|quarta|quinta|sexta|sabado|domingo)/.test(x)) return true;
  if (/\bque\s+dia\s+seria\s+/.test(x)) return true;
  if (/\bnao\s+e\s+esse\s+dia\b/.test(x) || /\bnao\s+e\s+a\s+data\b/.test(x)) return true;
  if (/\bessa\s+data\s+/.test(x) && /\b(errad|errado)/.test(x)) return true;
  if (/\bvoce\s+(errou|confundiu)/.test(x)) return true;
  if (/\bnao\s+quis\s+dizer\s+(terca|segunda|quarta|quinta|sexta|sabado)/.test(x)) return true;
  if (/\bmes\s+errad/.test(x)) return true;
  return false;
}

export interface AppointmentPreflight {
  /** Fluxo de agendamento ativo — não tratar como triagem “fria” nem usar fallback genérico. */
  active: boolean;
  /** Cliente pediu mudança de horário/data. */
  reschedule: boolean;
  /** Só complemento (ex.: “amanhã às 14h”) com contexto anterior de visita. */
  continuationOnly: boolean;
  /** Cliente questiona/corrige data (“ainda estamos em março?”, “essa data está errada”). */
  dateContestation: boolean;
}

/**
 * `fullUserContext`: últimas falas do usuário concatenadas (inclui mensagem atual).
 * `currentTrimmed`: mensagem (ou rajada fundida) que está sendo processada.
 */
export function computeAppointmentPreflight(
  currentTrimmed: string,
  fullUserContext: string
): AppointmentPreflight {
  const full = norm(fullUserContext);
  const cur = norm(currentTrimmed);
  const reschedule = detectRescheduleIntent(full);
  const schedule = detectScheduleIntent(full);
  const topic = hasAppointmentTopicHint(full);
  const timeFragment = looksLikeTimeOrDateFragment(cur);
  const dateContestation = detectDateContestation(cur) || detectDateContestation(full);
  const continuationOnly =
    timeFragment &&
    topic &&
    !detectScheduleIntent(cur) &&
    !detectRescheduleIntent(cur) &&
    full.length > cur.length;

  const active = Boolean(
    schedule ||
      reschedule ||
      continuationOnly ||
      dateContestation ||
      (topic && !looksLikeTimeOrDateFragment(cur))
  );

  return {
    active,
    reschedule,
    continuationOnly,
    dateContestation,
  };
}

/** Resposta estável quando o JSON falhou mas o fluxo é claramente de agendamento. */
export const ANA_FALLBACK_APPOINTMENT_FLOW_REPLY =
  '';

/** Quando já há contexto de visita ou contestação de data — não reiniciar triagem. */
export const ANA_FALLBACK_APPOINTMENT_CONTINUATION_REPLY =
  '';
