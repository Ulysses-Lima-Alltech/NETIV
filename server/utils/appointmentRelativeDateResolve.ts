/**
 * Resolve data/hora de agendamento a partir do texto do cliente + fallback JSON da Ana.
 * Base: instante de referência (mensagem do usuário) em America/Sao_Paulo (offset fixo -03:00, alinhado ao restante do módulo).
 */

import {
  APPOINTMENT_BUSINESS_TZ,
  normalizeAnaAppointmentDateYmd,
  parseAppointmentStartEndInSaoPaulo,
  getJsWeekdayInSaoPaulo,
  getJsWeekdayForYmdInSaoPaulo,
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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
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

/**
 * Coleta todas as menções de horário no texto e devolve a última (correção tipo "não às 14, às 10").
 */
function parseTimeHmFromText(text: string): string | null {
  const n = norm(text);
  type Hit = { i: number; hm: string };
  const hits: Hit[] = [];

  const push = (m: RegExpExecArray, hm: string | null) => {
    if (hm) hits.push({ i: m.index, hm });
  };

  let re: RegExp;
  let m: RegExpExecArray | null;

  // "às 10" / "as 10h" / "as 10:30" (pt: às → as após norm)
  re = /\bas\s+(\d{1,2})(?:h(\d{2})|\s*:\s*(\d{2}))?\b/g;
  while ((m = re.exec(n)) !== null) {
    const hh = parseInt(m[1], 10);
    const mm = m[2] ? parseInt(m[2], 10) : m[3] ? parseInt(m[3], 10) : 0;
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) push(m, `${pad2(hh)}:${pad2(mm)}`);
  }

  re = /\b(\d{1,2})h(\d{2})\b/g;
  while ((m = re.exec(n)) !== null) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) push(m, `${pad2(hh)}:${pad2(mm)}`);
  }

  re = /\b(\d{1,2})h\b/g;
  while ((m = re.exec(n)) !== null) {
    const hh = parseInt(m[1], 10);
    if (hh >= 0 && hh <= 23) push(m, `${pad2(hh)}:00`);
  }

  re = /\b(\d{1,2}):(\d{2})\b/g;
  while ((m = re.exec(n)) !== null) {
    const hh = parseInt(m[1], 10);
    const mm = parseInt(m[2], 10);
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) push(m, `${pad2(hh)}:${pad2(mm)}`);
  }

  if (hits.length === 0) return null;
  hits.sort((a, b) => a.i - b.i);
  return hits[hits.length - 1].hm;
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
  return `${pad2(hh)}:${pad2(mm)}`;
}

function firstWeekdayInText(raw: string): number | null {
  const m = norm(raw).match(
    /\b(domingo|segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado)\b/
  );
  if (!m) return null;
  return weekdayTokenToJsDay(m[1]);
}

/** "próxima segunda", "pra próxima terça", etc. (texto já normalizado sem acento). */
function extractProximaWeekday(nu: string): number | null {
  const m = nu.match(
    /\bproxima\s+(segunda(?:-feira)?|terca(?:-feira)?|quarta(?:-feira)?|quinta(?:-feira)?|sexta(?:-feira)?|sabado|domingo)\b/
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
    if (getJsWeekdayForYmdInSaoPaulo(ymd) !== targetJsDay) continue;
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
  /** Preferir o instante da última mensagem do usuário; fallback `new Date()`. */
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
    const proximaWd = extractProximaWeekday(nu);
    if (proximaWd != null) {
      const anchorTomorrow = addDaysYmd(todayYmd, 1);
      dateYmd = nextYmdForWeekdayFrom(anchorTomorrow, proximaWd, timeHm, referenceNow);
    } else {
      const wd = firstWeekdayInText(u);
      if (wd != null) {
        dateYmd = nextYmdForWeekdayFrom(todayYmd, wd, timeHm, referenceNow);
      }
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
    if (p && getJsWeekdayInSaoPaulo(p.startAt) !== wdUser) {
      const proximaWd = extractProximaWeekday(nu);
      const startAnchor = proximaWd != null ? addDaysYmd(todayYmd, 1) : todayYmd;
      const fixed = nextYmdForWeekdayFrom(startAnchor, wdUser, timeHm, referenceNow);
      if (fixed) rolled = fixed;
    }
  }

  return { dateYmd: rolled, timeHm };
}
