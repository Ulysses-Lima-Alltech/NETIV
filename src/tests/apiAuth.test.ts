// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_UNAUTHORIZED_EVENT, ApiError, authApi, getStoredAuthToken, setStoredAuthToken } from '../api/client';

function response(status: number, body: unknown): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

describe('API auth status handling', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('clears the stored session and emits an auth event on 401', async () => {
    setStoredAuthToken('session-token');
    const event = vi.fn();
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, event);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(401, { error: 'expired' })));
    await expect(authApi.me()).rejects.toThrow('expired');
    expect(getStoredAuthToken()).toBeNull();
    expect(event).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, event);
  });

  it('keeps the session on 403 and exposes the backend error code', async () => {
    setStoredAuthToken('session-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(403, { error: 'denied', code: 'OUT_OF_SCOPE' })));
    let error: unknown;
    try {
      await authApi.me();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(403);
    expect((error as ApiError).code).toBe('OUT_OF_SCOPE');
    expect(getStoredAuthToken()).toBe('session-token');
  });
});
