import { useCallback, useEffect, useMemo, useState } from 'react';
import { AppNav } from '../components/AppNav';
import {
  projectsApi,
  type EmpreendimentoDTO,
  type EnterpriseTipo,
  type KnowledgeFileItem,
  type ProjectVariables,
  type FileCategory,
  type PromptAddonsHistoryItem,
} from '../api/client';
import { SearchableMunicipioCombobox } from '../components/SearchableMunicipioCombobox';
import { findMunicipioByIbge, loadMunicipiosIbge } from '../data/municipiosIbgeCache';
import type { MunicipioIbge } from '../types/municipioIbge';

const CAT_LABEL: Record<FileCategory, string> = {
  book: 'Book',
  unidades: 'Unidades',
  tabela_comercial: 'Tabela comercial',
  outro: 'Outro / Imagem / Vídeo',
};

function uploadPermissionDefaults(category: FileCategory): {
  asKnowledge: boolean;
  allowSend: boolean;
} {
  if (category === 'outro') return { asKnowledge: true, allowSend: false };
  return { asKnowledge: false, allowSend: true };
}

const LANGS: { v: EmpreendimentoDTO['languageStyle']; l: string }[] = [
  { v: 'informal', l: 'Informal' },
  { v: 'natural', l: 'Natural' },
  { v: 'formal', l: 'Formal' },
  { v: 'culta', l: 'Culta' },
];

const LANG_DESC: Record<string, string> = {
  informal: 'Comunicação descontraída e próxima, ideal para público jovem.',
  natural: 'Tom equilibrado, amigável e profissional.',
  formal: 'Linguagem respeitosa e institucional.',
  culta: 'Comunicação sofisticada e cerimonial.',
};

const TIPO_LABEL: Record<EnterpriseTipo, string> = {
  LOTEAMENTO: 'Loteamento',
  APARTAMENTO: 'Apartamento',
  MCMV: 'MCMV',
};

const emptyVars = (): ProjectVariables => ({
  priceLabel: '',
  commercialConditions: '',
  availability: '',
  observations: '',
});

/* Shared style tokens */

const field =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3.5 py-[10px] text-[14px] leading-5 text-[#111827] placeholder:text-[#9CA3AF] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

const fieldSelect =
  'border border-[#E5E7EB] rounded-[10px] px-3.5 py-[10px] text-[14px] leading-5 text-[#111827] bg-white transition focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

const card = 'bg-white rounded-[12px] border border-[#E5E7EB] p-6 shadow-[0_1px_2px_rgba(0,0,0,0.04)]';

const heading = 'text-[16px] font-semibold text-[#111827] mb-5';

const label = 'block text-[13px] font-medium text-[#6B7280] mb-1.5';

const btnPrimary =
  'inline-flex items-center justify-center text-[14px] font-semibold bg-[#F97316] text-white rounded-[10px] px-6 py-[10px] hover:bg-[#EA580C] active:bg-[#C2410C] disabled:opacity-40 transition-colors shadow-sm';

const btnGhost =
  'inline-flex items-center justify-center text-[13px] font-medium text-[#3B82F6] hover:text-[#1D4ED8] transition-colors';

export function EmpreendimentosPage() {
  const [list, setList] = useState<EmpreendimentoDTO[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<(EmpreendimentoDTO & { knowledgeFiles: KnowledgeFileItem[] }) | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [city, setCity] = useState('');
  const [stateUf, setStateUf] = useState('');
  /** Região geográfica intermediária (IBGE) — mesmo campo `commercialRegion` na API */
  const [commercialRegion, setCommercialRegion] = useState('');
  /** Região geográfica imediata (IBGE), só exibição */
  const [ibgeRegiaoImediata, setIbgeRegiaoImediata] = useState('');
  const [ibgeCode, setIbgeCode] = useState('');
  const [status, setStatus] = useState<'ativo' | 'inativo'>('ativo');
  const [languageStyle, setLanguageStyle] = useState<EmpreendimentoDTO['languageStyle']>('natural');
  const [tipo, setTipo] = useState<EnterpriseTipo>('APARTAMENTO');
  const [exclusivo, setExclusivo] = useState(false);
  const [filterTipo, setFilterTipo] = useState<EnterpriseTipo | ''>('');
  const [filterExclusivo, setFilterExclusivo] = useState<'all' | 'yes' | 'no'>('all');
  const [variables, setVariables] = useState<ProjectVariables>(emptyVars());
  const [addonsText, setAddonsText] = useState('');
  const [files, setFiles] = useState<KnowledgeFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newTipo, setNewTipo] = useState<EnterpriseTipo>('APARTAMENTO');
  const [newExclusivo, setNewExclusivo] = useState(false);
  const [creating, setCreating] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<FileCategory>('book');
  const [showInactiveKnowledge, setShowInactiveKnowledge] = useState(false);
  const [knowledgeNotice, setKnowledgeNotice] = useState<string | null>(null);
  /** Defaults de upload seguem a categoria, ate o usuario mexer manualmente. */
  const initialUploadDefaults = uploadPermissionDefaults('book');
  const [uploadAsKnowledge, setUploadAsKnowledge] = useState(initialUploadDefaults.asKnowledge);
  const [uploadAllowSend, setUploadAllowSend] = useState(initialUploadDefaults.allowSend);
  const [uploadFlagsTouched, setUploadFlagsTouched] = useState(false);
  const [filePatchingId, setFilePatchingId] = useState<number | null>(null);
  const [regrasTab, setRegrasTab] = useState<'regras' | 'historico'>('regras');
  const [historyItems, setHistoryItems] = useState<PromptAddonsHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  /* Data loading (unchanged) */

  useEffect(() => {
    if (uploadFlagsTouched) return;
    const defaults = uploadPermissionDefaults(uploadCategory);
    setUploadAsKnowledge(defaults.asKnowledge);
    setUploadAllowSend(defaults.allowSend);
  }, [uploadCategory, uploadFlagsTouched]);

  const loadList = useCallback(() => {
    setLoading(true);
    const f =
      filterTipo || filterExclusivo !== 'all'
        ? {
            ...(filterTipo ? { tipo: filterTipo } : {}),
            ...(filterExclusivo !== 'all' ? { exclusivo: filterExclusivo === 'yes' } : {}),
          }
        : undefined;
    projectsApi
      .list(false, f)
      .then((d) => setList(d.projects as EmpreendimentoDTO[]))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }, [filterTipo, filterExclusivo]);

  useEffect(() => { loadList(); }, [loadList]);

  const loadDetail = useCallback((id: number) => {
    setErr(null);
    setDetail(null);
    setDetailLoading(true);
    projectsApi
      .get(id)
      .then((d) => {
        console.log('[TIPO_DEBUG] frontend loadDetail response.tipo:', d.tipo, '| id:', id);
        setDetail(d);
        setName(d.name);
        setSlug(d.slug);
        setCity(d.city ?? '');
        setStateUf(d.stateUf ?? '');
        setCommercialRegion((d.commercialRegion ?? '').trim());
        setIbgeRegiaoImediata('');
        setIbgeCode(d.ibgeCode ?? '');
        setStatus(d.status);
        setLanguageStyle(d.languageStyle);
        setTipo(d.tipo ?? 'APARTAMENTO');
        setExclusivo(d.exclusivo ?? false);
        setVariables({ ...emptyVars(), ...(d.variables ?? {}) });
        setAddonsText(Array.isArray(d.promptAddons) ? d.promptAddons.join('\n') : '');
        setFiles(Array.isArray(d.knowledgeFiles) ? d.knowledgeFiles : []);
        setRegrasTab('regras');
      })
      .catch((e) => { setErr(e instanceof Error ? e.message : 'Erro ao carregar'); setDetail(null); })
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    if (selectedId != null) {
      loadDetail(selectedId);
    } else {
      setDetail(null);
      setDetailLoading(false);
      setFiles([]);
      setErr(null);
      setKnowledgeNotice(null);
      setShowInactiveKnowledge(false);
    }
  }, [selectedId, loadDetail]);

  useEffect(() => {
    if (selectedId == null || regrasTab !== 'historico') return;
    setHistoryLoading(true);
    projectsApi
      .promptAddonsHistory(selectedId)
      .then((d) => setHistoryItems(d.items))
      .catch(() => setHistoryItems([]))
      .finally(() => setHistoryLoading(false));
  }, [selectedId, regrasTab]);

  const save = () => {
    if (selectedId == null) return;
    setSaving(true);
    setErr(null);
    const promptAddons = addonsText.split('\n').map((s) => s.trim()).filter(Boolean);
    const payload = {
      name: name.trim(),
      slug: slug.trim() || undefined,
      status,
      languageStyle,
      tipo,
      exclusivo,
      variables,
      promptAddons,
      city: city.trim(),
      stateUf: stateUf.trim(),
      commercialRegion: commercialRegion.trim(),
      ibgeCode: ibgeCode.trim(),
    };
    console.log('[TIPO_DEBUG] frontend save payload.tipo:', payload.tipo, '| id:', selectedId);
    projectsApi
      .update(selectedId, payload)
      .then((res) => {
        console.log('[TIPO_DEBUG] frontend update response.tipo:', res.tipo, '| id:', selectedId);
        loadList();
        loadDetail(selectedId);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Erro ao salvar'))
      .finally(() => setSaving(false));
  };

  const create = () => {
    const n = newName.trim();
    if (!n) return;
    setCreating(true);
    setErr(null);
    projectsApi
      .create({ name: n, tipo: newTipo, exclusivo: newExclusivo })
      .then((p) => { setNewName(''); loadList(); setSelectedId(p.id); })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Erro ao criar'))
      .finally(() => setCreating(false));
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || selectedId == null) return;
    const isImage = /^image\/(jpeg|jpg|png|webp)$/i.test(f.type || '') || /\.(jpg|jpeg|png|webp)$/i.test(f.name);
    const isVideo = /^video\/(mp4|quicktime|webm)$/i.test(f.type || '') || /\.(mp4|mov|webm)$/i.test(f.name);
    setUploading(true);
    projectsApi
      .uploadKnowledge(selectedId, f, uploadCategory, {
        canBeUsedAsKnowledge: isImage || isVideo ? false : uploadAsKnowledge,
        canBeSentByAna: isImage || isVideo ? true : uploadAllowSend,
        ...(uploadCategory === 'book' ? { tipoDocumento: 'BOOK' as const } : {}),
      })
      .then(() => {
        setUploadFlagsTouched(false);
        const defaults = uploadPermissionDefaults(uploadCategory);
        setUploadAsKnowledge(defaults.asKnowledge);
        setUploadAllowSend(defaults.allowSend);
        loadDetail(selectedId);
      })
      .catch((er) => setErr(er instanceof Error ? er.message : 'Upload falhou'))
      .finally(() => setUploading(false));
  };

  const patchFileFlags = (fileId: number, patch: { canBeUsedAsKnowledge?: boolean; canBeSentByAna?: boolean }) => {
    if (selectedId == null) return;
    setErr(null);
    setFilePatchingId(fileId);
    projectsApi
      .patchKnowledgeFile(selectedId, fileId, patch)
      .then((updated) => {
        setFiles((prev) => prev.map((x) => (x.id === fileId ? { ...x, ...updated } : x)));
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Erro ao atualizar arquivo'))
      .finally(() => setFilePatchingId(null));
  };

  const removeFile = (fileId: number) => {
    if (selectedId == null) return;
    setErr(null);
    projectsApi
      .deleteKnowledge(selectedId, fileId)
      .then((res) => {
        if (res.mode === 'hard_deleted' || res.removed === true) {
          setKnowledgeNotice('Arquivo excluído definitivamente.');
        } else if (res.deactivated && res.message) {
          // fallback legado para ambientes ainda não migrados.
          setKnowledgeNotice(res.message);
        } else if (res.message) {
          setKnowledgeNotice(res.message);
        } else {
          setKnowledgeNotice(null);
        }
        loadDetail(selectedId);
      })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Erro ao remover arquivo'));
  };

  const knowledgeActive = files.filter((f) => f.isActive !== false);
  const knowledgeInactive = files.filter((f) => f.isActive === false);
  const knowledgeDisplayed = showInactiveKnowledge ? files : knowledgeActive;

  const selectedIbgeForMunicipio = useMemo(() => {
    const n = parseInt(ibgeCode.replace(/\D/g, ''), 10);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [ibgeCode]);

  /** Alinha região IBGE ao código do município (base local) */
  useEffect(() => {
    if (selectedId == null || detail == null) return;
    const id = selectedIbgeForMunicipio;
    if (id == null) {
      setIbgeRegiaoImediata('');
      return;
    }
    let cancelled = false;
    loadMunicipiosIbge()
      .then((rows) => {
        if (cancelled) return;
        const m = findMunicipioByIbge(rows, id);
        if (m) {
          setCity(m.n);
          setStateUf(m.u);
          if (m.rint) setCommercialRegion(m.rint);
          setIbgeRegiaoImediata(m.ri ?? '');
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selectedId, detail?.id, selectedIbgeForMunicipio]);

  /* Render */

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* Top bar */}
      <header className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-sm">
        <div className="w-full max-w-none flex items-center gap-4 px-6 lg:px-8 h-14">
          <AppNav />
          <h1 className="text-[15px] font-semibold text-[#111827]">Empreendimentos</h1>
        </div>
      </header>

      <div className="w-full max-w-none px-6 lg:px-8 py-8 flex flex-col md:flex-row gap-6 min-h-[calc(100vh-56px)]">

        {/* SIDEBAR */}
        <aside className="w-full md:w-[240px] shrink-0 space-y-4">
          {/* List */}
          <div className={card}>
            <p className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-[0.08em] mb-3">
              Filtros
            </p>
            <div className="space-y-2 mb-4">
              <label className="block">
                <span className={label}>Tipo</span>
                <select
                  className={`${fieldSelect} w-full text-[13px]`}
                  value={filterTipo}
                  onChange={(e) => setFilterTipo((e.target.value || '') as EnterpriseTipo | '')}
                >
                  <option value="">Todos</option>
                  <option value="LOTEAMENTO">Loteamento</option>
                  <option value="APARTAMENTO">Apartamento</option>
                  <option value="MCMV">MCMV</option>
                </select>
              </label>
              <label className="block">
                <span className={label}>Exclusivo</span>
                <select
                  className={`${fieldSelect} w-full text-[13px]`}
                  value={filterExclusivo}
                  onChange={(e) => setFilterExclusivo(e.target.value as 'all' | 'yes' | 'no')}
                >
                  <option value="all">Todos</option>
                  <option value="yes">Sim</option>
                  <option value="no">Não</option>
                </select>
              </label>
            </div>
            <p className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-[0.08em] mb-3">
              Seus empreendimentos
            </p>
            {loading ? (
              <div className="flex items-center gap-2 py-3">
                <div className="h-4 w-4 rounded-full border-2 border-[#3B82F6] border-t-transparent animate-spin" />
                <span className="text-[13px] text-[#6B7280]">Carregando…</span>
              </div>
            ) : list.length === 0 ? (
              <p className="text-[13px] text-[#9CA3AF] py-2">Nenhum empreendimento ainda.</p>
            ) : (
              <nav className="space-y-0.5 -mx-1.5">
                {list.map((p) => {
                  const active = selectedId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      className={`w-full text-left text-[13px] px-3 py-[9px] rounded-[8px] truncate transition-all ${
                        active
                          ? 'bg-[#EFF6FF] text-[#1D4ED8] font-semibold shadow-[inset_0_0_0_1px_rgba(59,130,246,0.12)]'
                          : 'text-[#374151] hover:bg-[#F3F4F6] hover:text-[#111827]'
                      }`}
                    >
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1">
                        <span className="text-[10px] font-medium text-[#6B7280] bg-[#F3F4F6] rounded px-1 py-px">
                          {TIPO_LABEL[(p.tipo ?? 'APARTAMENTO') as EnterpriseTipo]}
                        </span>
                        {(p.exclusivo ?? false) && (
                          <span className="text-[10px] font-medium text-amber-800 bg-amber-50 rounded px-1 py-px">
                            Exclusivo
                          </span>
                        )}
                        {p.status === 'inativo' && (
                          <span className="text-[10px] font-medium text-[#9CA3AF] bg-[#F3F4F6] rounded px-1 py-px">
                            inativo
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </nav>
            )}
          </div>

          {/* Create */}
          <div className={card}>
            <p className="text-[11px] font-bold text-[#9CA3AF] uppercase tracking-[0.08em] mb-3">
              Adicionar
            </p>
            <input
              className={field}
              placeholder="Nome do empreendimento"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && create()}
            />
            <label className="block mt-3">
              <span className={label}>Tipo do produto</span>
              <select
                className={`${fieldSelect} w-full text-[13px]`}
                value={newTipo}
                onChange={(e) => setNewTipo(e.target.value as EnterpriseTipo)}
              >
                <option value="LOTEAMENTO">Loteamento</option>
                <option value="APARTAMENTO">Apartamento</option>
                <option value="MCMV">MCMV</option>
              </select>
            </label>
            <div className="mt-3">
              <span className={label}>Exclusivo</span>
              <div className="flex gap-4 mt-1.5 text-[13px] text-[#374151]">
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="new-exclusivo" checked={!newExclusivo} onChange={() => setNewExclusivo(false)} />
                  Não
                </label>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input type="radio" name="new-exclusivo" checked={newExclusivo} onChange={() => setNewExclusivo(true)} />
                  Sim
                </label>
              </div>
            </div>
            <button
              type="button"
              onClick={create}
              disabled={creating || !newName.trim()}
              className={`${btnPrimary} w-full mt-3`}
            >
              {creating ? 'Criando…' : 'Criar empreendimento'}
            </button>
          </div>
        </aside>

        {/* MAIN PANEL */}
        <main className="flex-1 min-w-0">
          {/* Empty state */}
          {selectedId == null ? (
            <div className={`${card} flex flex-col items-center justify-center min-h-[420px] text-center`}>
              <div className="w-12 h-12 rounded-full bg-[#EFF6FF] flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/></svg>
              </div>
              <p className="text-[15px] font-medium text-[#111827] mb-1">Nenhum empreendimento selecionado</p>
              <p className="text-[13px] text-[#6B7280] max-w-[280px]">Selecione um empreendimento na lista ou crie um novo para configurar.</p>
            </div>

          /* Loading state */
          ) : detailLoading && !detail ? (
            <div className={`${card} flex flex-col items-center justify-center min-h-[420px]`}>
              <div className="h-6 w-6 rounded-full border-2 border-[#3B82F6] border-t-transparent animate-spin mb-3" />
              <p className="text-[13px] text-[#6B7280]">Carregando empreendimento…</p>
            </div>

          /* Error state */
          ) : !detail ? (
            <div className={`${card} flex flex-col items-center justify-center min-h-[300px] text-center`}>
              <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#EF4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              </div>
              <p className="text-[15px] font-medium text-[#111827] mb-1">Erro ao carregar</p>
              {err && <p className="text-[13px] text-red-600 mb-3 max-w-sm">{err}</p>}
              <button type="button" onClick={() => selectedId != null && loadDetail(selectedId)} className={btnGhost}>
                Tentar novamente
              </button>
            </div>

          /* Detail form */
          ) : (
            <div className="space-y-5">
              {/* Inline error */}
              {err && (
                <div className="flex items-start gap-3 text-[13px] text-red-700 bg-red-50 border border-red-100 rounded-[10px] px-4 py-3">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                  {err}
                </div>
              )}
              {knowledgeNotice && (
                <div className="flex items-start justify-between gap-3 text-[13px] text-[#065F46] bg-emerald-50 border border-emerald-100 rounded-[10px] px-4 py-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-px text-emerald-600"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <span className="leading-snug">{knowledgeNotice}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setKnowledgeNotice(null)}
                    className="shrink-0 text-[12px] font-medium text-emerald-700 hover:text-emerald-900 underline-offset-2 hover:underline"
                  >
                    Fechar
                  </button>
                </div>
              )}

              {/* Card 1: Dados gerais */}
              <section className={card}>
                <h2 className={heading}>Dados gerais</h2>
                <div className="grid gap-5 sm:grid-cols-2">
                  <label className="block">
                    <span className={label}>Nome</span>
                    <input className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Residencial Evora" />
                  </label>
                  <label className="block">
                    <span className={label}>Slug</span>
                    <input className={field} value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="evora" />
                  </label>
                  <label className="block">
                    <span className={label}>Tipo do produto</span>
                    <select
                      className={`${fieldSelect} w-full`}
                      value={tipo}
                      onChange={(e) => setTipo(e.target.value as EnterpriseTipo)}
                    >
                      <option value="LOTEAMENTO">Loteamento</option>
                      <option value="APARTAMENTO">Apartamento</option>
                      <option value="MCMV">MCMV</option>
                    </select>
                  </label>
                  <div className="block">
                    <span className={label}>Exclusivo</span>
                    <div className="flex gap-4 mt-1.5 text-[13px] text-[#374151]">
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="edit-exclusivo" checked={!exclusivo} onChange={() => setExclusivo(false)} />
                        Não
                      </label>
                      <label className="inline-flex items-center gap-2 cursor-pointer">
                        <input type="radio" name="edit-exclusivo" checked={exclusivo} onChange={() => setExclusivo(true)} />
                        Sim
                      </label>
                    </div>
                  </div>
                  <div className="block sm:col-span-2">
                    <span className={label}>Cidade (município IBGE)</span>
                    <SearchableMunicipioCombobox
                      valueIbge={selectedIbgeForMunicipio}
                      onSelect={(m: MunicipioIbge) => {
                        setCity(m.n);
                        setStateUf(m.u);
                        setIbgeCode(String(m.i));
                        setCommercialRegion(m.rint ?? '');
                        setIbgeRegiaoImediata(m.ri ?? '');
                      }}
                      onClear={() => {
                        setCity('');
                        setStateUf('');
                        setIbgeCode('');
                        setCommercialRegion('');
                        setIbgeRegiaoImediata('');
                      }}
                      disabled={saving}
                      placeholder="Digite pelo menos 2 letras (ex.: Atibaia, Jacareí)…"
                    />
                    <p className="mt-1.5 text-[12px] text-[#9CA3AF]">
                      Lista oficial IBGE (arquivo local). A UF e a região geográfica são preenchidas ao escolher o
                      município.
                      {stateUf ? (
                        <span className="ml-1 font-medium text-[#6B7280]"> UF: {stateUf}</span>
                      ) : null}
                    </p>
                  </div>
                  <div className="block sm:col-span-2">
                    <span className={label}>Região geográfica intermediária (IBGE)</span>
                    <div
                      className={`${field} bg-[#F9FAFB] text-[#374151] cursor-default`}
                      title="Derivada do município — usada para busca por proximidade (ex.: mesma RGINT)"
                    >
                      {commercialRegion || '—'}
                    </div>
                    {ibgeRegiaoImediata ? (
                      <p className="mt-1.5 text-[12px] text-[#9CA3AF]">
                        Região geográfica imediata (IBGE):{' '}
                        <span className="font-medium text-[#6B7280]">{ibgeRegiaoImediata}</span>
                      </p>
                    ) : (
                      <p className="mt-1.5 text-[12px] text-[#9CA3AF]">
                        Preenchida ao selecionar o município. A intermediária agrupa mais cidades e é a mais indicada para
                        a ANA sugerir alternativas na região quando não houver na cidade exata.
                      </p>
                    )}
                  </div>
                  <label className="block max-w-[220px]">
                    <span className={label}>Status</span>
                    <select className={`${fieldSelect} w-full`} value={status} onChange={(e) => setStatus(e.target.value as 'ativo' | 'inativo')}>
                      <option value="ativo">Ativo</option>
                      <option value="inativo">Inativo</option>
                    </select>
                  </label>
                </div>
                <details className="mt-5 group">
                  <summary className="text-[13px] font-medium text-[#6B7280] cursor-pointer list-none flex items-center gap-2 [&::-webkit-details-marker]:hidden">
                    <span className="inline-flex w-4 h-4 items-center justify-center rounded border border-[#E5E7EB] text-[10px] text-[#9CA3AF] group-open:rotate-90 transition-transform">
                      …
                    </span>
                    Uso interno — código IBGE (opcional)
                  </summary>
                  <p className="text-[12px] text-[#9CA3AF] mt-2 mb-2 max-w-xl">
                    O código IBGE é preenchido automaticamente ao selecionar o município. Você pode editar apenas em caso
                    de correção pontual.
                  </p>
                  <label className="block max-w-[200px]">
                    <span className={label}>Código IBGE do município</span>
                    <input
                      className={field}
                      inputMode="numeric"
                      value={ibgeCode}
                      onChange={(e) => {
                        const v = e.target.value.replace(/\D/g, '').slice(0, 12);
                        setIbgeCode(v);
                        if (!v) {
                          setCity('');
                          setStateUf('');
                          setCommercialRegion('');
                          setIbgeRegiaoImediata('');
                        }
                      }}
                      placeholder="Ex.: 3504107"
                    />
                  </label>
                </details>
              </section>

              {/* Card 2: Linguagem */}
              <section className={card}>
                <h2 className={heading}>Linguagem</h2>
                <label className="block max-w-[280px]">
                  <span className={label}>Estilo de comunicação da Ana</span>
                  <select
                    className={`${fieldSelect} w-full`}
                    value={languageStyle}
                    onChange={(e) => setLanguageStyle(e.target.value as EmpreendimentoDTO['languageStyle'])}
                  >
                    {LANGS.map((x) => <option key={x.v} value={x.v}>{x.l}</option>)}
                  </select>
                </label>
                <p className="mt-2.5 text-[12px] text-[#9CA3AF] leading-relaxed">
                  {LANG_DESC[languageStyle] ?? ''}
                </p>
              </section>

              {/* Card 3: Variáveis */}
              <section className={card}>
                <h2 className={heading}>Variáveis comerciais</h2>
                <p className="text-[13px] text-[#9CA3AF] -mt-3 mb-5">Dados que a Ana usa como fonte primária de resposta.</p>
                <div className="grid gap-5">
                  {([
                    ['priceLabel', 'Valor / preço', 'Ex.: A partir de R$ 289.000'],
                    ['commercialConditions', 'Condições comerciais', 'Ex.: Entrada facilitada em até 60x'],
                    ['availability', 'Disponibilidade', 'Ex.: Unidades de 2 e 3 quartos disponíveis'],
                    ['observations', 'Observações', 'Informações adicionais para o agente'],
                  ] as const).map(([k, lbl, ph]) => (
                    <label key={k} className="block">
                      <span className={label}>{lbl}</span>
                      <textarea
                        className={`${field} min-h-[80px] resize-y`}
                        value={variables[k] ?? ''}
                        onChange={(e) => setVariables((v) => ({ ...v, [k]: e.target.value }))}
                        placeholder={ph}
                      />
                    </label>
                  ))}
                </div>
              </section>

              {/* Card 4: Arquivos */}
              <section className={card}>
                <h2 className={heading}>Arquivos</h2>
                <p className="text-[13px] text-[#9CA3AF] -mt-3 mb-5">
                  Cada arquivo pode ser usado como base de conhecimento da Ana e/ou liberado para envio ao cliente. O envio
                  depende da permissão do próprio arquivo, não do empreendimento inteiro.
                </p>

                {/* Upload row */}
                <div className="flex flex-col gap-3 p-4 rounded-[10px] bg-[#FAFAFB] border border-dashed border-[#D1D5DB] mb-5">
                  <div className="flex flex-wrap gap-x-6 gap-y-2">
                    <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[#374151]">
                      <input
                        type="checkbox"
                        className="rounded border-[#D1D5DB] text-[#F97316] focus:ring-[#F97316]"
                        checked={uploadAsKnowledge}
                        onChange={(e) => {
                          setUploadFlagsTouched(true);
                          setUploadAsKnowledge(e.target.checked);
                        }}
                        disabled={uploading}
                      />
                      Usar como base da Ana
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer text-[13px] text-[#374151]">
                      <input
                        type="checkbox"
                        className="rounded border-[#D1D5DB] text-[#F97316] focus:ring-[#F97316]"
                        checked={uploadAllowSend}
                        onChange={(e) => {
                          setUploadFlagsTouched(true);
                          setUploadAllowSend(e.target.checked);
                        }}
                        disabled={uploading}
                      />
                      Permitir envio ao cliente
                    </label>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                  <label className="block">
                    <span className={label}>Categoria</span>
                    <select
                      className={`${fieldSelect} mt-0`}
                      value={uploadCategory}
                      onChange={(e) => setUploadCategory(e.target.value as FileCategory)}
                    >
                      {(Object.keys(CAT_LABEL) as FileCategory[]).map((c) => (
                        <option key={c} value={c}>{CAT_LABEL[c]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="relative cursor-pointer">
                    <span className="inline-flex items-center gap-2 text-[13px] font-semibold text-[#F97316] bg-[#FFF7ED] rounded-[10px] px-5 py-[10px] hover:bg-[#FFEDD5] active:bg-[#FED7AA] transition-colors">
                      <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
                      {uploading ? 'Enviando…' : 'Enviar arquivo'}
                    </span>
                    <input type="file" accept=".pdf,.txt,.md,.jpg,.jpeg,.png,.webp,.mp4,.mov,.webm,application/pdf,text/plain,text/markdown,image/jpeg,image/png,image/webp,video/mp4,video/quicktime,video/webm" onChange={onUpload} disabled={uploading} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  </label>
                  <span className="text-[11px] text-[#9CA3AF]">PDF, TXT, MD, imagens ou vídeos (até 100 MB; imagem 10 MB, vídeo 25 MB)</span>
                  </div>
                </div>

                {/* Arquivos desativados ficam ocultos por padrão; API envia isActive alinhado a is_active */}
                {knowledgeInactive.length > 0 && (
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                    <p className="text-[12px] text-[#6B7280]">
                      {showInactiveKnowledge
                        ? `${knowledgeInactive.length} arquivo(s) desativado(s) exibido(s) (legado).`
                        : `${knowledgeInactive.length} arquivo(s) desativado(s) oculto(s).`}
                    </p>
                    <button
                      type="button"
                      onClick={() => setShowInactiveKnowledge((v) => !v)}
                      className={btnGhost}
                    >
                      {showInactiveKnowledge ? 'Ocultar desativados' : 'Mostrar desativados'}
                    </button>
                  </div>
                )}

                {/* File list */}
                {files.length === 0 ? (
                  <p className="text-[13px] text-[#9CA3AF] py-1">Nenhum arquivo cadastrado.</p>
                ) : knowledgeDisplayed.length === 0 ? (
                  <div className="rounded-[10px] border border-dashed border-[#D1D5DB] bg-[#FAFAFB] px-4 py-3 text-[13px] text-[#6B7280]">
                    <p>Nenhum arquivo ativo. Existem apenas arquivos desativados (legado).</p>
                    {knowledgeInactive.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setShowInactiveKnowledge(true)}
                        className={`${btnGhost} mt-2`}
                      >
                        Mostrar {knowledgeInactive.length} desativado(s)
                      </button>
                    )}
                  </div>
                ) : (
                  <ul className="space-y-2">
                    {knowledgeDisplayed.map((f) => {
                      const isInactive = f.isActive === false;
                      const useKnowledge = f.canBeUsedAsKnowledge !== false;
                      const allowSend = f.canBeSentByAna === true;
                      const permBusy = filePatchingId === f.id;
                      return (
                        <li
                          key={f.id}
                          className={`group flex flex-col sm:flex-row sm:items-start gap-3 rounded-[10px] border px-4 py-3 transition ${
                            isInactive
                              ? 'border-[#E5E7EB] bg-[#F9FAFB] opacity-[0.72]'
                              : 'border-[#E5E7EB] bg-white hover:border-[#D1D5DB]'
                          }`}
                        >
                          <div
                            className={`shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
                              isInactive ? 'bg-[#E5E7EB]' : 'bg-[#F3F4F6]'
                            }`}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`text-[13px] font-medium truncate ${isInactive ? 'text-[#6B7280]' : 'text-[#111827]'}`}>
                              {f.originalName}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5 mt-1">
                              <span className="inline-block text-[10px] font-semibold uppercase tracking-wide text-[#3B82F6] bg-[#EFF6FF] rounded px-1.5 py-[1px]">
                                {CAT_LABEL[f.category] || f.category}
                              </span>
                              {isInactive && (
                                <span className="inline-block text-[10px] font-semibold uppercase tracking-wide text-[#92400E] bg-amber-100 rounded px-1.5 py-[1px]">
                                  Desativado
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-x-5 gap-y-1.5 mt-2.5">
                              <label
                                className={`flex items-center gap-2 text-[12px] ${isInactive ? 'text-[#9CA3AF] cursor-default' : 'text-[#374151] cursor-pointer'}`}
                              >
                                <input
                                  type="checkbox"
                                  className="rounded border-[#D1D5DB] text-[#F97316] focus:ring-[#F97316]"
                                  checked={useKnowledge}
                                  disabled={isInactive || permBusy || saving}
                                  onChange={(e) => patchFileFlags(f.id, { canBeUsedAsKnowledge: e.target.checked })}
                                />
                                Base da Ana
                              </label>
                              <label
                                className={`flex items-center gap-2 text-[12px] ${isInactive ? 'text-[#9CA3AF] cursor-default' : 'text-[#374151] cursor-pointer'}`}
                              >
                                <input
                                  type="checkbox"
                                  className="rounded border-[#D1D5DB] text-[#F97316] focus:ring-[#F97316]"
                                  checked={allowSend}
                                  disabled={isInactive || permBusy || saving}
                                  onChange={(e) => patchFileFlags(f.id, { canBeSentByAna: e.target.checked })}
                                />
                                Enviar ao cliente
                              </label>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => removeFile(f.id)}
                            className="shrink-0 text-[12px] font-medium text-[#9CA3AF] hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all sm:self-center"
                          >
                            Remover
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* Card 5: Regras adicionais */}
              <section className={card}>
                <h2 className={heading}>Regras adicionais</h2>
                <p className="text-[13px] text-[#9CA3AF] -mt-3 mb-4">
                  Instruções extras injetadas no prompt da Ana. Uma por linha.
                </p>
                <div className="flex gap-2 border-b border-[#E5E7EB] mb-4">
                  <button
                    type="button"
                    onClick={() => setRegrasTab('regras')}
                    className={`text-[13px] font-medium px-3 py-2 -mb-px border-b-2 transition ${
                      regrasTab === 'regras' ? 'border-[#F97316] text-[#111827]' : 'border-transparent text-[#6B7280] hover:text-[#111827]'
                    }`}
                  >
                    Edição
                  </button>
                  <button
                    type="button"
                    onClick={() => setRegrasTab('historico')}
                    className={`text-[13px] font-medium px-3 py-2 -mb-px border-b-2 transition ${
                      regrasTab === 'historico' ? 'border-[#F97316] text-[#111827]' : 'border-transparent text-[#6B7280] hover:text-[#111827]'
                    }`}
                  >
                    Histórico
                  </button>
                </div>
                {regrasTab === 'regras' ? (
                  <textarea
                    className={`${field} min-h-[130px] resize-y font-mono text-[13px]`}
                    value={addonsText}
                    onChange={(e) => setAddonsText(e.target.value)}
                    placeholder={"Priorizar agendamento de visita\nNão mencionar concorrentes\nSempre perguntar se já visitou o decorado"}
                  />
                ) : (
                  <div className="min-h-[130px]">
                    {historyLoading ? (
                      <p className="text-[13px] text-[#9CA3AF]">Carregando…</p>
                    ) : historyItems.length === 0 ? (
                      <p className="text-[13px] text-[#9CA3AF]">Nenhum histórico de alterações ainda.</p>
                    ) : (
                      <ul className="space-y-3 max-h-[280px] overflow-y-auto">
                        {historyItems.map((h) => (
                          <li
                            key={h.id}
                            className="rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-[13px] text-[#374151] whitespace-pre-wrap"
                          >
                            <p className="text-[11px] text-[#9CA3AF] mb-1">
                              {new Date(h.createdAt).toLocaleString('pt-BR')}
                              {h.createdByName ? ` · ${h.createdByName}` : ''}
                            </p>
                            {h.ruleText}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>

              {/* Action bar */}
              <div className="flex items-center gap-4 pt-2 pb-10">
                <button type="button" onClick={save} disabled={saving} className={btnPrimary}>
                  {saving ? (
                    <>
                      <div className="h-4 w-4 rounded-full border-2 border-white/40 border-t-white animate-spin mr-2" />
                      Salvando…
                    </>
                  ) : 'Salvar alterações'}
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}



