import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 10_000;
let lastSweepAt = 0;

function positiveEnv(name: string, fallback: number): number {
  const value = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function clientIp(req: Request): string {
  return String(req.ip || req.socket.remoteAddress || 'unknown').slice(0, 160);
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sweep(now: number): void {
  if (now - lastSweepAt < 60_000 && buckets.size < MAX_BUCKETS) return;
  lastSweepAt = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  while (buckets.size >= MAX_BUCKETS) {
    const oldest = buckets.keys().next().value as string | undefined;
    if (!oldest) break;
    buckets.delete(oldest);
  }
}

function consume(key: string, limit: number, windowMs: number, now: number): Bucket {
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + windowMs };
    buckets.set(key, fresh);
    return fresh;
  }
  current.count++;
  return current;
}

function limiter(kind: 'login' | 'sso') {
  return (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    sweep(now);
    const prefix = kind === 'login' ? 'AUTH_LOGIN' : 'AUTH_SSO';
    const limit = positiveEnv(`${prefix}_RATE_LIMIT_MAX`, kind === 'login' ? 10 : 20);
    const windowMs = positiveEnv(`${prefix}_RATE_LIMIT_WINDOW_MS`, 15 * 60_000);
    const ip = clientIp(req);
    const checks = [consume(`${kind}:ip:${digest(ip)}`, limit, windowMs, now)];
    if (kind === 'login') {
      const identity = String(req.body?.identifier ?? req.body?.email ?? '').trim().toLowerCase();
      if (identity) checks.push(consume(`${kind}:identity:${digest(`${ip}:${identity}`)}`, limit, windowMs, now));
    }
    const blocked = checks.find((bucket) => bucket.count > limit);
    if (blocked) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((blocked.resetAt - now) / 1000))));
      res.status(429).json({ error: 'Muitas tentativas. Tente novamente mais tarde.', code: 'RATE_LIMITED' });
      return;
    }
    next();
  };
}

export const loginRateLimit = limiter('login');
export const ssoRateLimit = limiter('sso');

export function resetRateLimitForTests(): void {
  buckets.clear();
  lastSweepAt = 0;
}
