import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AUTH_UNAUTHORIZED_EVENT,
  authApi,
  getStoredAuthToken,
  setStoredAuthToken,
  type AuthUser,
} from '../api/client';
import { disconnectInboxSocket, reconnectInboxSocket } from '../realtime/socketClient';

export interface SessionScope {
  scopeKind: string | null;
  scopeSize: number | null;
  scopeTotal: number | null;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  sessionScope: SessionScope | null;
  isAdmin: boolean;
  hasElevatedAccess: boolean;
  isBrokerScoped: boolean;
  login: (identifier: string, password: string) => Promise<AuthUser>;
  changePassword: (currentPassword: string, newPassword: string, confirmPassword: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function allowedSsoOrigins(): Set<string> {
  return new Set(
    String(import.meta.env.VITE_SSO_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionScope, setSessionScope] = useState<SessionScope | null>(null);

  const clearSession = useCallback((redirect = true) => {
    setStoredAuthToken(null);
    setUser(null);
    setSessionScope(null);
    disconnectInboxSocket();
    if (redirect) navigate('/login', { replace: true });
  }, [navigate]);

  const restoreSession = useCallback(async () => {
    const token = getStoredAuthToken();
    if (!token) {
      setUser(null);
      setSessionScope(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await authApi.me();
      setUser(response.user);
      setSessionScope(response.session ?? null);
      setError(null);
      reconnectInboxSocket();
    } catch {
      clearSession(false);
    } finally {
      setLoading(false);
    }
  }, [clearSession]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void restoreSession(), 0);
    return () => window.clearTimeout(timeout);
  }, [restoreSession]);

  useEffect(() => {
    const handleUnauthorized = () => {
      setError(null);
      clearSession(true);
      setLoading(false);
    };
    window.addEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
    return () => window.removeEventListener(AUTH_UNAUTHORIZED_EVENT, handleUnauthorized);
  }, [clearSession]);

  useEffect(() => {
    const origins = allowedSsoOrigins();
    const handleMessage = (event: MessageEvent) => {
      if (window.parent === window || event.source !== window.parent) return;
      if (!origins.has(event.origin)) return;
      const payload = event.data as { type?: unknown; token?: unknown } | null;
      if (payload?.type !== 'sso_token' || typeof payload.token !== 'string' || !payload.token.trim()) return;
      setStoredAuthToken(payload.token.trim());
      void restoreSession();
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [restoreSession]);

  const login = useCallback(async (identifier: string, password: string): Promise<AuthUser> => {
    setError(null);
    setLoading(true);
    try {
      const response = await authApi.login(identifier, password);
      setStoredAuthToken(response.token);
      setUser(response.user);
      setSessionScope(null);
      reconnectInboxSocket();
      return response.user;
    } catch (loginError) {
      const message = loginError instanceof Error ? loginError.message : 'Erro ao fazer login';
      setError(message);
      throw loginError;
    } finally {
      setLoading(false);
    }
  }, []);

  const changePassword = useCallback(async (currentPassword: string, newPassword: string, confirmPassword: string) => {
    setError(null);
    setLoading(true);
    try {
      const response = await authApi.changePassword({ currentPassword, newPassword, confirmPassword });
      setStoredAuthToken(response.token);
      setUser(response.user);
      setSessionScope(null);
      reconnectInboxSocket();
    } catch (changeError) {
      const message = changeError instanceof Error ? changeError.message : 'Erro ao alterar senha';
      setError(message);
      throw changeError;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    try {
      await authApi.logout();
    } catch {
      // A limpeza local é obrigatória mesmo se a sessão já tiver expirado.
    } finally {
      clearSession(true);
      setLoading(false);
    }
  }, [clearSession]);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    loading,
    error,
    sessionScope,
    isAdmin: user?.role === 'ADMIN',
    hasElevatedAccess: user?.role === 'ADMIN' || user?.role === 'MANAGERIAL',
    isBrokerScoped: sessionScope?.scopeKind === 'broker_portfolio',
    login,
    changePassword,
    logout,
    clearError: () => setError(null),
  }), [user, loading, error, sessionScope, login, changePassword, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
