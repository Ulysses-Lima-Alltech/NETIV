import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const field = 'w-full rounded-[10px] border border-[#E5E7EB] bg-white px-3.5 py-[10px] text-[14px] focus:border-[#3B82F6] focus:outline-none focus:ring-[3px] focus:ring-blue-100';

export function ChangePasswordPage() {
  const { changePassword, logout } = useAuth();
  const navigate = useNavigate();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) return setError('A confirmação da nova senha não confere.');
    if (newPassword === currentPassword) return setError('A nova senha deve ser diferente da senha atual.');
    setSaving(true);
    try {
      await changePassword(currentPassword, newPassword, confirmPassword);
      navigate('/inbox', { replace: true });
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'Erro ao alterar senha.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#F9FAFB] p-4">
      <div className="w-full max-w-[420px] rounded-[12px] border border-[#E5E7EB] bg-white p-6 shadow-sm">
        <h1 className="text-[20px] font-semibold text-[#111827]">Crie uma nova senha</h1>
        <p className="mb-5 mt-1 text-[13px] text-[#6B7280]">Esta etapa é obrigatória antes de acessar a plataforma.</p>
        {error && <div role="alert" className="mb-4 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</div>}
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-[13px] font-medium text-[#374151]">Senha atual<input className={`${field} mt-1.5`} type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required /></label>
          <label className="block text-[13px] font-medium text-[#374151]">Nova senha<input className={`${field} mt-1.5`} type="password" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required /></label>
          <label className="block text-[13px] font-medium text-[#374151]">Confirmar nova senha<input className={`${field} mt-1.5`} type="password" autoComplete="new-password" minLength={8} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required /></label>
          <button className="w-full rounded-[10px] bg-[#F97316] px-5 py-[10px] text-sm font-semibold text-white hover:bg-[#EA580C] disabled:opacity-50" disabled={saving}>{saving ? 'Salvando…' : 'Alterar senha'}</button>
          <button type="button" className="w-full rounded-[10px] border border-[#E5E7EB] px-5 py-[10px] text-sm font-medium text-[#4B5563]" onClick={() => void logout()}>Sair</button>
        </form>
      </div>
    </div>
  );
}
