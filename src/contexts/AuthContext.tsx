import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { AUTH_BYPASS_MOCK_USER, setStoredAuthToken, authApi, type AuthUser } from '../api/client';

export interface SessionScope {
  scopeKind: string | null;
  scopeSize: number | null;
  scopeTotal: number | null;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
  sessionScope: SessionScope | null;
}

interface AuthContextValue extends AuthState {
  /** Apenas ADMIN: acesso total, inclusive configurações (integrações/IA). */
  isAdmin: boolean;
  /** ADMIN ou MANAGERIAL: telas administrativas (exceto configurações sensíveis). */
  hasElevatedAccess: boolean;
  /** Verdadeiro se o usuário tem escopo de carteira de broker (broker_portfolio). */
  isBrokerScoped: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SSO_BOOT_TIMEOUT_MS = 7000;

function isEmbeddedInIframe(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionScope, setSessionScope] = useState<SessionScope | null>(null);

  // Função para carregar usuário real via API
  const loadRealUser = useCallback(async () => {
    try {
      const response = await authApi.me();
      setUser(response.user);
      setSessionScope(response.session ?? null);
      setError(null);
    } catch (err) {
      console.error('[Auth] Falha ao carregar usuário:', err);
      setError('Falha ao autenticar via SSO');
    } finally {
      setLoading(false);
    }
  }, []);

  // Função para ativar bypass (fallback temporário)
  const activateBypass = useCallback(() => {
    console.log('[Auth] Ativando bypass mock user');
    setStoredAuthToken(null);
    setUser(AUTH_BYPASS_MOCK_USER);
    setSessionScope(null);
    setError(null);
    setLoading(false);
  }, []);

  // Listener para postMessage com token SSO
  useEffect(() => {
    const embedded = isEmbeddedInIframe();

    const handleMessage = (event: MessageEvent) => {
      // Verificar se é um evento SSO válido
      if (event.data && event.data.type === 'sso_token' && event.data.token) {
        console.log('[Auth] Recebido token SSO via postMessage');
        
        // Salvar o token e carregar usuário real
        setStoredAuthToken(event.data.token);
        void loadRealUser();
      }
    };

    // Adicionar listener
    window.addEventListener('message', handleMessage);

    // Timeout para fallback (se não receber SSO em 7 segundos)
    const timeoutId = setTimeout(() => {
      if (!user && loading) {
        if (embedded) {
          console.info('[Auth] Aguardando sincronismo do SSO dentro do iframe');
          return;
        }
        activateBypass();
      }
    }, SSO_BOOT_TIMEOUT_MS);

    return () => {
      window.removeEventListener('message', handleMessage);
      clearTimeout(timeoutId);
    };
  }, [user, loading, loadRealUser, activateBypass]);

  // Login normal (formulário)
  const login = useCallback(async (email: string, password: string) => {
    setError(null);
    setLoading(true);
    try {
      const response = await authApi.login(email, password);
      setStoredAuthToken(response.token);
      setUser(response.user);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao fazer login');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      await authApi.logout();
    } catch (err) {
      console.error('[Auth] Erro no logout:', err);
    } finally {
      setStoredAuthToken(null);
      setUser(null);
      setSessionScope(null);
      setLoading(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const value: AuthContextValue = {
    user,
    loading,
    error,
    sessionScope,
    isAdmin: user?.role === 'ADMIN',
    hasElevatedAccess: user?.role === 'ADMIN' || user?.role === 'MANAGERIAL',
    isBrokerScoped: sessionScope?.scopeKind === 'broker_portfolio',
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
