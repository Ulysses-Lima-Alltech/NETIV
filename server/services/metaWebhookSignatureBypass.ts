export type MetaWebhookSignatureBypassReason =
  | 'allow_unsigned_not_explicit_true'
  | 'allow_unsigned_until_missing'
  | 'allow_unsigned_until_invalid'
  | 'allow_unsigned_until_expired';

export interface MetaWebhookSignatureBypassDecision {
  active: boolean;
  expiresAt: string | null;
  now: string;
  reason: MetaWebhookSignatureBypassReason | 'temporary_unsigned_webhook_contingency';
}

export interface MetaWebhookSignatureBypassOptions {
  env?: NodeJS.ProcessEnv;
  now?: Date;
}

/**
 * This is intentionally a narrow, time-bounded contingency for Meta's public
 * webhook POST. Callers must never use it as a general authentication bypass.
 */
export function getMetaWebhookSignatureBypassDecision(
  options: MetaWebhookSignatureBypassOptions = {}
): MetaWebhookSignatureBypassDecision {
  const env = options.env ?? process.env;
  const now = options.now ?? new Date();
  const nowMs = now.getTime();
  const nowIso = Number.isFinite(nowMs) ? now.toISOString() : new Date(0).toISOString();
  const allowUnsigned = String(env.META_WEBHOOK_ALLOW_UNSIGNED ?? '').trim().toLowerCase() === 'true';
  const rawUntil = String(env.META_WEBHOOK_ALLOW_UNSIGNED_UNTIL ?? '').trim();

  if (!allowUnsigned) {
    return { active: false, expiresAt: null, now: nowIso, reason: 'allow_unsigned_not_explicit_true' };
  }
  if (!rawUntil) {
    return { active: false, expiresAt: null, now: nowIso, reason: 'allow_unsigned_until_missing' };
  }

  const expiresAtMs = Date.parse(rawUntil);
  if (!Number.isFinite(expiresAtMs)) {
    return { active: false, expiresAt: null, now: nowIso, reason: 'allow_unsigned_until_invalid' };
  }

  const expiresAt = new Date(expiresAtMs).toISOString();
  if (!(nowMs < expiresAtMs)) {
    return { active: false, expiresAt, now: nowIso, reason: 'allow_unsigned_until_expired' };
  }

  return { active: true, expiresAt, now: nowIso, reason: 'temporary_unsigned_webhook_contingency' };
}

export function isMetaWebhookSignatureBypassActive(options: MetaWebhookSignatureBypassOptions = {}): boolean {
  return getMetaWebhookSignatureBypassDecision(options).active;
}
