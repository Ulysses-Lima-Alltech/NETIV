import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ApiError,
  dispatchEventsApi,
  projectsApi,
  whatsappBatchApi,
  type DispatchEvent,
} from '../api/client';
import type { BatchParseResponse, BatchTemplateCatalogItem, TemplateVariableSource } from '../types/whatsappBatch';

interface Props {
  onClose: () => void;
  onSaved: (event: DispatchEvent) => void;
}

const field = 'w-full rounded-[8px] border border-l-4 border-[#E5E7EB] border-l-[#F97316] bg-white px-3 py-2 text-sm';
const fieldGreen = 'w-full rounded-[8px] border border-l-4 border-[#E5E7EB] border-l-emerald-600 bg-white px-3 py-2 text-sm';
const actionButtonBase = 'inline-flex w-full min-w-0 items-center justify-center gap-1.5 rounded-[8px] border-[3px] bg-white px-2.5 py-3 text-xs font-extrabold leading-tight text-center shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-100';
const scheduleButton = `${actionButtonBase} border-[#2563EB] text-[#2563EB] shadow-[0_3px_12px_rgba(37,99,235,0.16)] hover:bg-[#EFF6FF] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]`;
const sendNowButton = `${actionButtonBase} border-[#15803D] text-[#15803D] shadow-[0_3px_12px_rgba(21,128,61,0.16)] hover:bg-[#F0FDF4] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#15803D]`;
const templatesButton = `${actionButtonBase} border-[#F97316] text-[#F97316] shadow-[0_3px_12px_rgba(249,115,22,0.16)] hover:bg-[#FFF7ED] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F97316]`;

function downloadModel() {
  const blob = new Blob(['\uFEFFNOME,TELEFONE\r\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'modelo-disparo.csv';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function DispatchEventModal({ onClose, onSaved }: Props) {
  const navigate = useNavigate();
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const inFlight = useRef(false);
  const parseVersion = useRef(0);
  const [templates, setTemplates] = useState<BatchTemplateCatalogItem[]>([]);
  const [projects, setProjects] = useState<{ id: number; name: string }[]>([]);
  const [name, setName] = useState('');
  const [templateKey, setTemplateKey] = useState('');
  const [enterpriseId, setEnterpriseId] = useState('');
  const [date, setDate] = useState('');
  const [postSendMode, setPostSendMode] = useState<'ANA' | 'HANDOFF'>('ANA');
  const [art, setArt] = useState<File | null>(null);
  const [artUrl, setArtUrl] = useState('');
  const [sheetFile, setSheetFile] = useState<File | null>(null);
  const [sheet, setSheet] = useState<BatchParseResponse['spreadsheet'] | null>(null);
  const [mapping, setMapping] = useState<Record<string, TemplateVariableSource>>({});
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [loading, setLoading] = useState(true);
  const [previewOnly, setPreviewOnly] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<{ mode: 'NOW' | 'SCHEDULED'; data: FormData } | null>(null);
  const selected = templates.find((template) => template.key === templateKey);

  useEffect(() => {
    const previous = document.activeElement;
    if (dialog.current && !dialog.current.open) dialog.current.showModal();
    return () => {
      if (dialog.current?.open) dialog.current.close();
      if (previous instanceof HTMLElement) previous.focus();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      whatsappBatchApi.listTemplates({ refresh: true }),
      projectsApi.list(false),
    ]).then(([catalog, result]) => {
      if (cancelled) return;
      const localPreview = catalog.source !== 'meta_sync'
        && import.meta.env.VITE_DISPATCH_PREVIEW_MODE === 'true';
      if (catalog.source !== 'meta_sync' && !localPreview) {
        throw new Error('Não foi possível confirmar templates aprovados na Meta. Tente novamente.');
      }
      setPreviewOnly(localPreview);
      setTemplates(catalog.templates.filter((template) => (
        String(template.status).toUpperCase() === 'APPROVED'
        || (localPreview && template.source === 'local_fallback')
      )
        && !template.hasHeaderVideo
        && !template.hasHeaderDocument
        && (!template.requiresHeaderMedia || template.hasHeaderImage)
      ));
      setProjects(result.projects
        .filter((project) => project.status === 'ativo')
        .map((project) => ({ id: project.id, name: project.name })));
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : 'Erro ao carregar os dados.');
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!art) {
      setArtUrl('');
      return;
    }
    const url = URL.createObjectURL(art);
    setArtUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [art]);

  async function parseFile(file: File | null) {
    const version = ++parseVersion.current;
    setSheetFile(file);
    setSheet(null);
    setError('');
    if (!file) return;
    if (!/\.(csv|xlsx)$/i.test(file.name) || file.size > 10 * 1024 * 1024) {
      setError('Use um arquivo CSV ou XLSX de até 10 MB.');
      return;
    }
    setParsing(true);
    try {
      const result = await whatsappBatchApi.parseSpreadsheet(file);
      if (version !== parseVersion.current) return;
      if (!['NOME', 'TELEFONE'].every((header) => result.spreadsheet.headers.includes(header))) {
        throw new Error('A planilha precisa das colunas NOME e TELEFONE, com esses nomes.');
      }
      if (result.spreadsheet.rows.length === 0 || result.spreadsheet.rows.length > 5000) {
        throw new Error('Importe entre 1 e 5000 leads por disparo.');
      }
      setSheet(result.spreadsheet);
    } catch (reason) {
      if (version === parseVersion.current) {
        setError(reason instanceof Error ? reason.message : 'Não foi possível ler a planilha.');
      }
    } finally {
      if (version === parseVersion.current) setParsing(false);
    }
  }

  function closeSafely(): boolean {
    if (busy) return false;
    if (pending && !window.confirm(
      'O evento pode ter sido salvo. Antes de cadastrar outro, confira a Agenda. Deseja fechar?'
    )) return false;
    onClose();
    return true;
  }

  function openTemplates() {
    const hasDraft = Boolean(name.trim() || enterpriseId || templateKey || art || sheet || date);
    if (!pending && hasDraft && !window.confirm(
      'Ao abrir Templates META, os dados ainda não salvos deste evento serão descartados. Deseja continuar?'
    )) return;
    if (!closeSafely()) return;
    navigate('/contatos/disparo-template-lote?tab=templates');
  }

  async function save(mode: 'NOW' | 'SCHEDULED') {
    if (inFlight.current) return;
    if (!pending && !form.current?.reportValidity()) return;
    setError('');
    let data = pending?.data;
    if (!data) {
      if (!sheet || !sheetFile || !art || !selected) {
        setError('Selecione um template, uma arte e uma planilha válida.');
        return;
      }
      if (art.size > 5 * 1024 * 1024 || !['image/jpeg', 'image/png'].includes(art.type)) {
        setError('A arte deve ser JPG/PNG e ter até 5 MB.');
        return;
      }
      const localDate = date ? new Date(date) : null;
      if (mode === 'SCHEDULED' && (
        !localDate || !Number.isFinite(localDate.getTime()) || localDate.getTime() <= Date.now()
      )) {
        setError('Escolha uma data e hora futuras para agendar.');
        return;
      }
      if (!window.confirm(`Confirmar ${mode === 'NOW' ? 'disparo agora' : 'agendamento'} para ${sheet.rows.length} leads?`)) return;

      data = new FormData();
      data.append('art', art);
      data.append('payload', JSON.stringify({
        requestId,
        name,
        sendMode: mode,
        postSendMode,
        ...(mode === 'SCHEDULED' ? { scheduledAt: localDate!.toISOString() } : {}),
        mapping: {
          templateKey,
          selectedEnterpriseId: Number(enterpriseId),
          selectedBrokerIds: [],
          phoneColumn: 'TELEFONE',
          customerNameColumn: 'NOME',
          variableMappings: mapping,
        },
        rows: sheet.rows.map((row) => ({ NOME: row.NOME, TELEFONE: row.TELEFONE })),
      }));
      setPending({ mode, data });
    }

    inFlight.current = true;
    setBusy(true);
    try {
      const result = await dispatchEventsApi.create(data);
      onSaved(result.event);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha de conexão. Tente novamente.');
      if (reason instanceof ApiError && reason.status === 400) {
        setPending(null);
        setRequestId(crypto.randomUUID());
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="dispatch-event-title"
      className="m-auto max-h-[90dvh] w-[min(94vw,720px)] rounded-[16px] p-0 text-[#111827] backdrop:bg-black/40"
      onCancel={(event) => { event.preventDefault(); closeSafely(); }}
    >
      <form ref={form} onSubmit={(event) => event.preventDefault()} className="space-y-5 overflow-y-auto p-5">
        <header className="flex items-center justify-between gap-3">
          <h2 id="dispatch-event-title" className="text-xl font-semibold">Agendar Disparo</h2>
          <button type="button" disabled={busy} onClick={closeSafely} aria-label="Fechar modal">Fechar</button>
        </header>
        <p className="text-sm text-[#6B7280]">1. Evento e template / 2. Arte e leads / 3. Revise e confirme</p>
        {previewOnly && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Prévia local: templates de demonstração. Os botões de envio ficam desativados.
          </p>
        )}

        <fieldset disabled={busy || loading || Boolean(pending)} className="space-y-4 disabled:opacity-60">
          <section className="space-y-4 rounded-[6px] border border-[#F97316] bg-white p-4">
            <header className="flex items-start gap-3 border-b border-[#E2E8F0] pb-3">
              <span className="rounded-[4px] bg-[#FFF1E8] px-2 py-1 text-xs font-bold text-[#C2410C]">01</span>
              <div>
                <h3 className="text-base font-bold text-[#123A73]">Dados do evento</h3>
                <p className="mt-0.5 text-xs text-[#64748B]">Identifique o evento e escolha o conteúdo que será enviado.</p>
              </div>
            </header>

            <label className="block text-sm">Nome do evento
              <input autoFocus required maxLength={160} value={name}
                onChange={(event) => setName(event.target.value)} className={field} />
            </label>
            <label className="block text-sm">Empreendimento (Produto)
              <select required value={enterpriseId} onChange={(event) => setEnterpriseId(event.target.value)} className={field}>
                <option value="">Selecione</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>{project.name}</option>
                ))}
              </select>
            </label>
            <label className="block text-sm">Template do Meta
              <select required value={templateKey} onChange={(event) => {
                setTemplateKey(event.target.value);
                setMapping({});
              }} className={field}>
                <option value="">Selecione um template aprovado</option>
                {templates.map((template) => (
                  <option key={template.key} value={template.key}>{template.name}</option>
                ))}
              </select>
            </label>
            {selected?.messageBodyTemplate && (
              <p className="whitespace-pre-wrap rounded-[6px] bg-[#F8FAFC] p-3 text-sm">
                {selected.messageBodyTemplate}
              </p>
            )}
            {selected?.variables.map((variable) => {
              const source = mapping[String(variable.id)];
              return (
                <label key={variable.id} className="block text-sm">
                  {`{{${variable.id}}}`} - {variable.label}
                  <select required value={source?.type === 'column' ? 'name' : source?.type ?? ''}
                    className={field} onChange={(event) => {
                      if (!event.target.value) {
                        setMapping((previous) => {
                          const next = { ...previous };
                          delete next[String(variable.id)];
                          return next;
                        });
                        return;
                      }
                      const next: TemplateVariableSource = event.target.value === 'name'
                        ? { type: 'column', columnName: 'NOME' }
                        : event.target.value === 'enterprise'
                          ? { type: 'enterprise' }
                          : { type: 'fixed', fixedValue: '' };
                      setMapping((previous) => ({ ...previous, [String(variable.id)]: next }));
                    }}>
                    <option value="">Escolha o conteúdo</option>
                    <option value="name">NOME do lead</option>
                    <option value="enterprise">Nome do empreendimento</option>
                    <option value="fixed">Texto fixo</option>
                  </select>
                  {source?.type === 'fixed' && (
                    <input required className={field} value={source.fixedValue ?? ''}
                      aria-label={`Texto fixo para variável ${variable.id}`}
                      onChange={(event) => setMapping((previous) => ({
                        ...previous,
                        [String(variable.id)]: { type: 'fixed', fixedValue: event.target.value },
                      }))} />
                  )}
                </label>
              );
            })}

            <label className="block text-sm">Arte do evento (JPG/PNG, até 5 MB)
              <input required type="file" accept="image/jpeg,image/png" className={field}
                onChange={(event) => setArt(event.target.files?.[0] ?? null)} />
            </label>
            {artUrl && <img src={artUrl} alt="Prévia da arte do evento" className="max-h-48 rounded-[6px] object-contain" />}
            {selected && !selected.hasHeaderImage && (
              <p className="text-sm">Este template não aceita imagem; a arte será exibida somente na Agenda.</p>
            )}
          </section>

          <section className="space-y-4 rounded-[6px] border border-emerald-600 bg-white p-4">
            <header className="flex items-start gap-3 border-b border-[#E2E8F0] pb-3">
              <span className="rounded-[4px] bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">02</span>
              <div>
                <h3 className="text-base font-bold text-emerald-700">Leads e disparo</h3>
                <p className="mt-0.5 text-xs text-[#64748B]">Importe os contatos, escolha o horário e defina quem atenderá.</p>
              </div>
            </header>

            <div className="rounded-[6px] border border-[#BFDBFE] bg-[#EFF6FF] p-4 text-center">
              <p className="mb-3 text-sm font-semibold text-[#123A73]">Use a planilha padrão para importar os leads</p>
              <button type="button" onClick={downloadModel}
                className="mx-auto inline-flex items-center justify-center gap-2 rounded-[6px] bg-[#2563EB] px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#1D4ED8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1D4ED8]">
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
                  className="h-4 w-4" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 3v12m0 0 4-4m-4 4-4-4" />
                  <path d="M5 17v3h14v-3" />
                </svg>
                Baixar Planilha Modelo
              </button>
            </div>

            <label className="block text-sm">Planilha de leads
              <input type="file" accept=".csv,.xlsx" className={fieldGreen}
                onChange={(event) => void parseFile(event.target.files?.[0] ?? null)} />
            </label>
            <p className="text-xs">Cabeçalhos NOME e TELEFONE. Telefone como texto, com DDI e DDD. CSV separado por vírgulas.</p>
            {parsing && <p role="status">Lendo planilha...</p>}
            {sheet && <div className="rounded-[6px] border border-[#E2E8F0] p-3 text-sm">
              <p>{sheet.rows.length} leads importados. Exemplos:</p>
              {sheet.rows.slice(0, 3).map((row, index) => (
                <p key={index}>{row.NOME} - {row.TELEFONE}</p>
              ))}
            </div>}

            <label className="block text-sm">Data e hora do disparo
              <input type="datetime-local" value={date} onChange={(event) => setDate(event.target.value)} className={fieldGreen} />
              <span className="text-xs">Horário local do dispositivo. Obrigatório apenas para agendar.</span>
            </label>
            <label className="block text-sm">Atendimento após o disparo
              <select className={fieldGreen} value={postSendMode}
                onChange={(event) => setPostSendMode(event.target.value === 'HANDOFF' ? 'HANDOFF' : 'ANA')}>
                <option value="ANA">ANA automaticamente</option>
                <option value="HANDOFF">Atendimento humano</option>
              </select>
            </label>
          </section>
        </fieldset>

        <details className="rounded-[6px] border-2 border-[#3B82F6] bg-[#EFF6FF] p-3 text-sm text-[#123A73]">
          <summary className="cursor-pointer font-semibold text-[#123A73]">Preciso de ajuda</summary>
          <ol className="list-decimal space-y-4 pl-5 pt-3">
            <li>
              <p className="font-semibold">Você já criou um template do Meta?</p>
              <p className="mt-1">
                Caso não tenha criado, clique no botão <strong>TEMPLATES META</strong> no rodapé e crie seu modelo.
                A tela orienta a criação de forma simples e intuitiva.
              </p>
            </li>
            <li>
              <p className="font-semibold">Se o template já foi criado e aprovado, continue nesta tela.</p>
              <p className="mt-1">Preencha o bloco 01 com atenção:</p>
              <ul className="mt-1 list-disc space-y-1 pl-5">
                <li>Nome do Evento.</li>
                <li>Empreendimento (Produto).</li>
                <li>Template do Meta, criado e aprovado anteriormente.</li>
                <li>Arte do Evento.</li>
              </ul>
              <p className="mt-2">
                Depois de revisar o bloco 01, preencha o bloco 02: importe a planilha de leads, programe
                a data e a hora e escolha quem vai assumir a conversa caso o contato responda à mensagem.
              </p>
            </li>
          </ol>
        </details>

        {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
        {pending && !busy && (
          <p className="text-sm">Se a conexão falhou, tente a mesma ação novamente. Os dados ficam congelados para evitar duplicação.</p>
        )}
        <footer className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <button type="button" onClick={openTemplates} disabled={busy} className={templatesButton}>
              <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
                className="h-4 w-4 shrink-0" stroke="currentColor" strokeWidth="2"
                strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
                <path d="M14 2v6h6M8 13h8M8 17h6" />
              </svg>
              <span className="leading-tight">TEMPLATES META</span>
            </button>
            {(['SCHEDULED', 'NOW'] as const).map((mode) => (
              <button key={mode} type="button" className={mode === 'SCHEDULED' ? scheduleButton : sendNowButton}
                disabled={busy || loading || parsing || previewOnly || !sheet || (pending !== null && pending.mode !== mode)}
                onClick={() => void save(mode)}>
                <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
                  className="h-4 w-4 shrink-0" stroke="currentColor" strokeWidth="2"
                  strokeLinecap="round" strokeLinejoin="round">
                  {mode === 'SCHEDULED' ? (
                    <>
                      <rect x="3" y="5" width="18" height="16" rx="2" />
                      <path d="M16 3v4M8 3v4M3 10h18" />
                      <path d="m9 16 2 2 4-4" />
                    </>
                  ) : (
                    <>
                      <path d="m22 2-7 20-4-9-9-4Z" />
                      <path d="M22 2 11 13" />
                    </>
                  )}
                </svg>
                <span className="leading-tight">
                  {busy ? 'SALVANDO...' : mode === 'SCHEDULED' ? 'SALVAR E AGENDAR' : 'SALVAR E DISPARAR'}
                </span>
              </button>
            ))}
          </div>
        </footer>
      </form>
    </dialog>
  );
}
