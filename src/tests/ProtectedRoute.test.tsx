// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ProtectedRoute } from '../components/ProtectedRoute';
import type { AuthUser } from '../api/client';

let authState: { user: AuthUser | null; loading: boolean } = { user: null, loading: false };
vi.mock('../contexts/AuthContext', () => ({ useAuth: () => authState }));

const user = (role: AuthUser['role'], mustChangePassword = false): AuthUser => ({
  id: 1, username: 'tester', name: 'Tester', email: null, role, active: true, mustChangePassword,
});

function renderProtected(roles?: AuthUser['role'][]) {
  render(
    <MemoryRouter initialEntries={['/users']}>
      <Routes>
        <Route path="/login" element={<div>LOGIN</div>} />
        <Route path="/change-password" element={<div>CHANGE_PASSWORD</div>} />
        <Route path="/users" element={<ProtectedRoute roles={roles}><div>ACESSOS</div></ProtectedRoute>} />
      </Routes>
    </MemoryRouter>
  );
}

afterEach(cleanup);

describe('ProtectedRoute', () => {
  it('redirects an unauthenticated user to login', () => {
    authState = { user: null, loading: false };
    renderProtected();
    expect(screen.getByText('LOGIN')).toBeTruthy();
  });

  it('redirects mandatory password changes before rendering the application', () => {
    authState = { user: user('ADMIN', true), loading: false };
    renderProtected(['ADMIN', 'MANAGERIAL']);
    expect(screen.getByText('CHANGE_PASSWORD')).toBeTruthy();
  });

  it.each(['ADMIN', 'MANAGERIAL'] as const)('%s can open Acessos', (role) => {
    authState = { user: user(role), loading: false };
    renderProtected(['ADMIN', 'MANAGERIAL']);
    expect(screen.getByText('ACESSOS')).toBeTruthy();
  });

  it('denies Acessos to a collaborator', () => {
    authState = { user: user('COLLABORATOR'), loading: false };
    renderProtected(['ADMIN', 'MANAGERIAL']);
    expect(screen.getByText('Acesso negado')).toBeTruthy();
    expect(screen.queryByText('ACESSOS')).toBeNull();
  });
});
