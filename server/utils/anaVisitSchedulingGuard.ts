import type { CommercialFlowState } from './commercialFlowState.js';

type VisitStatus = 'none' | 'collecting_date' | 'collecting_time' | 'collecting_name' | 'ready_to_confirm' | 'scheduled';

type VisitState = {
  active: boolean;
  offered: boolean;
  accepted: boolean;
  requestedDateText: string | null;
  requestedTimeText: string | null;
  normalizedDate: string | null;
  normalizedTime: string | null;
  nameCollected: boolean;
  customerName: string | null;
  status: VisitStatus;
};

const DEFAULT_STATE: VisitState = {
  active: false,
  offered: false,
  accepted: false,
  requestedDateText: null,
  requestedTimeText: null,
  normalizedDate: null,
  normalizedTime: null,
  nameCollected: false,
  customerName: null,
  status: 'none',
};

function norm(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/\s+/g, ' ').trim();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function ymdFrom(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(d);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(`${ymd}T12:00:00-03:00`);
  d.setDate(d.getDate() + days);
  return ymdFrom(d);
}

function weekdayToJsDay(token: string): number | null {
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

function nextDateForWeekday(todayYmd: string, targetDay: number): string {
  const base = new Date(`${todayYmd}T12:00:00-03:00`);
  for (let add = 0; add <= 14; add += 1) {
    const d = new Date(base);
    d.setDate(base.getDate() + add);
    if (d.getDay() === targetDay) return ymdFrom(d);
  }
  return todayYmd;
}

function parseDateFromText(text: string, now: Date): { text: string; ymd: string } | null {
  const n = norm(text);
  const today = ymdFrom(now);
  if (/\bdepois de amanha\b/.test(n)) return { text: 'depois de amanhã', ymd: addDays(today, 2) };
  if (/\bamanha\b/.test(n)) return { text: 'amanhã', ymd: addDays(today, 1) };
  if (/\bhoje\b/.test(n)) return { text: 'hoje', ymd: today };

  const wd = n.match(/\b(domingo|segunda(?: feira)?|terca(?: feira)?|quarta(?: feira)?|quinta(?: feira)?|sexta(?: feira)?|sabado)\b/);
  if (wd) {
    const day = weekdayToJsDay(wd[1]!);
    if (day != null) return { text: wd[1]!, ymd: nextDateForWeekday(today, day) };
  }
  return null;
}

function parseTimeFromText(text: string): { text: string; hm: string } | null {
  const n = norm(text);
  const match =
    n.match(/\bas\s+(\d{1,2})(?::(\d{2}))?\b/) ??
    n.match(/\b(\d{1,2})h(?:(\d{2}))?\b/) ??
    n.match(/\b(\d{1,2}):(\d{2})\b/) ??
    n.match(/^\s*(\d{1,2})\s*$/);
  if (!match) return null;
  const hh = Number.parseInt(match[1] ?? '', 10);
  const mm = Number.parseInt(match[2] ?? '0', 10);
  if (!Number.isFinite(hh) || hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return { text: mm === 0 ? `${hh}h` : `${hh}h${pad2(mm)}`, hm: `${pad2(hh)}:${pad2(mm)}` };
}

function isSunday(ymd: string): boolean {
  return new Date(`${ymd}T12:00:00-03:00`).getDay() === 0;
}

function isInsideVisitWindow(hm: string): boolean {
  const [hh, mm] = hm.split(':').map((x) => Number.parseInt(x, 10));
  const minutes = hh * 60 + mm;
  return minutes >= 9 * 60 && minutes <= 18 * 60;
}

function isPositiveVisitAck(text: string): boolean {
  return /^(sim|pode sim|pode ser|ok|fechado|combinado|confirmo|confirmado)$/.test(norm(text));
}

function isGratitudeOnlyMessage(text: string): boolean {
  return /^(obrigad[oa]|muito obrigad[oa]|ok obrigad[oa]|valeu|vlw|agradeco|agradeço)[.! ]*$/.test(norm(text));
}

function toFirstName(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim();
  if (!raw) return null;
  const first = raw.split(/\s+/)[0]?.trim() ?? '';
  return first.length >= 2 ? first : null;
}

function extractNameStatement(userMessage: string, fallbackName: string | null | undefined): string | null {
  const n = norm(userMessage);
  const namedByStatement =
    /\b(meu nome e|me chamo|pode me chamar de|sou o|sou a)\b/.test(n) ||
    /\bnome\b/.test(n);
  if (!namedByStatement) return null;
  return toFirstName(fallbackName);
}

function hydrate(state: CommercialFlowState, customerName: string | null | undefined): VisitState {
  const v = state.visitScheduling;
  const name = (customerName ?? '').trim();
  return {
    ...DEFAULT_STATE,
    ...(v ?? {}),
    nameCollected: (v?.nameCollected ?? false) || name.length > 0,
    customerName: v?.customerName ?? (name.length > 0 ? name : null),
    active: (v?.active ?? false) || state.pendingVisitScheduling === true,
    normalizedDate: v?.normalizedDate ?? state.pendingVisitDate ?? null,
    requestedDateText: v?.requestedDateText ?? state.pendingVisitDateLabel ?? null,
  };
}

function persist(base: CommercialFlowState, v: VisitState, enterpriseId: number | null): CommercialFlowState {
  return {
    ...base,
    pendingVisitScheduling: v.active,
    pendingVisitDateLabel: v.requestedDateText,
    pendingVisitDate: v.normalizedDate,
    pendingVisitEnterpriseId: v.active ? enterpriseId : null,
    visitScheduling: v,
    updatedAt: new Date().toISOString(),
  };
}

function hasSchedulingSignal(userMessage: string): boolean {
  const n = norm(userMessage);
  return /(agendar|agendamento|marcar visita|visita|podemos agendar|quero agendar)/.test(n);
}

export function applyAnaVisitSchedulingGuard(params: {
  conversationId: number;
  enterpriseId: number | null;
  isEvora: boolean;
  userMessage: string;
  customerName: string | null | undefined;
  flowState: CommercialFlowState;
  now?: Date;
  currentAnswer: string;
}): {
  handled: boolean;
  finalAnswer: string;
  nextState: CommercialFlowState;
  reason: string;
  nextMissingField: string | null;
} {
  if (!params.isEvora) {
    return {
      handled: false,
      finalAnswer: params.currentAnswer,
      nextState: params.flowState,
      reason: 'not_evora',
      nextMissingField: null,
    };
  }

  const now = params.now ?? new Date();
  const v = hydrate(params.flowState, params.customerName);
  const userMessage = params.userMessage;

  if (!v.active && hasSchedulingSignal(userMessage)) {
    v.active = true;
    v.accepted = true;
    v.offered = true;
    v.status = 'collecting_date';
  }
  if (!v.active) {
    return {
      handled: false,
      finalAnswer: params.currentAnswer,
      nextState: params.flowState,
      reason: 'not_active',
      nextMissingField: null,
    };
  }

  if (isGratitudeOnlyMessage(userMessage)) {
    v.active = false;
    v.status = 'none';
    const next = persist(params.flowState, v, params.enterpriseId);
    return {
      handled: true,
      finalAnswer: 'De nada! Se precisar de mais alguma informação sobre o Évora, estou por aqui.',
      nextState: next,
      reason: 'gratitude_closure',
      nextMissingField: null,
    };
  }

  const date = parseDateFromText(userMessage, now);
  const time = parseTimeFromText(userMessage);
  const nameFromStatement = extractNameStatement(userMessage, params.customerName);
  if (nameFromStatement) {
    v.nameCollected = true;
    v.customerName = nameFromStatement;
  }
  if (date) {
    v.requestedDateText = date.text;
    v.normalizedDate = date.ymd;
  }
  if (time) {
    v.requestedTimeText = time.text;
    v.normalizedTime = time.hm;
  }

  if (!v.normalizedDate && time && !date) {
    v.status = 'collecting_date';
    const next = persist(params.flowState, v, params.enterpriseId);
    return {
      handled: true,
      finalAnswer: 'Perfeito. Para qual dia você prefere agendar a visita?',
      nextState: next,
      reason: 'missing_date',
      nextMissingField: 'date',
    };
  }

  if (v.normalizedDate && isSunday(v.normalizedDate)) {
    const next = persist(params.flowState, v, params.enterpriseId);
    return {
      handled: true,
      finalAnswer: 'Para visitas, trabalhamos de segunda a sábado. Pode ser em algum dia da semana ou no sábado?',
      nextState: next,
      reason: 'sunday_not_allowed',
      nextMissingField: 'date',
    };
  }

  if (v.normalizedTime && !isInsideVisitWindow(v.normalizedTime)) {
    const next = persist(params.flowState, v, params.enterpriseId);
    return {
      handled: true,
      finalAnswer:
        'Esse horário fica fora do período de visitas. Temos disponibilidade de segunda a sábado, das 09h às 18h. Pode ser em algum horário dentro desse período?',
      nextState: next,
      reason: 'time_outside_window',
      nextMissingField: 'time',
    };
  }

  if (!v.normalizedDate) {
    v.status = 'collecting_date';
    const next = persist(params.flowState, v, params.enterpriseId);
    const displayName = (v.customerName ?? '').trim();
    const askDateReply = displayName
      ? `Perfeito, ${displayName}. Para qual dia você prefere agendar a visita?`
      : 'Perfeito. Para qual dia você prefere agendar a visita?';
    return {
      handled: true,
      finalAnswer: askDateReply,
      nextState: next,
      reason: nameFromStatement ? 'name_captured_collect_date' : 'collect_date',
      nextMissingField: 'date',
    };
  }

  if (!v.normalizedTime) {
    v.status = 'collecting_time';
    const next = persist(params.flowState, v, params.enterpriseId);
    return {
      handled: true,
      finalAnswer: `Perfeito. Qual horário você prefere ${v.requestedDateText ?? 'nesse dia'}?`,
      nextState: next,
      reason: 'collect_time',
      nextMissingField: 'time',
    };
  }

  if (!v.nameCollected) {
    v.status = 'collecting_name';
    const next = persist(params.flowState, v, params.enterpriseId);
    return {
      handled: true,
      finalAnswer: 'Perfeito. Me passa seu nome para deixar a visita agendada?',
      nextState: next,
      reason: 'collect_name',
      nextMissingField: 'name',
    };
  }

  if (date || time || isPositiveVisitAck(userMessage) || v.status === 'ready_to_confirm' || v.status === 'collecting_name') {
    v.status = 'scheduled';
    v.active = false;
    const hh = Number.parseInt(v.normalizedTime.slice(0, 2), 10);
    const mm = v.normalizedTime.slice(3, 5);
    const displayHm = mm === '00' ? `${hh}h` : `${hh}h${mm}`;
    const next = persist(params.flowState, v, params.enterpriseId);
    return {
      handled: true,
      finalAnswer: `Perfeito, sua visita ficou agendada para ${v.requestedDateText ?? 'o dia combinado'} às ${displayHm}.`,
      nextState: next,
      reason: 'scheduled',
      nextMissingField: null,
    };
  }

  v.status = 'ready_to_confirm';
  const next = persist(params.flowState, v, params.enterpriseId);
  return {
    handled: true,
    finalAnswer: `Perfeito. Posso confirmar sua visita para ${v.requestedDateText ?? 'o dia combinado'} às ${v.requestedTimeText ?? v.normalizedTime}?`,
    nextState: next,
    reason: 'ready_to_confirm',
    nextMissingField: null,
  };
}
