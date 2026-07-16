// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { setStoredAuthToken } from '../api/client';

vi.mock('../realtime/socketClient', () => ({
  disconnectInboxSocket: vi.fn(),
  reconnectInboxSocket: vi.fn(),
}));

function Probe() {
  const { user, loading } = useAuth();
  return <div>{loading ? 'LOADING' : user?.username ?? 'NO_USER'}</div>;
}

function response(body: unknown): Response {
  return { status: 200, ok: true, json: async () => body } as Response;
}

afterEach(cleanup);

describe('AuthProvider session restore', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn());
  });

  it('restores an existing valid session with /auth/me', async () => {
    setStoredAuthToken('stored-session');
    vi.mocked(fetch).mockResolvedValue(response({
      user: { id: 7, username: 'ulysses', name: 'Ulysses', email: null, role: 'ADMIN', active: true, mustChangePassword: false },
      session: null,
    }));
    render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('ulysses')).toBeTruthy());
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/auth/me'), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer stored-session' }),
    }));
  });

  it('does not synthesize an authenticated identity when no token exists', async () => {
    render(<MemoryRouter><AuthProvider><Probe /></AuthProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('NO_USER')).toBeTruthy());
    expect(fetch).not.toHaveBeenCalled();
  });
});
