import { checkAvailability } from './appointmentService.js';
import {
  APPOINTMENT_BUSINESS_TZ,
  getJsWeekdayForYmdInSaoPaulo,
  parseAppointmentStartEndInSaoPaulo,
} from '../utils/appointmentDateNormalize.js';

const SP_OFFSET = '-03:00';
const DEFAULT_BUSINESS_START_MINUTES = 9 * 60;
const DEFAULT_BUSINESS_END_MINUTES = 18 * 60;
/** Regra de negócio: domingo (weekday 0) atende só até 14h, os demais dias até 18h. */
const DEFAULT_SUNDAY_BUSINESS_END_MINUTES = 14 * 60;
const DEFAULT_VISIT_DURATION_MINUTES = 60;
const DEFAULT_SLOT_STEP_MINUTES = 60;
const DEFAULT_SEARCH_DAYS = 21;
const DEFAULT_ALLOWED_WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export type AnaVisitPeriodPreference = 'manha' | 'tarde' | 'noite';

export interface AnaVisitSlotPreference {
  dateYmd?: string | null;
  weekday?: number | null;
  period?: AnaVisitPeriodPreference | null;
  timeHm?: string | null;
}

export interface AnaVisitAvailabilitySlot {
  enterpriseId: number;
  startAt: Date;
  endAt: Date;
  startYmd: string;
  timeHm: string;
  brokerId: number;
  eligibleBrokerCount: number;
  timezone: string;
  label: string;
}

export interface AnaVisitSlotAvailabilityResult {
  available: boolean;
  brokerId: number | null;
  eligibleBrokerCount: number;
}

export type AnaVisitSlotAvailabilityChecker = (params: {
  enterpriseId: number;
  startAt: Date;
  endAt: Date;
  preferredBrokerId?: number | null;
  excludeAppointmentId?: number | null;
}) => Promise<AnaVisitSlotAvailabilityResult>;

export interface FindAvailableVisitSlotsParams {
  enterpriseId: number;
  referenceNow?: Date;
  preference?: AnaVisitSlotPreference | null;
  searchDays?: number;
  maxResults?: number;
  businessStartMinutes?: number;
  businessEndMinutes?: number;
  slotDurationMinutes?: number;
  slotStepMinutes?: number;
  allowedWeekdays?: readonly number[];
  minimumStartAt?: Date | null;
  excludeStartAt?: Date | null;
  checkSlotAvailability?: AnaVisitSlotAvailabilityChecker;
}

export interface ValidateVisitSlotStillAvailableParams {
  enterpriseId: number;
  startAt: Date;
  endAt: Date;
  preferredBrokerId?: number | null;
  excludeAppointmentId?: number | null;
  checkSlotAvailability?: AnaVisitSlotAvailabilityChecker;
}

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function norm(value: string | null | undefined): string {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatYmdInSaoPaulo(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APPOINTMENT_BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

function addDaysYmd(ymd: string, days: number): string {
  const base = new Date(`${ymd}T12:00:00${SP_OFFSET}`);
  base.setTime(base.getTime() + days * 86_400_000);
  return formatYmdInSaoPaulo(base);
}

function minutesToHm(minutes: number): string {
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  return `${pad2(hh)}:${pad2(mm)}`;
}

function formatTimeLabel(timeHm: string): string {
  const [hhRaw, mmRaw] = timeHm.split(':');
  const hh = Number.parseInt(hhRaw ?? '', 10);
  const mm = String(mmRaw ?? '00').padStart(2, '0').slice(0, 2);
  if (!Number.isFinite(hh)) return timeHm;
  return mm === '00' ? `${hh}h` : `${hh}h${mm}`;
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
  const patterns = [
    /\b(?:umas?|por volta das?)\s+(\d{1,2})(?:h(\d{2})|\s*:\s*(\d{2}))?\b/g,
    /\bas\s+(\d{1,2})(?:h(\d{2})|\s*:\s*(\d{2}))?\b/g,
    /\b(\d{1,2})h(\d{2})\b/g,
    /\b(\d{1,2})h\b/g,
    /\b(\d{1,2}):(\d{2})\b/g,
  ];
  const hits: Array<{ index: number; hm: string }> = [];
  for (const re of patterns) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(n)) !== null) {
      const hh = Number.parseInt(match[1] ?? '', 10);
      const mm = match[2] ? Number.parseInt(match[2], 10) : match[3] ? Number.parseInt(match[3], 10) : 0;
      if (hh >= 0 && hh <= 23 && mm >= 0 && mm <= 59) {
        hits.push({ index: match.index, hm: `${pad2(hh)}:${pad2(mm)}` });
      }
    }
  }
  hits.sort((a, b) => a.index - b.index);
  return hits[hits.length - 1]?.hm ?? null;
}

function parsePeriodPreference(text: string): AnaVisitPeriodPreference | null {
  const n = norm(text);
  if (/\b(de manha|manha)\b/.test(n)) return 'manha';
  if (/\b(a tarde|de tarde|tarde)\b/.test(n)) return 'tarde';
  if (/\b(a noite|de noite|noite)\b/.test(n)) return 'noite';
  return null;
}

function nextYmdForWeekday(startYmd: string, targetWeekday: number): string | null {
  for (let add = 0; add <= 28; add += 1) {
    const ymd = addDaysYmd(startYmd, add);
    if (getJsWeekdayForYmdInSaoPaulo(ymd) === targetWeekday) return ymd;
  }
  return null;
}

function nextWeekYmdForWeekday(referenceYmd: string, targetWeekday: number): string {
  const currentWeekday = getJsWeekdayForYmdInSaoPaulo(referenceYmd);
  const daysSinceMonday = currentWeekday === 0 ? 6 : currentWeekday - 1;
  const nextWeekMonday = addDaysYmd(referenceYmd, 7 - daysSinceMonday);
  const targetOffset = targetWeekday === 0 ? 6 : targetWeekday - 1;
  return addDaysYmd(nextWeekMonday, targetOffset);
}

export function extractAnaVisitSlotPreferenceFromText(
  text: string,
  referenceNow: Date = new Date(),
  options?: { preferNextWeekForWeekday?: boolean }
): AnaVisitSlotPreference {
  const n = norm(text);
  const todayYmd = formatYmdInSaoPaulo(referenceNow);
  let dateYmd: string | null = null;
  let weekday: number | null = null;
  const mentionsNextWeek = /\bsemana que vem\b/.test(n);

  if (/\bdepois de amanha\b/.test(n)) {
    dateYmd = addDaysYmd(todayYmd, 2);
  } else if (/\bamanha\b/.test(n)) {
    dateYmd = addDaysYmd(todayYmd, 1);
  } else if (/\bhoje\b/.test(n)) {
    dateYmd = todayYmd;
  } else {
    const weekdayMatch = n.match(
      /\b(domingo|segunda(?: feira)?|terca(?: feira)?|quarta(?: feira)?|quinta(?: feira)?|sexta(?: feira)?|sabado)\b/
    );
    if (weekdayMatch?.[1]) {
      weekday = weekdayTokenToJsDay(weekdayMatch[1]);
      if (weekday != null) {
        dateYmd =
          mentionsNextWeek || options?.preferNextWeekForWeekday === true
            ? nextWeekYmdForWeekday(todayYmd, weekday)
            : nextYmdForWeekday(todayYmd, weekday);
      }
    }
  }

  return {
    dateYmd,
    weekday,
    period: parsePeriodPreference(text),
    timeHm: parseTimeHmFromText(text),
  };
}

function isWeekendInSaoPaulo(referenceNow: Date): boolean {
  const ymd = formatYmdInSaoPaulo(referenceNow);
  const weekday = getJsWeekdayForYmdInSaoPaulo(ymd);
  return weekday === 0 || weekday === 6;
}

function resolveSearchStartYmd(referenceNow: Date, preference: AnaVisitSlotPreference | null): string {
  const todayYmd = formatYmdInSaoPaulo(referenceNow);
  if (preference?.dateYmd) return preference.dateYmd;
  return isWeekendInSaoPaulo(referenceNow) ? todayYmd : addDaysYmd(todayYmd, 1);
}

function slotMatchesPeriod(minutes: number, period: AnaVisitPeriodPreference | null | undefined): boolean {
  if (!period) return true;
  if (period === 'manha') return minutes >= 9 * 60 && minutes < 12 * 60;
  if (period === 'tarde') return minutes >= 13 * 60 && minutes <= 18 * 60;
  return false;
}

function dateLabelForSlot(startYmd: string, referenceNow: Date): string {
  const today = formatYmdInSaoPaulo(referenceNow);
  const tomorrow = addDaysYmd(today, 1);
  if (startYmd === today) return 'hoje';
  if (startYmd === tomorrow) return 'amanhã';

  const start = new Date(`${startYmd}T12:00:00${SP_OFFSET}`);
  const diffDays = Math.round(
    (new Date(`${startYmd}T12:00:00${SP_OFFSET}`).getTime() -
      new Date(`${today}T12:00:00${SP_OFFSET}`).getTime()) /
      86_400_000
  );
  if (diffDays >= 0 && diffDays <= 6) {
    return new Intl.DateTimeFormat('pt-BR', {
      timeZone: APPOINTMENT_BUSINESS_TZ,
      weekday: 'long',
    })
      .format(start)
      .replace(/-feira$/i, '')
      .toLowerCase();
  }

  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: APPOINTMENT_BUSINESS_TZ,
    day: '2-digit',
    month: '2-digit',
  }).format(start);
}

export function formatAnaVisitSlotLabel(slot: {
  startYmd: string;
  timeHm: string;
}, referenceNow: Date = new Date()): string {
  return `${dateLabelForSlot(slot.startYmd, referenceNow)} às ${formatTimeLabel(slot.timeHm)}`;
}

async function defaultCheckSlotAvailability(params: {
  enterpriseId: number;
  startAt: Date;
  endAt: Date;
  preferredBrokerId?: number | null;
  excludeAppointmentId?: number | null;
}): Promise<AnaVisitSlotAvailabilityResult> {
  const availability = await checkAvailability(params.enterpriseId, params.startAt, params.endAt, {
    preferredBrokerId: params.preferredBrokerId ?? null,
    excludeAppointmentId: params.excludeAppointmentId ?? null,
  });
  return {
    available: availability.available,
    brokerId: availability.suggestedBrokerId ?? null,
    eligibleBrokerCount: availability.eligibleBrokerCount,
  };
}

export async function findAvailableVisitSlots(
  params: FindAvailableVisitSlotsParams
): Promise<AnaVisitAvailabilitySlot[]> {
  const referenceNow = params.referenceNow ?? new Date();
  const preference = params.preference ?? null;
  const searchDays = Math.max(1, Math.trunc(params.searchDays ?? DEFAULT_SEARCH_DAYS));
  const maxResults = Math.max(1, Math.trunc(params.maxResults ?? 1));
  const businessStart = params.businessStartMinutes ?? DEFAULT_BUSINESS_START_MINUTES;
  const businessEnd = params.businessEndMinutes ?? DEFAULT_BUSINESS_END_MINUTES;
  const duration = params.slotDurationMinutes ?? DEFAULT_VISIT_DURATION_MINUTES;
  const step = params.slotStepMinutes ?? DEFAULT_SLOT_STEP_MINUTES;
  const allowedWeekdays = new Set(params.allowedWeekdays ?? DEFAULT_ALLOWED_WEEKDAYS);
  const checkSlot = params.checkSlotAvailability ?? defaultCheckSlotAvailability;
  const startYmd = resolveSearchStartYmd(referenceNow, preference);
  const minimumStartAt = params.minimumStartAt ?? referenceNow;
  const excludeStartAt = params.excludeStartAt ?? null;
  const results: AnaVisitAvailabilitySlot[] = [];

  for (let dayOffset = 0; dayOffset < searchDays && results.length < maxResults; dayOffset += 1) {
    const ymd = addDaysYmd(startYmd, dayOffset);
    const weekday = getJsWeekdayForYmdInSaoPaulo(ymd);
    if (!allowedWeekdays.has(weekday)) continue;
    if (preference?.weekday != null && weekday !== preference.weekday) continue;

    const dayBusinessEnd =
      weekday === 0 && params.businessEndMinutes == null
        ? Math.min(businessEnd, DEFAULT_SUNDAY_BUSINESS_END_MINUTES)
        : businessEnd;

    const exactTimeMinutes = preference?.timeHm
      ? (() => {
          const [hhRaw, mmRaw] = preference.timeHm!.split(':');
          const hh = Number.parseInt(hhRaw ?? '', 10);
          const mm = Number.parseInt(mmRaw ?? '', 10);
          return Number.isFinite(hh) && Number.isFinite(mm) ? hh * 60 + mm : null;
        })()
      : null;
    const candidateMinutes =
      exactTimeMinutes != null
        ? [exactTimeMinutes]
        : Array.from(
            { length: Math.max(0, Math.floor((dayBusinessEnd - businessStart) / step) + 1) },
            (_value, index) => businessStart + index * step
          );

    for (const minutes of candidateMinutes) {
      if (minutes < businessStart || minutes > dayBusinessEnd) continue;
      if (minutes + duration > dayBusinessEnd) continue;
      if (!slotMatchesPeriod(minutes, preference?.period ?? null)) continue;
      const timeHm = minutesToHm(minutes);
      const parsed = parseAppointmentStartEndInSaoPaulo(ymd, timeHm);
      if (!parsed) continue;
      const endAt = new Date(parsed.startAt.getTime() + duration * 60_000);
      if (parsed.startAt.getTime() <= minimumStartAt.getTime()) continue;
      if (excludeStartAt && parsed.startAt.getTime() === excludeStartAt.getTime()) continue;

      const availability = await checkSlot({
        enterpriseId: params.enterpriseId,
        startAt: parsed.startAt,
        endAt,
      });
      if (!availability.available || availability.brokerId == null) continue;

      results.push({
        enterpriseId: params.enterpriseId,
        startAt: parsed.startAt,
        endAt,
        startYmd: ymd,
        timeHm,
        brokerId: availability.brokerId,
        eligibleBrokerCount: availability.eligibleBrokerCount,
        timezone: APPOINTMENT_BUSINESS_TZ,
        label: formatAnaVisitSlotLabel({ startYmd: ymd, timeHm }, referenceNow),
      });
      if (results.length >= maxResults) break;
    }
  }

  return results;
}

export async function findNextAvailableVisitSlot(
  params: Omit<FindAvailableVisitSlotsParams, 'maxResults'>
): Promise<AnaVisitAvailabilitySlot | null> {
  const slots = await findAvailableVisitSlots({ ...params, maxResults: 1 });
  return slots[0] ?? null;
}

export async function validateVisitSlotStillAvailable(
  params: ValidateVisitSlotStillAvailableParams
): Promise<AnaVisitSlotAvailabilityResult> {
  const checkSlot = params.checkSlotAvailability ?? defaultCheckSlotAvailability;
  const availability = await checkSlot({
    enterpriseId: params.enterpriseId,
    startAt: params.startAt,
    endAt: params.endAt,
    preferredBrokerId: params.preferredBrokerId ?? null,
    excludeAppointmentId: params.excludeAppointmentId ?? null,
  });
  if (!availability.available || availability.brokerId == null) {
    return { available: false, brokerId: null, eligibleBrokerCount: availability.eligibleBrokerCount };
  }
  if (params.preferredBrokerId != null && params.preferredBrokerId > 0) {
    return availability;
  }
  return availability;
}
