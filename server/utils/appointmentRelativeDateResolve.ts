/**
 * Resolve data/hora de agendamento a partir do texto do cliente + fallback JSON da Ana.
 * Base: instante atual real em America/Sao_Paulo (offset fixo -03:00, alinhado ao restante do módulo).
 */

import {
  APPOINTMENT_BUSINESS_TZ,
  normalizeAnaAppointmentDateYmd,
  parseAppointmentStartEndInSaoPaulo,
} from './appointmentDateNormalize.js';

const SP_OFFSET = '-03:00';

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

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token já normalizado (sem acento) → getDay() JS */
function weekdayTokenToJsDay(token: string): number | null {
  const t = token.toLowerCase();
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
  let m = n.match(/\b(\d{1,2})h(\d{2})\b/);
  if (m) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  m = n.match(/\b(\d{1,2})h\b/);
  if (m) {
    const hh = parseInt(m[1], 10);
    if (hh >= 0 && hh <= 23) return `${String(hh).padStart(2, '0')}:00`;
  }
  m = n.match(/\b(\d{1,2}):(\d{2})\b/);
  if (m) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }
  return null;
}

function normalizeLlmTimeHm(t: string | null | undefined): string | null {
  const s = (t ?? '').trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const hh = parseInt(m[1], 10);
  const mm = parseInt(m[2], 10);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function firstWeekdayInText(raw: string): number | null {
  const m = norm(raw).match(
    /\b(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\b/
  );
  if (!m) return null;
  return weekdayTokenToJsDay(m[1]);
}

function nextYmdForWeekdayFrom(
  startYmd: string,
  targetJsDay: number,
  timeHm: string,
  refNow: Date
): string | null {
  for (let add = 0; add <= 28; add++) {
    const ymd = addDaysYmd(startYmd, add);
    const noon = new Date(`${ymd}T12:00:00${SP_OFFSET}`);
    if (Number.isNaN(noon.getTime())) continue;
    if (noon.getDay() !== targetJsDay) continue;
    const p = parseAppointmentStartEndInSaoPaulo(ymd, timeHm);
    if (!p) continue;
    if (p.startAt.getTime() > refNow.getTime()) return ymd;
  }
  return null;
}

/**
 * Garante que data+hora caiam depois de `refNow` (avança dia a dia, ex.: LLM com dia no passado).
 */
function rollYmdUntilFuture(ymd: string, timeHm: string, refNow: Date): string | null {
  let cur = ymd;
  for (let i = 0; i < 370; i++) {
    const p = parseAppointmentStartEndInSaoPaulo(cur, timeHm);
    if (!p) return null;
    if (p.startAt.getTime() > refNow.getTime()) return cur;
    cur = addDaysYmd(cur, 1);
  }
  return null;
}

export interface ResolveAppointmentDateTimeArgs {
  referenceNow: Date;
  /** Últimas falas do usuário + mensagem atual (para "amanhã", "quinta às 15h", etc.). */
  userText: string;
  llmDateYmd: string | null | undefined;
  llmTimeHm: string | null | undefined;
}

/**
 * Retorna YYYY-MM-DD e HH:MM em São Paulo, ou null se insuficiente.
 */
export function resolveAppointmentDateTimeFromContext(args: ResolveAppointmentDateTimeArgs): {
  dateYmd: string;
  timeHm: string;
} | null {
  const { referenceNow, userText } = args;
  const u = userText.trim();
  const nu = norm(u);

  const timeFromUser = parseTimeHmFromText(u);
  const timeFromLlm = normalizeLlmTimeHm(args.llmTimeHm);
  const timeHm = timeFromUser ?? timeFromLlm;
  if (!timeHm) return null;

  const todayYmd = formatYmdInSaoPaulo(referenceNow);

  let dateYmd: string | null = null;

  if (/\bdepois de amanha\b/.test(nu) || /\bdepois de amanhã\b/.test(u.toLowerCase())) {
    dateYmd = addDaysYmd(todayYmd, 2);
  } else if (/\bamanha\b/.test(nu) || /\bamanhã\b/.test(u.toLowerCase())) {
    dateYmd = addDaysYmd(todayYmd, 1);
  } else if (/\bhoje\b/.test(nu)) {
    dateYmd = todayYmd;
  } else {
    const wd = firstWeekdayInText(u);
    if (wd != null) {
      dateYmd = nextYmdForWeekdayFrom(todayYmd, wd, timeHm, referenceNow);
    }
  }

  if (!dateYmd) {
    const raw = (args.llmDateYmd ?? '').trim();
    if (!raw) return null;
    const normLlm = normalizeAnaAppointmentDateYmd(raw, referenceNow);
    if (!normLlm) return null;
    dateYmd = normLlm;
  }

  let rolled = rollYmdUntilFuture(dateYmd, timeHm, referenceNow);
  if (!rolled) return null;

  const wdUser = firstWeekdayInText(u);
  if (wdUser != null) {
    const p = parseAppointmentStartEndInSaoPaulo(rolled, timeHm);
    if (p && p.startAt.getDay() !== wdUser) {
      const fixed = nextYmdForWeekdayFrom(todayYmd, wdUser, timeHm, referenceNow);
      if (fixed) rolled = fixed;
    }
  }

  return { dateYmd: rolled, timeHm };
}
