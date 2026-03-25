/**
 * Normalização de data (YYYY-MM-DD) vinda da ANA/JSON.
 * Usa America/Sao_Paulo como referência de "hoje" (sem DST desde 2019: -03:00).
 */

export const APPOINTMENT_BUSINESS_TZ = 'America/Sao_Paulo';
/** Offset fixo para São Paulo (sem horário de verão). */
const SP_OFFSET = '-03:00';

function formatYmdInSaoPaulo(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APPOINTMENT_BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function parseYmdParts(ymd: string): { y: number; m: number; d: number } | null {
  const m = ymd.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  const da = parseInt(m[3], 10);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(da)) return null;
  return { y, m: mo, d: da };
}

/** Meia-noite (início do dia) em São Paulo, como Date instantâneo. */
function startOfDaySaoPaulo(ymd: string): Date | null {
  const p = parseYmdParts(ymd);
  if (!p) return null;
  const s = `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
  const d = new Date(`${s}T00:00:00${SP_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Corrige anos absurdos (ex.: 2023 vindo do modelo) e datas já passadas no calendário local SP.
 */
export function normalizeAnaAppointmentDateYmd(ymd: string, referenceNow: Date = new Date()): string | null {
  const p = parseYmdParts(ymd);
  if (!p) return null;
  const todayYmd = formatYmdInSaoPaulo(referenceNow);
  const todayP = parseYmdParts(todayYmd);
  if (!todayP) return null;

  let y = p.y;
  const { m, d } = p;
  const cy = todayP.y;

  if (y < cy - 1 || y < 2000) y = cy;
  if (y > cy + 2) y = cy;

  let candidate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const dayStart = startOfDaySaoPaulo(candidate);
  const todayStart = startOfDaySaoPaulo(todayYmd);
  if (!dayStart || !todayStart) return candidate;

  if (dayStart < todayStart) {
    y = cy;
    candidate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const dayStart2 = startOfDaySaoPaulo(candidate);
    if (dayStart2 && dayStart2 < todayStart) {
      y = cy + 1;
      candidate = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
  }

  return candidate;
}

/**
 * Combina Y-M-D + HH:MM interpretando o horário em São Paulo (offset fixo -03:00).
 */
export function parseAppointmentStartEndInSaoPaulo(
  dateYmd: string,
  timeHm: string
): { startAt: Date; endAt: Date } | null {
  const d = dateYmd.trim();
  const t = timeHm.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  if (!/^\d{1,2}:\d{2}$/.test(t)) return null;
  const [hh, mm] = t.split(':').map((x) => parseInt(x, 10));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  const tNorm = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  const startAt = new Date(`${d}T${tNorm}:00${SP_OFFSET}`);
  if (Number.isNaN(startAt.getTime())) return null;
  const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
  return { startAt, endAt };
}
