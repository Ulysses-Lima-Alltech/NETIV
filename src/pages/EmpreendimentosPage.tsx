import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  projectsApi,
  type EmpreendimentoDTO,
  type KnowledgeFileItem,
  type ProjectVariables,
  type FileCategory,
} from '../api/client';

const CAT_LABEL: Record<FileCategory, string> = {
  book: 'Book',
  unidades: 'Unidades',
  tabela_comercial: 'Tabela comercial',
  outro: 'Outro',
};

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

const emptyVars = (): ProjectVariables => ({
  priceLabel: '',
  commercialConditions: '',
  availability: '',
  observations: '',
});

/* ── Shared style tokens ── */

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
  const [status, setStatus] = useState<'ativo' | 'inativo'>('ativo');
  const [languageStyle, setLanguageStyle] = useState<EmpreendimentoDTO['languageStyle']>('natural');
  const [variables, setVariables] = useState<ProjectVariables>(emptyVars());
  const [addonsText, setAddonsText] = useState('');
  const [files, setFiles] = useState<KnowledgeFileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [uploadCategory, setUploadCategory] = useState<FileCategory>('book');

  /* ── Data loading (unchanged) ── */

  const loadList = useCallback(() => {
    setLoading(true);
    projectsApi
      .list(false)
      .then((d) => setList(d.projects as EmpreendimentoDTO[]))
      .catch(() => setList([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const loadDetail = useCallback((id: number) => {
    setErr(null);
    setDetail(null);
    setDetailLoading(true);
    projectsApi
      .get(id)
      .then((d) => {
        setDetail(d);
        setName(d.name);
        setSlug(d.slug);
        setStatus(d.status);
        setLanguageStyle(d.languageStyle);
        setVariables({ ...emptyVars(), ...(d.variables ?? {}) });
        setAddonsText(Array.isArray(d.promptAddons) ? d.promptAddons.join('\n') : '');
        setFiles(Array.isArray(d.knowledgeFiles) ? d.knowledgeFiles : []);
      })
      .catch((e) => { setErr(e instanceof Error ? e.message : 'Erro ao carregar'); setDetail(null); })
      .finally(() => setDetailLoading(false));
  }, []);

  useEffect(() => {
    if (selectedId != null) { loadDetail(selectedId); }
    else { setDetail(null); setDetailLoading(false); setFiles([]); setErr(null); }
  }, [selectedId, loadDetail]);

  const save = () => {
    if (selectedId == null) return;
    setSaving(true);
    setErr(null);
    const promptAddons = addonsText.split('\n').map((s) => s.trim()).filter(Boolean);
    projectsApi
      .update(selectedId, { name: name.trim(), slug: slug.trim() || undefined, status, languageStyle, variables, promptAddons })
      .then(() => { loadList(); loadDetail(selectedId); })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Erro ao salvar'))
      .finally(() => setSaving(false));
  };

  const create = () => {
    const n = newName.trim();
    if (!n) return;
    setCreating(true);
    setErr(null);
    projectsApi
      .create({ name: n })
      .then((p) => { setNewName(''); loadList(); setSelectedId(p.id); })
      .catch((e) => setErr(e instanceof Error ? e.message : 'Erro ao criar'))
      .finally(() => setCreating(false));
  };

  const onUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f || selectedId == null) return;
    setUploading(true);
    projectsApi
      .uploadKnowledge(selectedId, f, uploadCategory)
      .then(() => loadDetail(selectedId))
      .catch((er) => setErr(er instanceof Error ? er.message : 'Upload falhou'))
      .finally(() => setUploading(false));
  };

  const removeFile = (fileId: number) => {
    if (selectedId == null) return;
    projectsApi.deleteKnowledge(selectedId, fileId).then(() => loadDetail(selectedId)).catch(() => {});
  };

  const location = useLocation();
  const navBtn = (path: string) =>
    `inline-flex items-center px-4 py-2 rounded-[10px] text-[13px] font-medium text-white transition-all duration-200 ${location.pathname === path || (path !== '/inbox' && location.pathname.startsWith(path)) ? 'bg-[#F97316]' : 'bg-[#60A5FA] hover:bg-[#F97316]'}`;

  /* ── Render ── */

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      {/* ── Top bar ── */}
      <header className="sticky top-0 z-10 border-b border-[#E5E7EB] bg-white/80 backdrop-blur-sm">
        <div className="max-w-[1200px] mx-auto flex items-center gap-4 px-6 h-14">
          <Link to="/inbox" className={navBtn('/inbox')}>
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5 shrink-0"><path d="m15 18-6-6 6-6"/></svg>
            Inbox
          </Link>
          <div className="flex items-center gap-2 p-1.5 rounded-[12px] bg-[#F3F4F6]/60 border border-[#E5E7EB]/80">
            <Link to="/settings/corretores" className={navBtn('/settings/corretores')}>Corretores</Link>
            <Link to="/agenda" className={navBtn('/agenda')}>Agenda</Link>
            <Link to="/settings/integrations/whatsapp" className={navBtn('/settings/integrations/whatsapp')}>Configurações</Link>
          </div>
          <h1 className="text-[15px] font-semibold text-[#111827]">Empreendimentos</h1>
        </div>
      </header>

      <div className="max-w-[1200px] mx-auto px-6 py-8 flex flex-col md:flex-row gap-6 min-h-[calc(100vh-56px)]">

        {/* ════════════════════════════════════════
            SIDEBAR
        ════════════════════════════════════════ */}
        <aside className="w-full md:w-[240px] shrink-0 space-y-4">
          {/* List */}
          <div className={card}>
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
                      {p.name}
                      {p.status === 'inativo' && (
                        <span className="ml-1.5 text-[10px] font-medium text-[#9CA3AF] bg-[#F3F4F6] rounded px-1 py-px align-middle">
                          inativo
                        </span>
                      )}
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

        {/* ════════════════════════════════════════
            MAIN PANEL
        ════════════════════════════════════════ */}
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

              {/* ── Card 1: Dados gerais ── */}
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
                  <label className="block max-w-[220px]">
                    <span className={label}>Status</span>
                    <select className={`${fieldSelect} w-full`} value={status} onChange={(e) => setStatus(e.target.value as 'ativo' | 'inativo')}>
                      <option value="ativo">Ativo</option>
                      <option value="inativo">Inativo</option>
                    </select>
                  </label>
                </div>
              </section>

              {/* ── Card 2: Linguagem ── */}
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

              {/* ── Card 3: Variáveis ── */}
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

              {/* ── Card 4: Arquivos ── */}
              <section className={card}>
                <h2 className={heading}>Arquivos</h2>
                <p className="text-[13px] text-[#9CA3AF] -mt-3 mb-5">Arquivos do empreendimento que a Ana pode consultar ou enviar ao cliente.</p>

                {/* Upload row */}
                <div className="flex flex-wrap items-end gap-3 p-4 rounded-[10px] bg-[#FAFAFB] border border-dashed border-[#D1D5DB] mb-5">
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
                    <input type="file" accept=".pdf,.txt,.md" onChange={onUpload} disabled={uploading} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                  </label>
                  <span className="text-[11px] text-[#9CA3AF]">PDF, TXT ou MD (até 100 MB)</span>
                </div>

                {/* File list */}
                {files.length === 0 ? (
                  <p className="text-[13px] text-[#9CA3AF] py-1">Nenhum arquivo cadastrado.</p>
                ) : (
                  <ul className="space-y-2">
                    {files.map((f) => (
                      <li key={f.id} className="group flex items-center gap-3 rounded-[10px] border border-[#E5E7EB] bg-white px-4 py-3 transition hover:border-[#D1D5DB]">
                        <div className="shrink-0 w-8 h-8 rounded-lg bg-[#F3F4F6] flex items-center justify-center">
                          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6B7280" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/></svg>
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-[13px] font-medium text-[#111827] truncate">{f.originalName}</p>
                          <span className="inline-block mt-0.5 text-[10px] font-semibold uppercase tracking-wide text-[#3B82F6] bg-[#EFF6FF] rounded px-1.5 py-[1px]">
                            {CAT_LABEL[f.category] || f.category}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeFile(f.id)}
                          className="shrink-0 text-[12px] font-medium text-[#9CA3AF] hover:text-red-600 opacity-0 group-hover:opacity-100 transition-all"
                        >
                          Remover
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* ── Card 5: Regras adicionais ── */}
              <section className={card}>
                <h2 className={heading}>Regras adicionais</h2>
                <p className="text-[13px] text-[#9CA3AF] -mt-3 mb-5">
                  Instruções extras injetadas no prompt da Ana. Uma por linha.
                </p>
                <textarea
                  className={`${field} min-h-[130px] resize-y font-mono text-[13px]`}
                  value={addonsText}
                  onChange={(e) => setAddonsText(e.target.value)}
                  placeholder={"Priorizar agendamento de visita\nNão mencionar concorrentes\nSempre perguntar se já visitou o decorado"}
                />
              </section>

              {/* ── Action bar ── */}
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
