import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  userRoleLabel,
  usersApi,
  type AssignableResources,
  type UserListItem,
  type UserRole,
  type UserScopeInput,
} from '../api/client';
import { AppNav } from '../components/AppNav';
import { useAuth } from '../contexts/AuthContext';

const field = 'w-full rounded-[9px] border border-[#D1D5DB] bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100';
const emptyScope = (): UserScopeInput => ({ managerId: null, enterpriseIds: [], brokerIds: [], conversationIds: [], contactIds: [], appointmentIds: [] });

function toggleId(ids: number[], id: number): number[] {
  return ids.includes(id) ? ids.filter((item) => item !== id) : [...ids, id];
}

export function UsersPage() {
  const { user: actor } = useAuth();
  const isAdmin = actor?.role === 'ADMIN';
  const [users, setUsers] = useState<UserListItem[]>([]);
  const [resources, setResources] = useState<AssignableResources>({ enterprises: [], brokers: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UserListItem | 'new' | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<UserRole>('COLLABORATOR');
  const [active, setActive] = useState(true);
  const [scope, setScope] = useState<UserScopeInput>(emptyScope());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [userResult, resourceResult] = await Promise.all([usersApi.list(), usersApi.resources()]);
      setUsers(userResult.users);
      setResources(resourceResult);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Erro ao carregar acessos.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const managers = useMemo(() => users.filter((item) => item.role === 'MANAGERIAL' && item.active), [users]);

  const openCreate = () => {
    setEditing('new');
    setName(''); setUsername(''); setEmail(''); setPassword(''); setRole('COLLABORATOR'); setActive(true); setScope(emptyScope()); setError(null);
  };

  const openEdit = (item: UserListItem) => {
    setEditing(item);
    setName(item.name); setUsername(item.username ?? ''); setEmail(item.email ?? ''); setPassword(''); setRole(item.role); setActive(item.active);
    setScope({
      managerId: item.scope.managerId,
      enterpriseIds: item.scope.enterpriseIds,
      brokerIds: item.scope.brokerIds,
      conversationIds: item.scope.conversationIds,
      contactIds: item.scope.contactIds,
      appointmentIds: item.scope.appointmentIds,
    });
    setError(null);
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing) return;
    setSaving(true);
    setError(null);
    try {
      if (editing === 'new') {
        const submittedScope = role === 'COLLABORATOR' ? scope : { ...scope, managerId: null };
        await usersApi.create({
          name, username, email: email || null, password, role, active, ...submittedScope,
          allowDirectAssignment: role === 'COLLABORATOR' && submittedScope.managerId == null,
        });
      } else {
        const submittedScope = role === 'COLLABORATOR' ? scope : { ...scope, managerId: null };
        await usersApi.update(editing.id, isAdmin
          ? { name, username, email: email || null, role, active }
          : { name, email: email || null });
        if (role !== 'ADMIN') await usersApi.updateScope(editing.id, submittedScope);
      }
      setEditing(null);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Erro ao salvar acesso.');
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (item: UserListItem) => {
    const nextPassword = window.prompt(`Defina uma senha temporária para ${item.username ?? item.name} (mínimo 8 caracteres):`);
    if (!nextPassword) return;
    try {
      await usersApi.updatePassword(item.id, nextPassword);
      await load();
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Erro ao redefinir senha.');
    }
  };

  const revokeSessions = async (item: UserListItem) => {
    try {
      await usersApi.revokeSessions(item.id);
      setError(null);
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Erro ao encerrar sessões.');
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <header className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white/90 backdrop-blur">
        <div className="flex h-14 items-center gap-4 px-6 lg:px-8"><AppNav /><h1 className="text-[15px] font-semibold text-[#111827]">Acessos</h1></div>
      </header>
      <main className="px-6 py-8 lg:px-8">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div><p className="text-sm text-[#4B5563]">{isAdmin ? 'Gerencie identidades, perfis, escopos e sessões.' : 'Gerencie dados operacionais e escopos dos seus colaboradores.'}</p>{error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}</div>
          {isAdmin && <button onClick={openCreate} className="rounded-[9px] bg-[#F97316] px-4 py-2 text-sm font-semibold text-white">Novo acesso</button>}
        </div>
        <div className="overflow-x-auto rounded-xl border border-[#E5E7EB] bg-white shadow-sm">
          <table className="min-w-[1000px] w-full text-left text-[13px]">
            <thead className="border-b bg-[#F9FAFB] text-[#4B5563]"><tr><th className="p-3">Nome</th><th className="p-3">Username</th><th className="p-3">E-mail</th><th className="p-3">Perfil</th><th className="p-3">Gestor</th><th className="p-3">Escopo</th><th className="p-3">Status</th><th className="p-3">Criado</th><th className="p-3">Atualizado</th><th className="p-3">Ações</th></tr></thead>
            <tbody>
              {users.map((item) => {
                const manager = users.find((candidate) => candidate.id === item.managerId);
                const scopeCount = item.scope.enterpriseIds.length + item.scope.brokerIds.length + item.scope.conversationIds.length + item.scope.contactIds.length + item.scope.appointmentIds.length;
                return <tr key={item.id} className="border-b last:border-0"><td className="p-3 font-medium">{item.name}</td><td className="p-3">{item.username ?? '—'}</td><td className="p-3 text-[#6B7280]">{item.email ?? '—'}</td><td className="p-3">{userRoleLabel(item.role)}</td><td className="p-3">{manager?.name ?? (item.managerId === actor?.id ? actor.name : '—')}</td><td className="p-3">{item.scope.accessAll ? 'Global' : `${scopeCount} atribuição(ões)`}</td><td className="p-3"><span className={item.active ? 'text-emerald-700' : 'text-red-600'}>{item.active ? 'Ativo' : 'Inativo'}</span>{item.mustChangePassword && <span className="ml-2 rounded bg-amber-50 px-2 py-1 text-[11px] text-amber-700">Troca pendente</span>}</td><td className="p-3 text-[#6B7280]">{new Date(item.createdAt).toLocaleDateString('pt-BR')}</td><td className="p-3 text-[#6B7280]">{new Date(item.updatedAt).toLocaleDateString('pt-BR')}</td><td className="p-3"><div className="flex flex-wrap gap-2"><button onClick={() => openEdit(item)} className="text-blue-600 hover:underline">Editar</button>{isAdmin && <button onClick={() => void resetPassword(item)} className="text-blue-600 hover:underline">Redefinir senha</button>}{isAdmin && <button onClick={() => void revokeSessions(item)} className="text-[#6B7280] hover:underline">Encerrar sessões</button>}</div></td></tr>;
              })}
            </tbody>
          </table>
          {!loading && users.length === 0 && <p className="p-8 text-center text-sm text-[#6B7280]">Nenhum acesso disponível.</p>}
          {loading && <p className="p-8 text-center text-sm text-[#6B7280]">Carregando…</p>}
        </div>
      </main>

      {editing && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={() => setEditing(null)}><div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl" onMouseDown={(e) => e.stopPropagation()}><h2 className="mb-4 text-lg font-semibold">{editing === 'new' ? 'Novo acesso' : `Editar ${editing.name}`}</h2>{error && <p className="mb-3 text-sm text-red-600">{error}</p>}<form onSubmit={save} className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Nome<input className={`${field} mt-1`} value={name} onChange={(e) => setName(e.target.value)} required /></label><label className="text-sm">Username<input className={`${field} mt-1`} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))} required disabled={!isAdmin && editing !== 'new'} /></label><label className="text-sm">E-mail opcional<input className={`${field} mt-1`} type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>{editing === 'new' && <label className="text-sm">Senha temporária<input className={`${field} mt-1`} type="password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>}<label className="text-sm">Perfil<select className={`${field} mt-1`} value={role} onChange={(e) => setRole(e.target.value as UserRole)} disabled={!isAdmin}><option value="COLLABORATOR">Colaborador</option><option value="MANAGERIAL">Gestor</option><option value="ADMIN">Administrador</option></select></label>{role === 'COLLABORATOR' && <label className="text-sm">Gestor responsável<select className={`${field} mt-1`} value={scope.managerId ?? ''} onChange={(e) => setScope((current) => ({ ...current, managerId: e.target.value ? Number(e.target.value) : null }))} disabled={!isAdmin}><option value="">Atribuição direta por ADMIN</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.name}</option>)}</select></label>}{isAdmin && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />Acesso ativo</label>}</div>
        {role !== 'ADMIN' && <div className="grid gap-5 sm:grid-cols-2"><fieldset><legend className="mb-2 text-sm font-semibold">Empreendimentos</legend><div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">{resources.enterprises.map((resource) => <label key={resource.id} className="flex gap-2 text-sm"><input type="checkbox" checked={scope.enterpriseIds.includes(resource.id)} onChange={() => setScope((current) => ({ ...current, enterpriseIds: toggleId(current.enterpriseIds, resource.id) }))} />{resource.name}</label>)}{resources.enterprises.length === 0 && <span className="text-xs text-[#6B7280]">Nenhum disponível.</span>}</div></fieldset><fieldset><legend className="mb-2 text-sm font-semibold">Corretores</legend><div className="max-h-40 space-y-2 overflow-y-auto rounded-lg border p-3">{resources.brokers.map((resource) => <label key={resource.id} className="flex gap-2 text-sm"><input type="checkbox" checked={scope.brokerIds.includes(resource.id)} onChange={() => setScope((current) => ({ ...current, brokerIds: toggleId(current.brokerIds, resource.id) }))} />{resource.name}{!resource.active && ' (inativo)'}</label>)}{resources.brokers.length === 0 && <span className="text-xs text-[#6B7280]">Nenhum disponível.</span>}</div></fieldset></div>}
        <p className="text-xs text-[#6B7280]">Conversas, contatos e visitas atribuídos diretamente continuam preservados. Empreendimentos e corretores também derivam o escopo operacional relacionado.</p><div className="flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button><button disabled={saving} className="rounded-lg bg-[#F97316] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{saving ? 'Salvando…' : 'Salvar'}</button></div>
      </form></div></div>}
    </div>
  );
}
