import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { authApi, setStoredAuthToken, type AuthUser } from '../api/client';

/** Fallback só para não quebrar a UI se `/auth/me` falhar (rede/indisponível). Alinhado ao papel ADMIN para menus. */
const EMBEDDED_UI_USER: AuthUser = {
  id: 0,
  name: 'ANA',
  email: 'embedded@local',
  role: 'ADMIN',
};

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
}

interface AuthContextValue extends AuthState {
  /** Apenas ADMIN: acesso total, inclusive configurações (integrações/IA). */
  isAdmin: boolean;
  /** ADMIN ou MANAGERIAL: telas administrativas (exceto configurações sensíveis). */
  hasElevatedAccess: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadUser = useCallback(async () => {
    try {
      const data = await authApi.me();
      setUser(data.user);
    } catch {
      setStoredAuthToken(null);
      setUser(EMBEDDED_UI_USER);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadUser();
  }, [loadUser]);

  const value: AuthContextValue = {
    user,
    loading,
    isAdmin: user?.role === 'ADMIN',
    hasElevatedAccess: user?.role === 'ADMIN' || user?.role === 'MANAGERIAL',
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
