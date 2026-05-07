import {
  APPOINTMENT_BUSINESS_TZ,
  getJsWeekdayForYmdInSaoPaulo,
  parseAppointmentStartEndInSaoPaulo,
} from './appointmentDateNormalize.js';
import type { CommercialFlowState } from './commercialFlowState.js';

const SP_OFFSET = '-03:00';
export const VISIT_WINDOW_START_MINUTES = 6 * 60 + 30;
export const VISIT_WINDOW_END_MINUTES = 19 * 60 + 30;
export const VISIT_WINDOW_REPLY = 'Pode ser entre 6h30 e 19h30.';

const PROHIBITED_VISIT_SCHEDULING_PHRASES = [
  'assim que o corretor confirmar',
  'quando o corretor confirmar',
  'corretor confirmar',
  'confirmar o horario disponivel',
  'vou verificar com o corretor',
  'verificar com o corretor',
  'voce recebe o retorno',
  'recebe o retorno aqui',
  'em breve entraremos em contato',
  'vou sinalizar seu interesse para o plantao',
  'assim que houver disponibilidade',
];

export interface DirectVisitSchedulingDecision {
  handled: boolean;
  reply: string | null;
  reason: string;
  pendingVisitScheduling: boolean;
  extractedDateLabel: string | null;
  extractedDateYmd: string | null;
  extractedTime: string | null;
  nextState: CommercialFlowState;
  appointmentConfirmed: boolean;
  appointmentDateYmd: string | null;
  appointmentTimeHm: string | null;
}

export interface DirectVisitSchedulingInput {
  userMessage: string;
  flowState: CommercialFlowState;
  resolvedIntent?: string | null;
  primaryAxis?: string | null;
  currentAxis?: string | null;
  requestedAxis?: string | null;
  lastAssistantMessage?: string | null;
  enterpriseId: number | null;
  referenceNow?: Date;
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function timeHmToMinutes(timeHm: string): number | null {
  const [hhRaw, mmRaw] = timeHm.split(':');
  const hh = parseInt(hhRaw ?? '', 10);
  const mm = parseInt(mmRaw ?? '', 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}

function formatYmdInSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APPOINTMENT_BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function addDaysYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00${SP_OFFSET}`);
  d.setTime(d.getTime() + days * 86400000);
  return formatYmdInSaoPaulo(d);
}

function nextYmdForWeekday(startYmd: string, targetJsDay: number): string {
  for (let add = 0; add <= 21; add += 1) {
    const ymd = addDaysYmd(startYmd, add);
    if (getJsWeekdayForYmdInSaoPaulo(ymd) === targetJsDay) return ymd;
  }
  return startYmd;
}

function weekdayTokenToJsDay(token: string): number | null {
  const t = norm(token);
  if (t.startsWith('domingo')) return 0;
  if (t.startsWith('segunda')) return 1;
  if (t.startsWith('terca')) return 2;
  if (t.startsWith('quarta')) return 3;
  if (t.startsWith('quinta')) return 4;
  if (t.startsWith('sexta')) return 5;
  if (t.startsWith('sabado')) return 6;
  return null;
}

function parseTimeHmFromText(text: string): string | null {
  const n = norm(text);
  type Hit = { i: number; hm: string };
  const hits: Hit[] = [];
  let re: RegExp;
  let m: RegExpExecArray | null;

  re = /\bas\s+(\d{1,2})(?:h(\d{2})|\s*:\s*(\d{2}))?\b/g;
  while ((m = re.exec(n)) !== null) {
    const hh = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : m[3] ? parseInt(m[3], 10) : 0;
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) hits.push({ i: m.index, hm: `${pad2(hh)}:${pad2(mm)}` });
  }

  re = /\b(\d{1,2})h(\d{2})\b/g;
  while ((m = re.exec(n)) !== null) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) hits.push({ i: m.index, hm: `${pad2(hh)}:${pad2(mm)}` });
  }

  re = /\b(\d{1,2})h\b/g;
  while ((m = re.exec(n)) !== null) {
    const hh = parseInt(m[1], 10);
    if (hh >= 0 && hh <= 23) hits.push({ i: m.index, hm: `${pad2(hh)}:00` });
  }

  re = /\b(\d{1,2}):(\d{2})\b/g;
  while ((m = re.exec(n)) !== null) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) hits.push({ i: m.index, hm: `${pad2(hh)}:${pad2(mm)}` });
  }

  if (hits.length === 0) return null;
  hits.sort((a, b) => a.i - b.i);
  return hits[hits.length - 1].hm;
}

function parseDateMention(text: string, referenceNow: Date): { label: string; ymd: string } | null {
  const n = norm(text);
  const today = formatYmdInSaoPaulo(referenceNow);

  if (/\bdepois de amanha\b/.test(n)) return { label: 'depois de amanhã', ymd: addDaysYmd(today, 2) };
  if (/\bamanha\b/.test(n)) return { label: 'amanhã', ymd: addDaysYmd(today, 1) };
  if (/\bhoje\b/.test(n)) return { label: 'hoje', ymd: today };

  const explicit = n.match(/\b(\d{1,2})[\/.-](\d{1,2})(?:[\/.-](\d{2,4}))?\b/);
  if (explicit) {
    const day = parseInt(explicit[1], 10);
    const month = parseInt(explicit[2], 10);
    const todayYear = parseInt(today.slice(0, 4), 10);
    let year = explicit[3] ? parseInt(explicit[3], 10) : todayYear;
    if (year < 100) year += 2000;
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      const ymd = `${year}-${pad2(month)}-${pad2(day)}`;
      return { label: `${pad2(day)}/${pad2(month)}`, ymd };
    }
  }

  const wd = n.match(/\b(domingo|segunda(?: feira)?|terca(?: feira)?|quarta(?: feira)?|quinta(?: feira)?|sexta(?: feira)?|sabado)\b/);
  if (wd) {
    const jsDay = weekdayTokenToJsDay(wd[1]);
    if (jsDay != null) return { label: wd[1], ymd: nextYmdForWeekday(today, jsDay) };
  }

  return null;
}

function isAckOnly(text: string): boolean {
  const n = norm(text).replace(/[.,;:!?]+/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(sim|ok|ta|tá|certo|beleza|perfeito|combinado|aguardo|fico no aguardo|ok aguardo|ok aguardo agendamento|aguardo agendamento|pode ser|pode sim)$/.test(n);
}

function hasVisitSchedulingWords(text: string): boolean {
  const n = norm(text);
  return /\b(agendar|agendamento|agenda|marcar|visita|visitar|conhecer pessoalmente)\b/.test(n);
}

function lastAssistantInvitedVisit(text: string | null | undefined): boolean {
  const n = norm(text ?? '');
  return /\b(agendar|marcar|visita|conhecer pessoalmente)\b/.test(n) && /\b(interesse|qual dia|dia e horario|horario)\b/.test(n);
}

export function isVisitSchedulingIntent(input: DirectVisitSchedulingInput): boolean {
  const axes = [input.resolvedIntent, input.primaryAxis, input.currentAxis, input.requestedAxis]
    .map((x) => norm(String(x ?? '')))
    .filter(Boolean);
  if (axes.some((x) => x === 'visita_agendamento' || x === 'agendar')) return true;
  if (input.flowState.pendingVisitScheduling === true) return true;
  if (hasVisitSchedulingWords(input.userMessage)) return true;
  if (isAckOnly(input.userMessage) && lastAssistantInvitedVisit(input.lastAssistantMessage)) return true;
  return false;
}

export function isDirectVisitSchedulingWindow(now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APPOINTMENT_BUSINESS_TZ,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? '';
  const hour = parseInt(parts.find((p) => p.type === 'hour')?.value ?? '', 10);
  const minute = parseInt(parts.find((p) => p.type === 'minute')?.value ?? '', 10);
  const isSunday = weekday.toLowerCase().startsWith('sun');
  const minutes = hour * 60 + minute;
  return (
    !isSunday &&
    Number.isFinite(minutes) &&
    minutes >= VISIT_WINDOW_START_MINUTES &&
    minutes <= VISIT_WINDOW_END_MINUTES
  );
}

export function isAllowedVisitSlot(dateYmd: string, timeHm: string): boolean {
  const parsed = parseAppointmentStartEndInSaoPaulo(dateYmd, timeHm);
  if (!parsed) return false;
  const weekday = getJsWeekdayForYmdInSaoPaulo(dateYmd);
  if (weekday === 0) return false;
  const minutes = timeHmToMinutes(timeHm);
  return (
    minutes != null &&
    minutes >= VISIT_WINDOW_START_MINUTES &&
    minutes <= VISIT_WINDOW_END_MINUTES
  );
}

function askTimeReply(label: string | null): string {
  if (label) return `Perfeito. Qual horário você prefere ${label}? ${VISIT_WINDOW_REPLY}`;
  return `Perfeito. Qual horário você prefere para a visita? ${VISIT_WINDOW_REPLY}`;
}

function pendingAskTimeReply(label: string | null): string {
  if (label) return `Só preciso que você me diga o horário para agendar sua visita para ${label}. ${VISIT_WINDOW_REPLY}`;
  return 'Só preciso que você me diga o horário para agendar sua visita.';
}

function askDayReply(): string {
  return 'Perfeito. Para qual dia você prefere agendar a visita?';
}

function confirmReply(label: string | null, timeHm: string): string {
  const hh = parseInt(timeHm.slice(0, 2), 10);
  const mm = timeHm.slice(3, 5);
  const displayTime = mm === '00' ? `${hh}h` : `${hh}h${mm}`;
  return `Perfeito, sua visita ficou agendada para ${label ?? 'o dia escolhido'} às ${displayTime}.`;
}

function buildPendingState(
  prev: CommercialFlowState,
  patch: {
    pending: boolean;
    dateLabel: string | null;
    dateYmd: string | null;
    enterpriseId: number | null;
  }
): CommercialFlowState {
  return {
    ...prev,
    pendingVisitScheduling: patch.pending,
    pendingVisitDateLabel: patch.pending ? patch.dateLabel : null,
    pendingVisitDate: patch.pending ? patch.dateYmd : null,
    pendingVisitEnterpriseId: patch.pending ? patch.enterpriseId : null,
    updatedAt: new Date().toISOString(),
  };
}

export function handleVisitSchedulingDeterministically(
  input: DirectVisitSchedulingInput
): DirectVisitSchedulingDecision {
  const referenceNow = input.referenceNow ?? new Date();
  const dateMention = parseDateMention(input.userMessage, referenceNow);
  const timeHm = parseTimeHmFromText(input.userMessage);
  const pending = input.flowState.pendingVisitScheduling === true;
  const pendingDateLabel = input.flowState.pendingVisitDateLabel ?? null;
  const pendingDateYmd = input.flowState.pendingVisitDate ?? null;
  const effectiveDateLabel = dateMention?.label ?? pendingDateLabel;
  const effectiveDateYmd = dateMention?.ymd ?? pendingDateYmd;

  const base: Omit<DirectVisitSchedulingDecision, 'handled' | 'reply' | 'reason' | 'nextState' | 'appointmentConfirmed' | 'appointmentDateYmd' | 'appointmentTimeHm'> = {
    pendingVisitScheduling: pending,
    extractedDateLabel: dateMention?.label ?? pendingDateLabel,
    extractedDateYmd: dateMention?.ymd ?? pendingDateYmd,
    extractedTime: timeHm,
  };

  const finish = (
    reason: string,
    reply: string,
    nextState: CommercialFlowState,
    appointmentConfirmed = false,
    appointmentDateYmd: string | null = null,
    appointmentTimeHm: string | null = null
  ): DirectVisitSchedulingDecision => ({
    ...base,
    handled: true,
    reply,
    reason,
    nextState,
    pendingVisitScheduling: nextState.pendingVisitScheduling === true,
    appointmentConfirmed,
    appointmentDateYmd,
    appointmentTimeHm,
  });

  if (pending && isAckOnly(input.userMessage) && !timeHm) {
    const nextState = buildPendingState(input.flowState, {
      pending: true,
      dateLabel: pendingDateLabel,
      dateYmd: pendingDateYmd,
      enterpriseId: input.enterpriseId ?? input.flowState.pendingVisitEnterpriseId ?? null,
    });
    return finish('pending_without_time_ack', pendingAskTimeReply(pendingDateLabel), nextState);
  }

  if (effectiveDateYmd && timeHm) {
    const weekday = getJsWeekdayForYmdInSaoPaulo(effectiveDateYmd);
    if (weekday === 0) {
      const nextState = buildPendingState(input.flowState, {
        pending: true,
        dateLabel: null,
        dateYmd: null,
        enterpriseId: input.enterpriseId,
      });
      return finish('sunday_not_allowed', 'Domingo fica fora da janela de visitas. Pode me informar um dia de segunda a sábado?', nextState);
    }
    if (!isAllowedVisitSlot(effectiveDateYmd, timeHm)) {
      const nextState = buildPendingState(input.flowState, {
        pending: true,
        dateLabel: effectiveDateLabel,
        dateYmd: effectiveDateYmd,
        enterpriseId: input.enterpriseId,
      });
      return finish(
        'time_outside_visit_window',
        `Esse horário fica fora da janela de visitas. ${VISIT_WINDOW_REPLY}`,
        nextState
      );
    }
    const nextState = buildPendingState(input.flowState, {
      pending: false,
      dateLabel: null,
      dateYmd: null,
      enterpriseId: null,
    });
    return finish(
      'date_and_time_confirmed',
      confirmReply(effectiveDateLabel, timeHm),
      nextState,
      true,
      effectiveDateYmd,
      timeHm
    );
  }

  if (effectiveDateYmd && !timeHm) {
    const weekday = getJsWeekdayForYmdInSaoPaulo(effectiveDateYmd);
    const nextState = buildPendingState(input.flowState, {
      pending: true,
      dateLabel: effectiveDateLabel,
      dateYmd: effectiveDateYmd,
      enterpriseId: input.enterpriseId,
    });
    if (weekday === 0) {
      return finish('date_only_sunday_not_allowed', 'Domingo fica fora da janela de visitas. Pode me informar um dia de segunda a sábado?', nextState);
    }
    return finish('date_without_time', askTimeReply(effectiveDateLabel), nextState);
  }

  if (!effectiveDateYmd && timeHm) {
    const nextState = buildPendingState(input.flowState, {
      pending: true,
      dateLabel: null,
      dateYmd: null,
      enterpriseId: input.enterpriseId,
    });
    return finish('time_without_date', askDayReply(), nextState);
  }

  if (pending || isAckOnly(input.userMessage)) {
    const nextState = buildPendingState(input.flowState, {
      pending: true,
      dateLabel: pendingDateLabel,
      dateYmd: pendingDateYmd,
      enterpriseId: input.enterpriseId ?? input.flowState.pendingVisitEnterpriseId ?? null,
    });
    return finish('pending_without_time', pendingAskTimeReply(pendingDateLabel), nextState);
  }

  const nextState = buildPendingState(input.flowState, {
    pending: true,
    dateLabel: null,
    dateYmd: null,
    enterpriseId: input.enterpriseId,
  });
  return finish('visit_intent_missing_date_time', 'Perfeito. Qual dia e horário você prefere para a visita?', nextState);
}

export function hasProhibitedVisitSchedulingPhrase(text: string): boolean {
  const n = norm(text);
  return PROHIBITED_VISIT_SCHEDULING_PHRASES.some((phrase) => n.includes(phrase));
}
