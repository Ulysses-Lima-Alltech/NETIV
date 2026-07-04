const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;
const TZ = 'America/Sao_Paulo';

const ANA_FOLLOWUP_OFFSETS_MINUTES = [
  5, 6, 7, 8, 9,
  69, 70, 71, 72, 73,
  313, 314, 315, 316, 317,
  617, 618, 619, 620, 621,
] as const;

/**
 * Official Ana follow-up cadence, expressed as an offset from the anchor assistant message.
 * No sends are allowed from 23:59 through 06:59 in America/Sao_Paulo.
 */
export function getAnaFollowupDelayMinutes(attemptIndex: number): number {
  if (!Number.isInteger(attemptIndex) || attemptIndex < 1) {
    throw new RangeError(`Invalid Ana follow-up attempt index: ${attemptIndex}`);
  }

  const offset = ANA_FOLLOWUP_OFFSETS_MINUTES[attemptIndex - 1];
  if (offset == null) {
    throw new RangeError(`Ana follow-up attempt index exceeds cadence: ${attemptIndex}`);
  }
  return offset;
}

export function getAnaFollowupDelayMs(attemptIndex: number): number {
  return getAnaFollowupDelayMinutes(attemptIndex) * MINUTE_MS;
}

function spHourMinute(utcMs: number): { h: number; m: number } {
  const dtf = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const hp = parts.find((p) => p.type === 'hour')?.value;
  const mp = parts.find((p) => p.type === 'minute')?.value;
  return { h: Number.parseInt(hp ?? '0', 10), m: Number.parseInt(mp ?? '0', 10) };
}

export function isAnaFollowupForbiddenNightWindowSp(utcMs: number): boolean {
  const { h, m } = spHourMinute(utcMs);
  return h < 7 || (h === 23 && m >= 59);
}

function moveAnaFollowupToAllowedWindow(date: Date): Date {
  let t = Math.ceil(date.getTime() / MINUTE_MS) * MINUTE_MS;
  for (let i = 0; i <= DAY_MS / MINUTE_MS; i += 1) {
    if (!isAnaFollowupForbiddenNightWindowSp(t)) return new Date(t);
    t += MINUTE_MS;
  }
  return new Date(t);
}

export function computeAnaFollowupAtUtc(params: {
  anchor: Date;
  attemptIndex: number;
  notBefore?: Date | null;
}): Date {
  const anchorMs = params.anchor.getTime();
  if (Number.isNaN(anchorMs)) {
    throw new RangeError('Invalid Ana follow-up anchor date');
  }

  const scheduled = new Date(anchorMs + getAnaFollowupDelayMs(params.attemptIndex));
  const notBefore = params.notBefore ?? null;
  const candidate = notBefore && scheduled.getTime() < notBefore.getTime() ? notBefore : scheduled;
  return moveAnaFollowupToAllowedWindow(candidate);
}
