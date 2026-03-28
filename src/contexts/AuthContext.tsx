import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { AUTH_BYPASS_MOCK_USER, setStoredAuthToken, type AuthUser } from '../api/client';

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextValue extends AuthState {
  /** Apenas ADMIN: acesso total, inclusive configurações (integrações/IA). */
  isAdmin: boolean;
  /** ADMIN ou MANAGERIAL: telas administrativas (exceto configurações sensíveis). */
  hasElevatedAccess: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(AUTH_BYPASS_MOCK_USER);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadUser = useCallback(async () => {
    setStoredAuthToken(null);
    setUser(AUTH_BYPASS_MOCK_USER);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const login = useCallback(async (_email: string, _password: string) => {
    setError(null);
    setStoredAuthToken(null);
    setUser(AUTH_BYPASS_MOCK_USER);
  }, []);

  const logout = useCallback(async () => {
    setStoredAuthToken(null);
    setUser(AUTH_BYPASS_MOCK_USER);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value: AuthContextValue = {
    user,
    loading,
    error,
    isAdmin: user?.role === 'ADMIN',
    hasElevatedAccess: user?.role === 'ADMIN' || user?.role === 'MANAGERIAL',
    login,
    logout,
    clearError,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
