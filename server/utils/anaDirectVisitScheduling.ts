import {
  APPOINTMENT_BUSINESS_TZ,
  getJsWeekdayForYmdInSaoPaulo,
  parseAppointmentStartEndInSaoPaulo,
} from './appointmentDateNormalize.js';
import type { CommercialFlowState } from './commercialFlowState.js';
import { extractCustomerNameFromUserUtterance } from './extractCustomerNameFromMessage.js';

const SP_OFFSET = '-03:00';
export const VISIT_WINDOW_START_MINUTES = 9 * 60;
export const VISIT_WINDOW_END_MINUTES = 18 * 60;
export const VISIT_WINDOW_REPLY = 'Temos disponibilidade de segunda a sábado, das 09h às 18h.';

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

type VisitPeriod = 'manha' | 'tarde' | 'noite';
type VisitSlotKey = 'nome' | 'dia' | 'periodo' | 'horario' | 'empreendimento' | 'telefone';

export interface DirectVisitSchedulingDecision {
  handled: boolean;
  reply: string | null;
  reason: string;
  pendingVisitScheduling: boolean;
  extractedDateLabel: string | null;
  extractedDateYmd: string | null;
  extractedPeriod: VisitPeriod | null;
  extractedTime: string | null;
  capturedSlots: VisitSlotKey[];
  missingSlot: 'nome' | 'dia' | 'periodo_ou_horario' | null;
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
  customerName?: string | null;
  customerPhone?: string | null;
  referenceNow?: Date;
}

export interface VisitSchedulingContinuationInput {
  userMessage: string;
  lastAssistantMessage?: string | null;
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
  const reList = [
    /\bas\s+(\d{1,2})(?:h(\d{2})|\s*:\s*(\d{2}))?\b/g,
    /\b(\d{1,2})h(\d{2})\b/g,
    /\b(\d{1,2})h\b/g,
    /\b(\d{1,2}):(\d{2})\b/g,
  ];
  const hits: Array<{ i: number; hm: string }> = [];
  for (const re of reList) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(n)) !== null) {
      const hh = parseInt(m[1] ?? '', 10);
      const mm = m[2] ? parseInt(m[2], 10) : m[3] ? parseInt(m[3], 10) : 0;
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) hits.push({ i: m.index, hm: `${pad2(hh)}:${pad2(mm)}` });
    }
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.i - b.i);
  return hits[hits.length - 1]!.hm;
}

function parsePeriodFromText(text: string): VisitPeriod | null {
  const n = norm(text);
  if (!n) return null;
  if (/\b(de manha|de manhã|manha|manhã)\b/.test(n)) return 'manha';
  if (/\b(a tarde|à tarde|de tarde|tarde)\b/.test(n)) return 'tarde';
  if (/\b(a noite|à noite|de noite|noite)\b/.test(n)) return 'noite';
  return null;
}

function normalizeVisitPeriod(value: string | null | undefined): VisitPeriod | null {
  const n = norm(value || '');
  if (!n) return null;
  if (n === 'manha') return 'manha';
  if (n === 'tarde') return 'tarde';
  if (n === 'noite') return 'noite';
  return null;
}

function parseDateMention(text: string, referenceNow: Date): { label: string; ymd: string } | null {
  const n = norm(text);
  const today = formatYmdInSaoPaulo(referenceNow);
  if (/\bdepois de amanha\b/.test(n)) return { label: 'depois de amanhã', ymd: addDaysYmd(today, 2) };
  if (/\bamanha\b/.test(n)) return { label: 'amanhã', ymd: addDaysYmd(today, 1) };
  if (/\bhoje\b/.test(n)) return { label: 'hoje', ymd: today };
  const wd = n.match(/\b(domingo|segunda(?: feira)?|terca(?: feira)?|quarta(?: feira)?|quinta(?: feira)?|sexta(?: feira)?|sabado)\b/);
  if (wd) {
    const jsDay = weekdayTokenToJsDay(wd[1]!);
    if (jsDay != null) return { label: wd[1]!, ymd: nextYmdForWeekday(today, jsDay) };
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

export function isVisitSchedulingRefusalMessage(text: string): boolean {
  const n = norm(text);
  return /\b(nao quero agendar|nao quero visita|nao quero marcar|nao quero horario|nao quero isso|so quero detalhes|quero detalhes|me passa os detalhes|quero saber dos lotes|quero lote plano|lotes planos|ja falei)\b/.test(n);
}

export function isVisitSchedulingLoopFallbackReply(text: string): boolean {
  const n = norm(text);
  return n.includes('so preciso que voce me diga o horario para agendar sua visita');
}

function lastAssistantInvitedVisit(text: string | null | undefined): boolean {
  const n = norm(text ?? '');
  return /\b(agendar|marcar|visita|conhecer pessoalmente)\b/.test(n) && /\b(interesse|qual dia|dia e horario|horario)\b/.test(n);
}

export function isVisitSchedulingIntent(input: DirectVisitSchedulingInput): boolean {
  const axes = [input.resolvedIntent, input.primaryAxis, input.currentAxis, input.requestedAxis]
    .map((x) => norm(String(x ?? '')))
    .filter(Boolean);
  const axisRequestedVisit = axes.some((x) => x === 'visita_agendamento' || x === 'agendar');
  const schedulingContinuation = isVisitSchedulingContinuationMessage({
    userMessage: input.userMessage,
    lastAssistantMessage: input.lastAssistantMessage,
    referenceNow: input.referenceNow,
  });
  if (input.flowState.pendingVisitScheduling === true) {
    return schedulingContinuation;
  }
  if (axisRequestedVisit) return schedulingContinuation || hasVisitSchedulingWords(input.userMessage);
  if (hasVisitSchedulingWords(input.userMessage)) return true;
  if (isAckOnly(input.userMessage) && lastAssistantInvitedVisit(input.lastAssistantMessage)) return true;
  return false;
}

export function isVisitSchedulingContinuationMessage(input: VisitSchedulingContinuationInput): boolean {
  const referenceNow = input.referenceNow ?? new Date();
  const n = norm(input.userMessage);
  if (!n) return false;
  if (/^(obrigado|obrigada|muito obrigado|muito obrigada|ok obrigado|ok obrigada|valeu|vlw|agradeco)[.! ]*$/.test(n)) {
    return true;
  }
  if (/\b(meu nome e|me chamo|pode me chamar de|sou o|sou a|nome)\b/.test(n)) return true;
  if (hasVisitSchedulingWords(input.userMessage)) return true;
  if (parseDateMention(input.userMessage, referenceNow)) return true;
  if (parseTimeHmFromText(input.userMessage)) return true;
  if (parsePeriodFromText(input.userMessage)) return true;
  if (/\b(dia\s*\d{1,2}|horario|de manha|a tarde|a noite|manha|tarde|noite)\b/.test(n)) {
    return true;
  }
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
  return !isSunday && Number.isFinite(minutes) && minutes >= VISIT_WINDOW_START_MINUTES && minutes <= VISIT_WINDOW_END_MINUTES;
}

export function isAllowedVisitSlot(dateYmd: string, timeHm: string): boolean {
  const parsed = parseAppointmentStartEndInSaoPaulo(dateYmd, timeHm);
  if (!parsed) return false;
  const weekday = getJsWeekdayForYmdInSaoPaulo(dateYmd);
  if (weekday === 0) return false;
  const minutes = timeHmToMinutes(timeHm);
  return minutes != null && minutes >= VISIT_WINDOW_START_MINUTES && minutes <= VISIT_WINDOW_END_MINUTES;
}

function periodHumanLabel(period: VisitPeriod | null): string | null {
  if (period === 'manha') return 'de manhã';
  if (period === 'tarde') return 'à tarde';
  if (period === 'noite') return 'à noite';
  return null;
}

function combineDateAndPeriodLabel(dateLabel: string | null, period: VisitPeriod | null): string | null {
  const d = (dateLabel || '').trim();
  const p = periodHumanLabel(period);
  if (d && p) return `${d} ${p}`;
  if (d) return d;
  return p;
}

function askTimeReply(label: string | null): string {
  if (label) return `Perfeito, ${label}. Qual horário fica melhor para você? ${VISIT_WINDOW_REPLY}`;
  return `Perfeito. Qual horário você prefere para a visita? ${VISIT_WINDOW_REPLY}`;
}

function askDayReply(): string {
  return 'Perfeito. Para qual dia você prefere agendar a visita?';
}

function askNameReply(dateLabel: string | null, timeHm: string): string {
  const hh = parseInt(timeHm.slice(0, 2), 10);
  const mm = timeHm.slice(3, 5);
  const displayTime = mm === '00' ? `${hh}h` : `${hh}h${mm}`;
  return `Perfeito, ${dateLabel ?? 'o dia escolhido'} às ${displayTime}. Como posso te chamar para confirmar o agendamento?`;
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
    timeHm?: string | null;
    period?: VisitPeriod | null;
    enterpriseId: number | null;
  }
): CommercialFlowState {
  return {
    ...prev,
    pendingVisitScheduling: patch.pending,
    pendingVisitDateLabel: patch.pending ? patch.dateLabel : null,
    pendingVisitDate: patch.pending ? patch.dateYmd : null,
    pendingVisitTime: patch.pending ? (patch.timeHm ?? prev.pendingVisitTime ?? null) : null,
    pendingVisitPeriod: patch.pending ? (patch.period ?? prev.pendingVisitPeriod ?? null) : null,
    pendingVisitEnterpriseId: patch.pending ? patch.enterpriseId : null,
    updatedAt: new Date().toISOString(),
  };
}

function knownNameFromContext(input: DirectVisitSchedulingInput): string | null {
  const fromContext = (input.customerName || '').trim();
  if (fromContext.length >= 2) return fromContext;
  const fromMessage = extractCustomerNameFromUserUtterance(input.userMessage);
  return fromMessage && fromMessage.trim().length >= 2 ? fromMessage.trim() : null;
}

export function handleVisitSchedulingDeterministically(input: DirectVisitSchedulingInput): DirectVisitSchedulingDecision {
  const referenceNow = input.referenceNow ?? new Date();
  const dateMention = parseDateMention(input.userMessage, referenceNow);
  const timeHm = parseTimeHmFromText(input.userMessage);
  const period = parsePeriodFromText(input.userMessage);
  const pending = input.flowState.pendingVisitScheduling === true;
  const pendingDateLabel = input.flowState.pendingVisitDateLabel ?? null;
  const pendingDateYmd = input.flowState.pendingVisitDate ?? null;
  const pendingTimeHm = input.flowState.pendingVisitTime ?? null;
  const pendingPeriod = normalizeVisitPeriod(input.flowState.pendingVisitPeriod ?? null);
  const effectiveDateLabel = dateMention?.label ?? pendingDateLabel;
  const effectiveDateYmd = dateMention?.ymd ?? pendingDateYmd;
  const effectiveTimeHm = timeHm ?? pendingTimeHm;
  const effectivePeriod = period ?? pendingPeriod;
  const effectiveName = knownNameFromContext(input);

  const capturedSlots: VisitSlotKey[] = [];
  if (effectiveName) capturedSlots.push('nome');
  if (effectiveDateYmd) capturedSlots.push('dia');
  if (effectivePeriod) capturedSlots.push('periodo');
  if (effectiveTimeHm) capturedSlots.push('horario');
  if (input.enterpriseId != null) capturedSlots.push('empreendimento');
  if ((input.customerPhone || '').replace(/\D/g, '').length >= 10) capturedSlots.push('telefone');

  const finish = (
    reason: string,
    reply: string,
    nextState: CommercialFlowState,
    missingSlot: 'nome' | 'dia' | 'periodo_ou_horario' | null,
    appointmentConfirmed = false,
    appointmentDateYmd: string | null = null,
    appointmentTimeHm: string | null = null
  ): DirectVisitSchedulingDecision => ({
    handled: true,
    reply,
    reason,
    nextState,
    pendingVisitScheduling: nextState.pendingVisitScheduling === true,
    extractedDateLabel: dateMention?.label ?? pendingDateLabel,
    extractedDateYmd: dateMention?.ymd ?? pendingDateYmd,
    extractedPeriod: period ?? pendingPeriod,
    extractedTime: timeHm,
    capturedSlots,
    missingSlot,
    appointmentConfirmed,
    appointmentDateYmd,
    appointmentTimeHm,
  });

  if (!effectiveDateYmd && !effectiveTimeHm && !effectivePeriod) {
    if (!pending) {
      const nextState = buildPendingState(input.flowState, {
        pending: true,
        dateLabel: null,
        dateYmd: null,
        enterpriseId: input.enterpriseId,
      });
      return finish('start_collecting_date', askDayReply(), nextState, 'dia');
    }
    if (isAckOnly(input.userMessage)) {
      const nextState = buildPendingState(input.flowState, {
        pending: true,
        dateLabel: pendingDateLabel,
        dateYmd: pendingDateYmd,
        timeHm: pendingTimeHm,
        period: pendingPeriod,
        enterpriseId: input.enterpriseId,
      });
      return finish(
        'pending_without_time_ack',
        askTimeReply(combineDateAndPeriodLabel(pendingDateLabel, pendingPeriod)),
        nextState,
        'periodo_ou_horario'
      );
    }
    const nextState = buildPendingState(input.flowState, {
      pending: true,
      dateLabel: pendingDateLabel,
      dateYmd: pendingDateYmd,
      timeHm: pendingTimeHm,
      period: pendingPeriod,
      enterpriseId: input.enterpriseId,
    });
    return finish(
      'pending_without_time',
      askTimeReply(combineDateAndPeriodLabel(pendingDateLabel, pendingPeriod)),
      nextState,
      'periodo_ou_horario'
    );
  }

  if (!effectiveDateYmd && (effectiveTimeHm || effectivePeriod)) {
    const nextState = buildPendingState(input.flowState, {
      pending: true,
      dateLabel: pendingDateLabel,
      dateYmd: pendingDateYmd,
      timeHm: effectiveTimeHm,
      period: effectivePeriod,
      enterpriseId: input.enterpriseId,
    });
    return finish('time_or_period_without_date', askDayReply(), nextState, 'dia');
  }

  if (effectiveDateYmd && !effectiveTimeHm) {
    const weekday = getJsWeekdayForYmdInSaoPaulo(effectiveDateYmd);
    const nextState = buildPendingState(input.flowState, {
      pending: true,
      dateLabel: effectiveDateLabel,
      dateYmd: effectiveDateYmd,
      timeHm: null,
      period: effectivePeriod,
      enterpriseId: input.enterpriseId,
    });
    if (weekday === 0) {
      return finish(
        'date_only_sunday_not_allowed',
        'Para visitas, trabalhamos de segunda a sábado. Pode ser em algum dia da semana ou no sábado?',
        nextState,
        'dia'
      );
    }
    return finish(
      'date_without_time',
      askTimeReply(combineDateAndPeriodLabel(effectiveDateLabel, effectivePeriod)),
      nextState,
      'periodo_ou_horario'
    );
  }

  if (effectiveDateYmd && effectiveTimeHm) {
    const weekday = getJsWeekdayForYmdInSaoPaulo(effectiveDateYmd);
    if (weekday === 0) {
      const nextState = buildPendingState(input.flowState, {
        pending: true,
        dateLabel: null,
        dateYmd: null,
        timeHm: null,
        period: null,
        enterpriseId: input.enterpriseId,
      });
      return finish(
        'sunday_not_allowed',
        'Para visitas, trabalhamos de segunda a sábado. Pode ser em algum dia da semana ou no sábado?',
        nextState,
        'dia'
      );
    }
    if (!isAllowedVisitSlot(effectiveDateYmd, effectiveTimeHm)) {
      const nextState = buildPendingState(input.flowState, {
        pending: true,
        dateLabel: effectiveDateLabel,
        dateYmd: effectiveDateYmd,
        timeHm: null,
        period: effectivePeriod,
        enterpriseId: input.enterpriseId,
      });
      return finish(
        'time_outside_visit_window',
        `Esse horário fica fora do período de visitas. ${VISIT_WINDOW_REPLY} Pode ser em algum horário dentro desse período?`,
        nextState,
        'periodo_ou_horario'
      );
    }
    if (!effectiveName) {
      const nextState = buildPendingState(input.flowState, {
        pending: true,
        dateLabel: effectiveDateLabel,
        dateYmd: effectiveDateYmd,
        timeHm: effectiveTimeHm,
        period: effectivePeriod,
        enterpriseId: input.enterpriseId,
      });
      return finish(
        'date_time_without_name',
        askNameReply(combineDateAndPeriodLabel(effectiveDateLabel, effectivePeriod), effectiveTimeHm),
        nextState,
        'nome'
      );
    }
    const nextState = buildPendingState(input.flowState, {
      pending: false,
      dateLabel: null,
      dateYmd: null,
      timeHm: null,
      period: null,
      enterpriseId: null,
    });
    return finish(
      'date_and_time_confirmed',
      confirmReply(combineDateAndPeriodLabel(effectiveDateLabel, effectivePeriod), effectiveTimeHm),
      nextState,
      null,
      true,
      effectiveDateYmd,
      effectiveTimeHm
    );
  }

  const nextState = buildPendingState(input.flowState, {
    pending: true,
    dateLabel: pendingDateLabel,
    dateYmd: pendingDateYmd,
    timeHm: pendingTimeHm,
    period: pendingPeriod,
    enterpriseId: input.enterpriseId,
  });
  return finish(
    'fallback_pending',
    askTimeReply(combineDateAndPeriodLabel(pendingDateLabel, pendingPeriod)),
    nextState,
    'periodo_ou_horario'
  );
}

export function hasProhibitedVisitSchedulingPhrase(text: string): boolean {
  const n = norm(text);
  return PROHIBITED_VISIT_SCHEDULING_PHRASES.some((phrase) => n.includes(phrase));
}
