import { useCallback, useEffect, useState } from 'react';
import { AppNav } from '../components/AppNav';
import { usersApi, type UserListItem, type UserRole } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const field =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3.5 py-[10px] text-[14px] text-[#111827] placeholder:text-[#9CA3AF] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';
const card = 'bg-white rounded-[12px] border border-[#E5E7EB] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]';
const label = 'block text-[13px] font-medium text-[#6B7280] mb-1.5';
const btnPrimary =
  'inline-flex items-center justify-center text-[14px] font-semibold bg-[#F97316] text-white rounded-[10px] px-6 py-[10px] hover:bg-[#EA580C] disabled:opacity-40 transition-colors shadow-sm';
const btnSecondary =
  'inline-flex items-center justify-center text-[14px] font-medium text-[#374151] bg-white border border-[#E5E7EB] rounded-[10px] px-5 py-[10px] hover:bg-[#F9FAFB] disabled:opacity-40 transition-colors';

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserListItem | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [formName, setFormName] = useState('');
  const [formEmail, setFormEmail] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('COLLABORATOR');
  const [formActive, setFormActive] = useState(true);
  const [newPassword, setNewPassword] = useState('');

  const loadList = useCallback(() => {
    setLoading(true);
    usersApi
      .list()
      .then((d) => setUsers(d.users))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openCreate = () => {
    setEditingUser(null);
    setFormName('');
    setFormEmail('');
    setFormPassword('');
    setFormRole('COLLABORATOR');
    setFormActive(true);
    setError(null);
    setCreateOpen(true);
  };

  const openEdit = (u: UserListItem) => {
    setEditingUser(u);
    setFormName(u.name);
    setFormEmail(u.email);
    setFormRole(u.role);
    setFormActive(u.active);
    setError(null);
    setEditOpen(true);
  };

  const openPassword = (u: UserListItem) => {
    setEditingUser(u);
    setNewPassword('');
    setError(null);
    setPasswordOpen(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSaving(true);
    try {
      await usersApi.create({
        name: formName.trim(),
        email: formEmail.trim(),
        password: formPassword,
        role: formRole,
        active: formActive,
      });
      setCreateOpen(false);
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao criar usuário.');
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setError(null);
    setSaving(true);
    try {
      await usersApi.update(editingUser.id, {
        name: formName.trim(),
        email: formEmail.trim(),
        role: formRole,
        active: formActive,
      });
      setEditOpen(false);
      loadList();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao atualizar.');
    } finally {
      setSaving(false);
    }
  };

  const handlePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    setError(null);
    setSaving(true);
    try {
      await usersApi.updatePassword(editingUser.id, newPassword);
      setPasswordOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao alterar senha.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (u: UserListItem) => {
    try {
      await usersApi.update(u.id, { active: !u.active });
      loadList();
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-sm">
        <div className="max-w-[1000px] mx-auto flex items-center gap-4 px-6 h-14">
          <AppNav />
          <h1 className="text-[15px] font-semibold text-[#111827]">Usuários</h1>
        </div>
      </header>

      <div className="max-w-[1000px] mx-auto px-6 py-8">
        <p className="text-[13px] text-[#6B7280] mb-6">Gerencie usuários e perfis de acesso (ADMIN e COLLABORATOR).</p>
        <div className="flex justify-end mb-4">
          <button type="button" onClick={openCreate} className={btnPrimary}>
            Novo usuário
          </button>
        </div>

        <div className={card}>
          {loading ? (
            <div className="py-8 text-center text-[13px] text-[#6B7280]">Carregando…</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[13px]">
                <thead>
                  <tr className="border-b border-[#E5E7EB]">
                    <th className="py-3 pr-4 font-semibold text-[#111827]">Nome</th>
                    <th className="py-3 pr-4 font-semibold text-[#111827]">E-mail</th>
                    <th className="py-3 pr-4 font-semibold text-[#111827]">Perfil</th>
                    <th className="py-3 pr-4 font-semibold text-[#111827]">Ativo</th>
                    <th className="py-3 font-semibold text-[#111827]">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.id} className="border-b border-[#E5E7EB]/60">
                      <td className="py-3 pr-4 text-[#111827]">{u.name}</td>
                      <td className="py-3 pr-4 text-[#6B7280]">{u.email}</td>
                      <td className="py-3 pr-4">
                        <span className={u.role === 'ADMIN' ? 'text-[#F97316] font-medium' : 'text-[#6B7280]'}>
                          {u.role === 'ADMIN' ? 'ADMIN' : 'COLLABORATOR'}
                        </span>
                      </td>
                      <td className="py-3 pr-4">{u.active ? 'Sim' : 'Não'}</td>
                      <td className="py-3 flex items-center gap-2">
                        <button type="button" onClick={() => openEdit(u)} className="text-[#3B82F6] hover:underline text-[13px]">
                          Editar
                        </button>
                        <button type="button" onClick={() => openPassword(u)} className="text-[#3B82F6] hover:underline text-[13px]">
                          Senha
                        </button>
                        {currentUser?.id !== u.id && (
                          <button
                            type="button"
                            onClick={() => toggleActive(u)}
                            className="text-[#6B7280] hover:underline text-[13px]"
                          >
                            {u.active ? 'Desativar' : 'Ativar'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users.length === 0 && (
                <p className="py-6 text-center text-[13px] text-[#9CA3AF]">Nenhum usuário cadastrado.</p>
              )}
            </div>
          )}
        </div>
      </div>

      {createOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setCreateOpen(false)}>
          <div className="bg-white rounded-[12px] border border-[#E5E7EB] shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[18px] font-semibold text-[#111827] mb-4">Novo usuário</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              {error && <p className="text-[13px] text-red-600">{error}</p>}
              <div>
                <label className={label}>Nome</label>
                <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} className={field} required />
              </div>
              <div>
                <label className={label}>E-mail</label>
                <input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} className={field} required />
              </div>
              <div>
                <label className={label}>Senha</label>
                <input type="password" value={formPassword} onChange={(e) => setFormPassword(e.target.value)} className={field} required minLength={8} placeholder="Mín. 8 caracteres" />
              </div>
              <div>
                <label className={label}>Perfil</label>
                <select value={formRole} onChange={(e) => setFormRole(e.target.value as UserRole)} className={field}>
                  <option value="COLLABORATOR">COLLABORATOR</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="create-active" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} />
                <label htmlFor="create-active" className="text-[13px] text-[#6B7280]">Ativo</label>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Salvando…' : 'Criar'}</button>
                <button type="button" onClick={() => setCreateOpen(false)} className={btnSecondary}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {editOpen && editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setEditOpen(false)}>
          <div className="bg-white rounded-[12px] border border-[#E5E7EB] shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[18px] font-semibold text-[#111827] mb-4">Editar usuário</h2>
            <form onSubmit={handleUpdate} className="space-y-4">
              {error && <p className="text-[13px] text-red-600">{error}</p>}
              <div>
                <label className={label}>Nome</label>
                <input type="text" value={formName} onChange={(e) => setFormName(e.target.value)} className={field} required />
              </div>
              <div>
                <label className={label}>E-mail</label>
                <input type="email" value={formEmail} onChange={(e) => setFormEmail(e.target.value)} className={field} required />
              </div>
              <div>
                <label className={label}>Perfil</label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as UserRole)}
                  className={field}
                  disabled={currentUser?.id === editingUser.id}
                >
                  <option value="COLLABORATOR">COLLABORATOR</option>
                  <option value="ADMIN">ADMIN</option>
                </select>
                {currentUser?.id === editingUser.id && <p className="text-[12px] text-[#6B7280] mt-1">Você não pode alterar seu próprio perfil.</p>}
              </div>
              <div className="flex items-center gap-2">
                <input type="checkbox" id="edit-active" checked={formActive} onChange={(e) => setFormActive(e.target.checked)} disabled={currentUser?.id === editingUser.id} />
                <label htmlFor="edit-active" className="text-[13px] text-[#6B7280]">Ativo</label>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Salvando…' : 'Salvar'}</button>
                <button type="button" onClick={() => setEditOpen(false)} className={btnSecondary}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {passwordOpen && editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setPasswordOpen(false)}>
          <div className="bg-white rounded-[12px] border border-[#E5E7EB] shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-[18px] font-semibold text-[#111827] mb-4">Alterar senha — {editingUser.email}</h2>
            <form onSubmit={handlePassword} className="space-y-4">
              {error && <p className="text-[13px] text-red-600">{error}</p>}
              <div>
                <label className={label}>Nova senha</label>
                <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className={field} required minLength={8} placeholder="Mín. 8 caracteres" />
              </div>
              <div className="flex gap-2 pt-2">
                <button type="submit" disabled={saving} className={btnPrimary}>{saving ? 'Salvando…' : 'Alterar senha'}</button>
                <button type="button" onClick={() => setPasswordOpen(false)} className={btnSecondary}>Cancelar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
