export class RetryableLlmError extends Error {
  public readonly retryAfterMs: number;
  public readonly reason: string;

  constructor(message: string, params: { retryAfterMs: number; reason: string }) {
    super(message);
    this.name = 'RetryableLlmError';
    this.retryAfterMs = Math.max(1_000, Math.floor(params.retryAfterMs));
    this.reason = params.reason;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value != null && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function readStatus(error: unknown): number | null {
  const rec = asRecord(error);
  if (!rec) return null;
  const direct = rec['httpStatus'] ?? rec['status'] ?? rec['statusCode'];
  const nested = asRecord(rec['response']);
  const nestedStatus = nested?.['status'];
  const n = Number(direct ?? nestedStatus);
  return Number.isFinite(n) ? n : null;
}

function readCode(error: unknown): string {
  const rec = asRecord(error);
  if (!rec) return '';
  const nested = asRecord(rec['error']);
  return String(rec['code'] ?? rec['errorCode'] ?? nested?.['code'] ?? '').trim().toLowerCase();
}

function readType(error: unknown): string {
  const rec = asRecord(error);
  if (!rec) return '';
  const nested = asRecord(rec['error']);
  return String(rec['type'] ?? rec['errorType'] ?? nested?.['type'] ?? '').trim().toLowerCase();
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  const rec = asRecord(error);
  if (!rec) return String(error ?? '');
  const nested = asRecord(rec['error']);
  const msg = rec['message'] ?? rec['error'] ?? nested?.['message'];
  return typeof msg === 'string' ? msg : String(msg ?? '');
}

function readRetryAfterMs(error: unknown): number | null {
  const rec = asRecord(error);
  if (!rec) return null;
  const response = asRecord(rec['response']);
  const headers = asRecord(response?.['headers']) ?? asRecord(rec['headers']);
  const retryAfterRaw = headers?.['retry-after'] ?? headers?.['Retry-After'];
  if (retryAfterRaw != null) {
    const asNum = Number(retryAfterRaw);
    if (Number.isFinite(asNum) && asNum > 0) return Math.floor(asNum * 1000);
  }

  const msg = readMessage(error);
  const match = msg.match(/(?:please\s+)?try again in\s*([0-9]+(?:[.,][0-9]+)?)\s*s/i);
  if (match) {
    const normalized = match[1]?.replace(',', '.');
    const sec = Number(normalized);
    if (Number.isFinite(sec) && sec > 0) return Math.floor(sec * 1000);
  }
  return null;
}

export function isRateLimitError(error: unknown): boolean {
  const status = readStatus(error);
  const combined = `${readCode(error)} ${readType(error)} ${readMessage(error)}`.toLowerCase();
  if (status === 429) return true;
  return (
    combined.includes('rate limit reached') ||
    combined.includes('rate_limit_exceeded') ||
    combined.includes('tpm') ||
    combined.includes('rpm') ||
    combined.includes('requests per min')
  );
}

export function isRetryableLlmError(error: unknown): boolean {
  const status = readStatus(error);
  if (isRateLimitError(error)) return true;
  if (status != null && [500, 502, 503, 504].includes(status)) return true;

  const combined = `${readCode(error)} ${readType(error)} ${readMessage(error)}`.toLowerCase();
  return (
    combined.includes('timeout') ||
    combined.includes('timed out') ||
    combined.includes('network') ||
    combined.includes('socket hang up') ||
    combined.includes('econnreset') ||
    combined.includes('etimedout') ||
    combined.includes('enotfound') ||
    combined.includes('abort')
  );
}

export function extractRetryAfterMs(error: unknown): number | null {
  return readRetryAfterMs(error);
}

export function computeRetryDelayMs(params: {
  attemptCount: number;
  hasExplicitRetryAfter: boolean;
  retryAfterMs: number | null;
  error: unknown;
}): number {
  const explicit = params.retryAfterMs ?? null;
  if (params.hasExplicitRetryAfter && explicit != null) {
    return Math.min(Math.max(1_000, explicit), 300_000);
  }

  if (isRateLimitError(params.error)) {
    if (params.attemptCount <= 0) return 15_000;
    if (params.attemptCount === 1) return 30_000;
    if (params.attemptCount === 2) return 60_000;
    if (params.attemptCount === 3) return 120_000;
    return 300_000;
  }

  return 30_000;
}

export function mapRetryReason(error: unknown): string {
  if (isRateLimitError(error)) return 'openai_rate_limit';
  const status = readStatus(error);
  if (status != null && [500, 502, 503, 504].includes(status)) return 'openai_5xx';
  return 'transport_error';
}

export function sanitizeRetryErrorMessage(error: unknown): string {
  const raw = readMessage(error).replace(/(sk|rk)-[a-z0-9_-]{12,}/gi, '[redacted-key]');
  return raw.slice(0, 500);
}
