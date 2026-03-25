import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { authApi, getStoredAuthToken, setStoredAuthToken, type AuthUser } from '../api/client';

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
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadUser = useCallback(async () => {
    const token = getStoredAuthToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await authApi.me();
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUser();
  }, [loadUser]);

  // ── SSO via postMessage (quando dentro do iframe do Django) ──
  // O Django NÃO coloca o token na URL (seria interceptável via proxy).
  // Em vez disso, envia via postMessage — um canal interno do browser que
  // NÃO passa pela rede, NÃO é interceptável via Burp Suite.
  useEffect(() => {
    function handleSsoMessage(event: MessageEvent) {
      // SEGURANÇA: só aceitar mensagens da origem do Django
      // Se um site malicioso tentar enviar postMessage, o origin será diferente
      // e a mensagem será ignorada.
      const allowedOrigins = [
        'https://app.queromeuape.com.br',
        'http://localhost:8000',   // dev local
      ];
      if (!allowedOrigins.includes(event.origin)) return;

      // Verificar que é uma mensagem SSO (e não qualquer postMessage aleatório)
      if (event.data?.type !== 'sso_token') return;

      const ssoToken = event.data?.token;
      if (typeof ssoToken === 'string' && ssoToken.length > 0) {
        // Salvar o token e carregar o usuário
        setStoredAuthToken(ssoToken);
        loadUser();
      }
    }

    window.addEventListener('message', handleSsoMessage);
    return () => window.removeEventListener('message', handleSsoMessage);
  }, [loadUser]);

  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    const data = await authApi.login(email, password);
    setStoredAuthToken(data.token);
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // ignora erro de rede
    }
    setStoredAuthToken(null);
    setUser(null);
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
