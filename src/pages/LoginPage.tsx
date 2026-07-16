import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const field =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3.5 py-[10px] text-[14px] text-[#111827] placeholder:text-[#9CA3AF] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

const btnPrimary =
  'w-full inline-flex items-center justify-center gap-2 text-[14px] font-semibold bg-[#F97316] text-white rounded-[10px] px-6 py-[10px] hover:bg-[#EA580C] active:bg-[#C2410C] disabled:opacity-40 transition-colors shadow-sm';

export function LoginPage() {
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!loading && user) navigate(user.mustChangePassword ? '/change-password' : '/inbox', { replace: true });
  }, [loading, user, navigate]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const authenticatedUser = await login(identifier.trim(), password);
      navigate(authenticatedUser.mustChangePassword ? '/change-password' : '/inbox', { replace: true });
    } catch (err) {
      let msg = err instanceof Error ? err.message : 'Erro inesperado ao fazer login.';
      if (err instanceof TypeError || msg === 'Failed to fetch') {
        msg = 'Erro de rede. Verifique sua conexão ou se o servidor está em execução.';
      }
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F9FAFB] p-4">
      <div className="w-full max-w-[380px] bg-white rounded-[12px] border border-[#E5E7EB] shadow-[0_1px_2px_rgba(0,0,0,0.04)] p-6">
        <h1 className="text-[20px] font-semibold text-[#111827] mb-1">Entrar</h1>
        <p className="text-[13px] text-[#6B7280] mb-4">Use seu usuário ou e-mail e senha para acessar.</p>
        {error && (
          <div
            role="alert"
            className="flex items-start gap-2 text-[13px] text-red-700 bg-red-50 border border-red-100 rounded-[10px] px-4 py-3 mb-4"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0 mt-px">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="login-identifier" className="block text-[13px] font-medium text-[#6B7280] mb-1.5">
              Usuário ou e-mail
            </label>
            <input
              id="login-identifier"
              type="text"
              autoComplete="username"
              value={identifier}
              onChange={(e) => {
                setError(null);
                setIdentifier(e.target.value);
              }}
              className={field}
              placeholder="seu.usuario"
              required
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-[13px] font-medium text-[#6B7280] mb-1.5">
              Senha
            </label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setError(null);
                setPassword(e.target.value);
              }}
              className={field}
              placeholder="••••••••"
              required
            />
          </div>
          <button type="submit" disabled={submitting} className={btnPrimary}>
            {submitting ? 'Entrando…' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  );
}
