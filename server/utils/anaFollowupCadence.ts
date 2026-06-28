const MINUTE_MS = 60_000;

/**
 * Official Ana follow-up cadence, expressed as an offset from the anchor assistant message.
 *
 * Attempts 1-5:  +1, +2, +3, +4, +5 minutes
 * Attempts 6-8:  +65, +125, +185 minutes
 * Attempts 9-13: +186, +187, +188, +189, +190 minutes
 * Attempts 14+:  +310, +430, +550... minutes
 */
export function getAnaFollowupDelayMinutes(attemptIndex: number): number {
  if (!Number.isInteger(attemptIndex) || attemptIndex < 1) {
    throw new RangeError(`Invalid Ana follow-up attempt index: ${attemptIndex}`);
  }

  if (attemptIndex <= 5) return attemptIndex;
  if (attemptIndex <= 8) return 65 + (attemptIndex - 6) * 60;
  if (attemptIndex <= 13) return 186 + (attemptIndex - 9);
  return 310 + (attemptIndex - 14) * 120;
}

export function getAnaFollowupDelayMs(attemptIndex: number): number {
  return getAnaFollowupDelayMinutes(attemptIndex) * MINUTE_MS;
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
  if (notBefore && scheduled.getTime() < notBefore.getTime()) return notBefore;
  return scheduled;
}
