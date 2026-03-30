import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { contactsApi, corretoresApi, type ContactImportPreview, type ContactListItem } from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const inputCls =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px] bg-white focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

export function ContatosPage() {
  const { isAdmin } = useAuth();
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [enterprise, setEnterprise] = useState('');
  const [status, setStatus] = useState<'assigned' | 'unassigned' | ''>('');
  const [ownerUserId, setOwnerUserId] = useState<string>('');
  const [brokers, setBrokers] = useState<Array<{ id: number; fullName: string }>>([]);
  const [editContact, setEditContact] = useState<ContactListItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importOwnerId, setImportOwnerId] = useState<string>('');
  const [preview, setPreview] = useState<ContactImportPreview | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await contactsApi.list({
        search: search || undefined,
        enterprise: enterprise || undefined,
        status: status || undefined,
        ownerUserId: ownerUserId ? parseInt(ownerUserId, 10) : undefined,
        limit: 200,
      });
      setContacts(data.contacts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao carregar contatos.');
    } finally {
      setLoading(false);
    }
  }, [search, enterprise, status, ownerUserId]);

  useEffect(() => {
    corretoresApi
      .list()
      .then((d) => setBrokers(d.corretores.map((b) => ({ id: b.id, fullName: b.fullName }))))
      .catch(() => setBrokers([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isAdmin) return <Navigate to="/inbox" replace />;

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-[#111827]">
      <nav className="h-14 border-b border-[#E5E7EB] bg-white/90 backdrop-blur-sm sticky top-0 z-20 px-6 flex items-center justify-between">
        <span className="text-[15px] font-semibold">Contatos</span>
        <AppNav />
      </nav>
      <div className="max-w-[1280px] mx-auto px-6 py-6 space-y-5">
        <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3">
          <h2 className="text-[14px] font-semibold">Filtros</h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input className={inputCls} placeholder="Buscar por nome ou número" value={search} onChange={(e) => setSearch(e.target.value)} />
            <input className={inputCls} placeholder="Empreendimento" value={enterprise} onChange={(e) => setEnterprise(e.target.value)} />
            <select className={inputCls} value={ownerUserId} onChange={(e) => setOwnerUserId(e.target.value)}>
              <option value="">Todos os corretores</option>
              {brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.fullName}
                </option>
              ))}
            </select>
            <select className={inputCls} value={status} onChange={(e) => setStatus(e.target.value as 'assigned' | 'unassigned' | '')}>
              <option value="">Todos os status</option>
              <option value="assigned">Atribuído</option>
              <option value="unassigned">Sem corretor</option>
            </select>
            <button
              type="button"
              onClick={() => void load()}
              className="px-4 py-2 rounded-[10px] bg-[#2563EB] text-white text-[13px] font-semibold hover:bg-[#1D4ED8]"
            >
              Filtrar
            </button>
          </div>
        </section>

        <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3">
          <h2 className="text-[14px] font-semibold">Importar CSV</h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <input type="file" accept=".csv,text/csv" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} className={inputCls} />
            <select className={inputCls} value={importOwnerId} onChange={(e) => setImportOwnerId(e.target.value)}>
              <option value="">Sem corretor inicial</option>
              {brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.fullName}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={async () => {
                if (!importFile) return;
                const r = await contactsApi.importPreview(importFile, importOwnerId ? parseInt(importOwnerId, 10) : null);
                setPreview(r);
                setImportResult(null);
              }}
              className="px-4 py-2 rounded-[10px] bg-[#0EA5E9] text-white text-[13px] font-semibold hover:bg-[#0284C7]"
            >
              Preview
            </button>
            <button
              type="button"
              onClick={async () => {
                if (!importFile) return;
                const r = await contactsApi.importCommit(importFile, importOwnerId ? parseInt(importOwnerId, 10) : null);
                setImportResult(`Lote #${r.batchId} finalizado. Criados: ${r.summary.createdContacts}, Atualizados: ${r.summary.updatedContacts}, Claims: ${r.summary.claimedUnassignedContacts}`);
                await load();
              }}
              className="px-4 py-2 rounded-[10px] bg-[#16A34A] text-white text-[13px] font-semibold hover:bg-[#15803D]"
            >
              Confirmar importação
            </button>
          </div>
          {preview && (
            <div className="text-[12px] text-[#374151] bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] p-3">
              Total: {preview.totalRows} | Válidas: {preview.validRows} | Inválidas: {preview.invalidRows} | Novos:{' '}
              {preview.createdContacts} | Atualizados: {preview.updatedContacts} | Claims: {preview.claimedUnassignedContacts} |
              Não assumidos: {preview.skippedOwnedContacts} | Duplicadas no arquivo: {preview.duplicateRows}
            </div>
          )}
          {importResult && <p className="text-[12px] text-[#047857]">{importResult}</p>}
        </section>

        <section className="bg-white border border-[#E5E7EB] rounded-[12px] overflow-hidden">
          {error && <div className="p-3 text-[12px] text-red-700 bg-red-50 border-b border-red-100">{error}</div>}
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
                <tr className="text-[11px] uppercase tracking-wide text-[#6B7280]">
                  <th className="px-3 py-2">Nome</th>
                  <th className="px-3 py-2">Número</th>
                  <th className="px-3 py-2">Empreendimento</th>
                  <th className="px-3 py-2">Corretor</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Origem</th>
                  <th className="px-3 py-2">Último contato</th>
                  <th className="px-3 py-2">Criado em</th>
                  <th className="px-3 py-2">Ações</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-4 text-[13px] text-[#6B7280]">
                      Carregando...
                    </td>
                  </tr>
                ) : contacts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-4 text-[13px] text-[#6B7280]">
                      Nenhum contato encontrado.
                    </td>
                  </tr>
                ) : (
                  contacts.map((c) => (
                    <tr key={c.id} className="border-b border-[#F3F4F6] text-[13px]">
                      <td className="px-3 py-2">{c.fullName || 'Sem nome'}</td>
                      <td className="px-3 py-2">{c.phoneE164}</td>
                      <td className="px-3 py-2">{c.enterpriseInterest || '-'}</td>
                      <td className="px-3 py-2">{c.ownerName || '-'}</td>
                      <td className="px-3 py-2">{c.status === 'assigned' ? 'Atribuído' : 'Sem corretor'}</td>
                      <td className="px-3 py-2">{c.source || '-'}</td>
                      <td className="px-3 py-2">{c.lastContactAt ? new Date(c.lastContactAt).toLocaleString('pt-BR') : '-'}</td>
                      <td className="px-3 py-2">{new Date(c.createdAt).toLocaleDateString('pt-BR')}</td>
                      <td className="px-3 py-2">
                        <button
                          type="button"
                          onClick={() => setEditContact(c)}
                          className="px-2 py-1 rounded-[8px] border border-[#D1D5DB] text-[12px] hover:bg-[#F3F4F6]"
                        >
                          Detalhes/Editar
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {editContact && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-[14px] border border-[#E5E7EB] p-4 space-y-3">
            <h3 className="text-[15px] font-semibold">Contato #{editContact.id}</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <input
                className={inputCls}
                value={editContact.fullName ?? ''}
                onChange={(e) => setEditContact({ ...editContact, fullName: e.target.value })}
                placeholder="Nome"
              />
              <input className={inputCls} value={editContact.phoneE164} disabled />
              <input
                className={inputCls}
                value={editContact.email ?? ''}
                onChange={(e) => setEditContact({ ...editContact, email: e.target.value })}
                placeholder="E-mail"
              />
              <input
                className={inputCls}
                value={editContact.enterpriseInterest ?? ''}
                onChange={(e) => setEditContact({ ...editContact, enterpriseInterest: e.target.value })}
                placeholder="Empreendimento de interesse"
              />
              <select
                className={inputCls}
                value={editContact.ownerUserId ?? ''}
                onChange={(e) =>
                  setEditContact({
                    ...editContact,
                    ownerUserId: e.target.value === '' ? null : parseInt(e.target.value, 10),
                    ownerName: e.target.value === '' ? null : brokers.find((b) => b.id === parseInt(e.target.value, 10))?.fullName ?? null,
                    status: e.target.value === '' ? 'unassigned' : 'assigned',
                  })
                }
              >
                <option value="">Sem corretor</option>
                {brokers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.fullName}
                  </option>
                ))}
              </select>
              <input
                className={inputCls}
                value={editContact.source ?? ''}
                onChange={(e) => setEditContact({ ...editContact, source: e.target.value })}
                placeholder="Origem"
              />
            </div>
            <textarea
              className={`${inputCls} min-h-[92px]`}
              value={editContact.notes ?? ''}
              onChange={(e) => setEditContact({ ...editContact, notes: e.target.value })}
              placeholder="Observações"
            />
            <div className="flex justify-between items-center gap-3">
              <div className="flex gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => setEditContact(null)}
                  className="px-3 py-2 rounded-[10px] bg-[#F3F4F6] text-[13px]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    await contactsApi.update(editContact.id, {
                      fullName: editContact.fullName ?? undefined,
                      email: editContact.email ?? undefined,
                      enterpriseInterest: editContact.enterpriseInterest ?? undefined,
                      notes: editContact.notes ?? undefined,
                      source: editContact.source ?? undefined,
                    });
                    await contactsApi.setOwner(editContact.id, editContact.ownerUserId);
                    setEditContact(null);
                    await load();
                  }}
                  className="px-3 py-2 rounded-[10px] bg-[#2563EB] text-white text-[13px] font-semibold"
                >
                  Salvar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

