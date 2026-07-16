import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { loginRateLimit, resetRateLimitForTests, ssoRateLimit } from '../middleware/rateLimit.js';

beforeEach(() => {
  resetRateLimitForTests();
  process.env.AUTH_LOGIN_RATE_LIMIT_MAX = '2';
  process.env.AUTH_SSO_RATE_LIMIT_MAX = '1';
});

function response() {
  return {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) { this.headers[name] = value; },
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
}

test('login rate limit blocks repeated IP/identity attempts with a generic 429', () => {
  const req = { ip: '127.0.0.1', socket: {}, body: { identifier: 'unknown.user' } } as never;
  let nextCalls = 0;
  for (let index = 0; index < 3; index++) loginRateLimit(req, response() as never, () => { nextCalls++; });
  const blocked = response();
  loginRateLimit(req, blocked as never, () => { nextCalls++; });
  assert.equal(nextCalls, 2);
  assert.equal(blocked.statusCode, 429);
  assert.deepEqual(blocked.body, { error: 'Muitas tentativas. Tente novamente mais tarde.', code: 'RATE_LIMITED' });
  assert.ok(blocked.headers['Retry-After']);
});

test('SSO rate limit is IP based and configurable', () => {
  const req = { ip: '127.0.0.2', socket: {}, body: { token: 'opaque' } } as never;
  let allowed = 0;
  ssoRateLimit(req, response() as never, () => { allowed++; });
  const blocked = response();
  ssoRateLimit(req, blocked as never, () => { allowed++; });
  assert.equal(allowed, 1);
  assert.equal(blocked.statusCode, 429);
});
