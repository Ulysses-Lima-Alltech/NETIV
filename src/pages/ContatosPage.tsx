import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import {
  contactsApi,
  corretoresApi,
  projectsApi,
  type ContactImportPreview,
  type ContactListItem,
  type ProjectListItem,
} from '../api/client';
import { useAuth } from '../contexts/AuthContext';

const inputCls =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px] bg-white focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

type ContactFilters = {
  search: string;
  enterpriseId: string;
  brokerId: string;
  status: '' | 'assigned' | 'unassigned';
  origin: string;
  createdFrom: string;
  createdTo: string;
  lastContactFrom: string;
  lastContactTo: string;
  withoutBroker: boolean;
  withoutEnterprise: boolean;
};

const initialFilters: ContactFilters = {
  search: '',
  enterpriseId: '',
  brokerId: '',
  status: '',
  origin: '',
  createdFrom: '',
  createdTo: '',
  lastContactFrom: '',
  lastContactTo: '',
  withoutBroker: false,
  withoutEnterprise: false,
};

export function ContatosPage() {
  const { isAdmin, user } = useAuth();
  const [contacts, setContacts] = useState<ContactListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState<ContactFilters>(initialFilters);
  const [appliedFilters, setAppliedFilters] = useState<ContactFilters>(initialFilters);
  const [brokers, setBrokers] = useState<Array<{ id: number; fullName: string }>>([]);
  const [origins, setOrigins] = useState<string[]>([]);
  const [editContact, setEditContact] = useState<ContactListItem | null>(null);
  const [modalEnterpriseTouched, setModalEnterpriseTouched] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const listRequestSeqRef = useRef(0);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importOwnerId, setImportOwnerId] = useState<string>('');
  const [preview, setPreview] = useState<ContactImportPreview | null>(null);
  const [importResult, setImportResult] = useState<string | null>(null);

  const buildApiFilters = useCallback((source: ContactFilters) => {
    const enterpriseId = source.enterpriseId ? parseInt(source.enterpriseId, 10) : undefined;
    const brokerId = source.brokerId ? parseInt(source.brokerId, 10) : undefined;
    return {
      search: source.search || undefined,
      enterpriseId: enterpriseId != null && !Number.isNaN(enterpriseId) ? enterpriseId : undefined,
      brokerId: brokerId != null && !Number.isNaN(brokerId) ? brokerId : undefined,
      status: source.status || undefined,
      origin: source.origin || undefined,
      createdFrom: source.createdFrom || undefined,
      createdTo: source.createdTo || undefined,
      lastContactFrom: source.lastContactFrom || undefined,
      lastContactTo: source.lastContactTo || undefined,
      withoutBroker: source.withoutBroker || undefined,
      withoutEnterprise: source.withoutEnterprise || undefined,
    };
  }, []);

  const load = useCallback(async () => {
    const requestSeq = ++listRequestSeqRef.current;
    setLoading(true);
    setError(null);
    try {
      const requestFilters = buildApiFilters(appliedFilters);
      if (import.meta.env.DEV) {
        console.debug('[ContatosPage] list request', { requestFilters, page, pageSize });
      }
      const data = await contactsApi.list({ ...requestFilters, page, pageSize });
      if (requestSeq !== listRequestSeqRef.current) return;
      setContacts(data.contacts);
      setTotal(data.total);
    } catch (e) {
      if (requestSeq !== listRequestSeqRef.current) return;
      setError(e instanceof Error ? e.message : 'Erro ao carregar leads.');
    } finally {
      if (requestSeq !== listRequestSeqRef.current) return;
      setLoading(false);
    }
  }, [appliedFilters, buildApiFilters, page, pageSize]);

  const handleExportCsv = useCallback(async () => {
    setExportLoading(true);
    setExportError(null);
    try {
      const { blob, filename } = await contactsApi.exportCsv({
        ...buildApiFilters(appliedFilters),
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setExportError(e instanceof Error ? e.message : 'Erro ao exportar CSV.');
    } finally {
      setExportLoading(false);
    }
  }, [appliedFilters, buildApiFilters]);

  useEffect(() => {
    corretoresApi
      .list()
      .then((d) => setBrokers(d.corretores.map((b) => ({ id: b.id, fullName: b.fullName }))))
      .catch(() => setBrokers([]));
  }, []);

  useEffect(() => {
    projectsApi
      .list(true)
      .then((d) => setProjects(d.projects.filter((p) => p.status === 'ativo')))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    contactsApi
      .filterOptions()
      .then((d) => setOrigins(d.origins))
      .catch(() => setOrigins([]));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setAppliedFilters((prev) => {
        if (prev.search === filters.search) return prev;
        setPage(1);
        return { ...prev, search: filters.search };
      });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [filters.search]);

  const applyFilters = useCallback(() => {
    const nextAppliedFilters: ContactFilters = { ...filters };
    const payload = buildApiFilters(nextAppliedFilters);
    if (import.meta.env.DEV) {
      console.debug('[ContatosPage] apply filters', { uiFilters: nextAppliedFilters, payload });
    }
    setPage(1);
    setAppliedFilters(nextAppliedFilters);
  }, [buildApiFilters, filters]);

  const clearFilters = useCallback(() => {
    if (import.meta.env.DEV) {
      console.debug('[ContatosPage] clear filters');
    }
    const resetFilters: ContactFilters = { ...initialFilters };
    setFilters(resetFilters);
    setAppliedFilters(resetFilters);
    setPage(1);
  }, []);


  return (
    <div className="min-h-screen bg-[#F9FAFB] text-[#111827]">
      <nav className="h-14 border-b border-[#E5E7EB] bg-white/90 backdrop-blur-sm sticky top-0 z-20 px-6 flex items-center justify-between">
        <span className="text-[15px] font-semibold">Leads</span>
        <AppNav />
      </nav>
      <div className="w-full max-w-none px-6 lg:px-8 py-6 space-y-5">
        <section className={`${isAdmin ? '' : 'hidden '}bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3`}>
          <h2 className="text-[14px] font-semibold">Filtros</h2>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <input
              className={inputCls}
              placeholder="Buscar por nome ou número"
              value={filters.search}
              onChange={(e) => setFilters((prev) => ({ ...prev, search: e.target.value }))}
            />
            <select
              className={inputCls}
              value={filters.enterpriseId}
              onChange={(e) => setFilters((prev) => ({ ...prev, enterpriseId: e.target.value }))}
            >
              <option value="">Todos os empreendimentos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <select
              className={inputCls}
              value={filters.brokerId}
              onChange={(e) => setFilters((prev) => ({ ...prev, brokerId: e.target.value }))}
            >
              <option value="">Todos os corretores</option>
              {brokers.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.fullName}
                </option>
              ))}
            </select>
            <select
              className={inputCls}
              value={filters.status}
              onChange={(e) => setFilters((prev) => ({ ...prev, status: e.target.value as ContactFilters['status'] }))}
            >
              <option value="">Todos os status</option>
              <option value="assigned">Atribuído</option>
              <option value="unassigned">Sem corretor</option>
            </select>
            <select className={inputCls} value={filters.origin} onChange={(e) => setFilters((prev) => ({ ...prev, origin: e.target.value }))}>
              <option value="">Todas as origens</option>
              {origins.map((origin) => (
                <option key={origin} value={origin}>
                  {origin}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 xl:grid-cols-8 gap-3 items-end">
            <label className="text-[12px] text-[#374151]">
              Criado de
              <input
                className={inputCls}
                type="date"
                value={filters.createdFrom}
                onChange={(e) => setFilters((prev) => ({ ...prev, createdFrom: e.target.value }))}
              />
            </label>
            <label className="text-[12px] text-[#374151]">
              Criado até
              <input
                className={inputCls}
                type="date"
                value={filters.createdTo}
                onChange={(e) => setFilters((prev) => ({ ...prev, createdTo: e.target.value }))}
              />
            </label>
            <label className="text-[12px] text-[#374151]">
              Último contato de
              <input
                className={inputCls}
                type="date"
                value={filters.lastContactFrom}
                onChange={(e) => setFilters((prev) => ({ ...prev, lastContactFrom: e.target.value }))}
              />
            </label>
            <label className="text-[12px] text-[#374151]">
              Último contato até
              <input
                className={inputCls}
                type="date"
                value={filters.lastContactTo}
                onChange={(e) => setFilters((prev) => ({ ...prev, lastContactTo: e.target.value }))}
              />
            </label>
            <label className="inline-flex items-center gap-2 text-[13px] text-[#111827]">
              <input
                type="checkbox"
                checked={filters.withoutBroker}
                onChange={(e) => setFilters((prev) => ({ ...prev, withoutBroker: e.target.checked }))}
              />
              Sem corretor
            </label>
            <label className="inline-flex items-center gap-2 text-[13px] text-[#111827]">
              <input
                type="checkbox"
                checked={filters.withoutEnterprise}
                onChange={(e) => setFilters((prev) => ({ ...prev, withoutEnterprise: e.target.checked }))}
              />
              Sem empreendimento
            </label>
            <button
              type="button"
              onClick={applyFilters}
              className="px-4 py-2 rounded-[10px] bg-[#2563EB] text-white text-[13px] font-semibold hover:bg-[#1D4ED8]"
            >
              Filtrar
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="px-4 py-2 rounded-[10px] bg-[#F3F4F6] text-[#111827] text-[13px] font-semibold hover:bg-[#E5E7EB]"
            >
              Limpar filtros
            </button>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleExportCsv()}
              disabled={exportLoading}
              className="px-4 py-2 rounded-[10px] bg-[#0F766E] text-white text-[13px] font-semibold hover:bg-[#0E6962] disabled:opacity-60"
            >
              {exportLoading ? 'Exportando…' : 'Exportar CSV'}
            </button>
          </div>
          {exportError && <p className="text-[12px] text-red-700">{exportError}</p>}
        </section>

        <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3">
          <h2 className="text-[14px] font-semibold">Importar CSV</h2>
          <div>
            <Link
              to="/contatos/disparo-template-lote"
              className="inline-flex items-center px-3 py-2 rounded-[10px] bg-[#7C3AED] text-white text-[12px] font-semibold hover:bg-[#6D28D9]"
            >
              Ir para disparo de templates em lote
            </Link>
          </div>
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
                      Nenhum lead encontrado.
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
                          onClick={() => {
                            setModalError(null);
                            setModalEnterpriseTouched(false);
                            setEditContact(c);
                          }}
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
          <div className="px-3 py-2 border-t border-[#E5E7EB] flex items-center justify-between text-[12px] text-[#6B7280]">
            <span>
              {total > 0 ? `${(page - 1) * pageSize + 1}-${Math.min(page * pageSize, total)} de ${total}` : '0 resultados'}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((prev) => Math.max(prev - 1, 1))}
                className="px-3 py-1 rounded-[8px] border border-[#D1D5DB] text-[12px] disabled:opacity-60"
              >
                Anterior
              </button>
              <span>Página {page}</span>
              <button
                type="button"
                disabled={page * pageSize >= total}
                onClick={() => setPage((prev) => prev + 1)}
                className="px-3 py-1 rounded-[8px] border border-[#D1D5DB] text-[12px] disabled:opacity-60"
              >
                Próxima
              </button>
            </div>
          </div>
        </section>
      </div>

      {editContact && (
        <div className="fixed inset-0 z-40 bg-black/40 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-[14px] border border-[#E5E7EB] p-4 space-y-3">
            <h3 className="text-[15px] font-semibold">Lead #{editContact.id}</h3>
            {modalError && <div className="text-[12px] text-red-700 bg-red-50 border border-red-100 rounded-[8px] px-3 py-2">{modalError}</div>}
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
              <select
                className={inputCls}
                disabled={user?.role === 'COLLABORATOR'}
                value={editContact.enterpriseId != null ? String(editContact.enterpriseId) : ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  const id = raw === '' ? null : parseInt(raw, 10);
                  const p = id != null && !Number.isNaN(id) ? projects.find((x) => x.id === id) : undefined;
                  setModalEnterpriseTouched(true);
                  setEditContact({
                    ...editContact,
                    enterpriseId: id != null && !Number.isNaN(id) ? id : null,
                    enterpriseInterest: p?.name ?? editContact.enterpriseInterest,
                  });
                }}
              >
                <option value="">Selecione um empreendimento</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <select
                className={inputCls}
                value={editContact.ownerUserId ?? ''}
                disabled={user?.role === 'COLLABORATOR'}
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
                  disabled={saveLoading}
                  onClick={() => {
                    setEditContact(null);
                    setModalError(null);
                  }}
                  className="px-3 py-2 rounded-[10px] bg-[#F3F4F6] text-[13px] disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={saveLoading}
                  onClick={async () => {
                    if (!editContact) return;
                    setModalError(null);
                    setSaveLoading(true);
                    try {
                      await contactsApi.update(editContact.id, {
                        fullName: editContact.fullName ?? undefined,
                        email: editContact.email ?? undefined,
                        notes: editContact.notes ?? undefined,
                        source: editContact.source ?? undefined,
                        ...(modalEnterpriseTouched ? { enterpriseId: editContact.enterpriseId ?? null } : {}),
                      });
                      if (user?.role !== 'COLLABORATOR') {
                        await contactsApi.setOwner(editContact.id, editContact.ownerUserId);
                      }
                      setEditContact(null);
                      await load();
                    } catch (e) {
                      setModalError(e instanceof Error ? e.message : 'Não foi possível salvar.');
                    } finally {
                      setSaveLoading(false);
                    }
                  }}
                  className="px-3 py-2 rounded-[10px] bg-[#2563EB] text-white text-[13px] font-semibold disabled:opacity-60"
                >
                  {saveLoading ? 'Salvando…' : 'Salvar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}




