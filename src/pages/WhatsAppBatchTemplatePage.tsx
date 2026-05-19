import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { useAuth } from '../contexts/AuthContext';
import {
  ApiError,
  corretoresApi,
  projectsApi,
  whatsappApi,
  whatsappBatchApi,
  type Corretor,
  type ProjectListItem,
  type WhatsAppMetaTemplateItem,
} from '../api/client';
import { SpreadsheetUploadPanel } from '../components/whatsapp-batch/SpreadsheetUploadPanel';
import { TemplateSelector } from '../components/whatsapp-batch/TemplateSelector';
import { ColumnMappingPanel } from '../components/whatsapp-batch/ColumnMappingPanel';
import { BatchPreviewTable } from '../components/whatsapp-batch/BatchPreviewTable';
import { TestSendPanel } from '../components/whatsapp-batch/TestSendPanel';
import type {
  BatchParseResponse,
  BatchPreviewResponse,
  BatchTemplateCatalogItem,
  TemplateVariableSource,
} from '../types/whatsappBatch';

function normalizeMetaStatus(raw: string | null | undefined): string {
  const value = String(raw ?? '').trim().toUpperCase();
  return value || 'UNKNOWN';
}

function statusLabel(status: string): string {
  const map: Record<string, string> = {
    APPROVED: 'Aprovado',
    PENDING: 'Pendente',
    REJECTED: 'Rejeitado',
    PAUSED: 'Pausado',
    DISABLED: 'Desativado',
    DELETED: 'Excluido',
    UNKNOWN: 'Desconhecido',
  };
  return map[status] ?? `Outro: ${status}`;
}

function statusBadgeClass(status: string): string {
  const map: Record<string, string> = {
    APPROVED: 'bg-emerald-100 text-emerald-800',
    PENDING: 'bg-amber-100 text-amber-800',
    REJECTED: 'bg-red-100 text-red-800',
    PAUSED: 'bg-orange-100 text-orange-800',
    DISABLED: 'bg-slate-300 text-slate-800',
    DELETED: 'bg-slate-700 text-white',
    UNKNOWN: 'bg-slate-100 text-slate-700',
  };
  return map[status] ?? 'bg-slate-100 text-slate-700';
}

function isTemplateUsableForBatch(
  template: BatchTemplateCatalogItem,
  catalogSource: 'meta_sync' | 'local_fallback' | 'unknown',
): boolean {
  const status = normalizeMetaStatus(template.status);
  if (status === 'APPROVED') return true;
  if (catalogSource === 'local_fallback' && template.source === 'local_fallback') return true;
  return false;
}

export function WhatsAppBatchTemplatePage() {
  const { isAdmin } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [templates, setTemplates] = useState<BatchTemplateCatalogItem[]>([]);
  const [projects, setProjects] = useState<ProjectListItem[]>([]);
  const [brokers, setBrokers] = useState<Corretor[]>([]);
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('');
  const [parseData, setParseData] = useState<BatchParseResponse | null>(null);
  const [phoneColumn, setPhoneColumn] = useState('');
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState('');
  const [selectedBrokerIds, setSelectedBrokerIds] = useState<string[]>([]);
  const [variableMappings, setVariableMappings] = useState<Record<string, TemplateVariableSource>>({});
  const [preview, setPreview] = useState<BatchPreviewResponse | null>(null);
  const [testPhone, setTestPhone] = useState('');
  const [testMode, setTestMode] = useState<'row' | 'manual'>('row');
  const [testRowNumber, setTestRowNumber] = useState<number | null>(null);
  const [manualTestVariables, setManualTestVariables] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<string | null>(null);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [loadingParse, setLoadingParse] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingTest, setLoadingTest] = useState(false);
  const [loadingSend, setLoadingSend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesLoadError, setTemplatesLoadError] = useState<string | null>(null);
  const [templatesSyncWarning, setTemplatesSyncWarning] = useState<string | null>(null);
  const [templatesCatalogSource, setTemplatesCatalogSource] = useState<'meta_sync' | 'local_fallback' | 'unknown'>('unknown');

  const [activeTab, setActiveTab] = useState<'batch' | 'templates'>('batch');
  const [metaTemplates, setMetaTemplates] = useState<WhatsAppMetaTemplateItem[]>([]);
  const [metaTemplatesLoading, setMetaTemplatesLoading] = useState(false);
  const [metaTemplatesError, setMetaTemplatesError] = useState<string | null>(null);
  const [metaTemplatesSource, setMetaTemplatesSource] = useState<'meta_sync' | 'local_fallback' | 'unknown'>('unknown');
  const [metaActionLoading, setMetaActionLoading] = useState(false);
  const [metaActionFeedback, setMetaActionFeedback] = useState<string | null>(null);
  const [metaTemplateName, setMetaTemplateName] = useState('');
  const [metaTemplateCategory, setMetaTemplateCategory] = useState<'MARKETING' | 'UTILITY' | 'AUTHENTICATION'>('MARKETING');
  const [metaTemplateLanguage, setMetaTemplateLanguage] = useState('pt_BR');
  const [metaTemplateBody, setMetaTemplateBody] = useState('');
  const [metaTemplateHeader, setMetaTemplateHeader] = useState('');
  const [metaTemplateFooter, setMetaTemplateFooter] = useState('');
  const [metaSearch, setMetaSearch] = useState('');
  const [metaStatusFilter, setMetaStatusFilter] = useState('ALL');
  const [metaCategoryFilter, setMetaCategoryFilter] = useState('ALL');

  useEffect(() => {
    setTemplatesLoading(true);
    setTemplatesLoadError(null);
    setTemplatesSyncWarning(null);
    void whatsappBatchApi
      .listTemplates()
      .then((r) => {
        setTemplates(r.templates ?? []);
        setTemplatesSyncWarning(r.warning ?? null);
        setTemplatesCatalogSource((r.source as 'meta_sync' | 'local_fallback' | undefined) ?? 'unknown');
      })
      .catch((err: unknown) => {
        setTemplates([]);
        const base = 'Nao foi possivel carregar a lista de templates.';
        if (err instanceof ApiError) {
          let msg = `${base} ${err.message}`;
          if (err.status != null) msg += ` (HTTP ${err.status})`;
          if (err.status === 401) msg += ' Faca login novamente (sessao invalida ou expirada).';
          if (err.status === 403) msg += ' A rota exige perfil ADMIN (integracoes).';
          setTemplatesLoadError(msg);
        } else if (err instanceof Error) {
          setTemplatesLoadError(`${base} ${err.message}`);
        } else {
          setTemplatesLoadError(`${base} Verifique rede, VITE_API_URL e se o backend esta no ar.`);
        }
      })
      .finally(() => setTemplatesLoading(false));

    void projectsApi
      .list(true)
      .then((d) => setProjects(d.projects.filter((p) => p.status === 'ativo')))
      .catch(() => setProjects([]));
    void corretoresApi.list().then((d) => setBrokers(d.corretores)).catch(() => setBrokers([]));
  }, []);

  const loadMetaTemplates = async () => {
    setMetaTemplatesLoading(true);
    setMetaTemplatesError(null);
    try {
      const res = await whatsappApi.listTemplates();
      setMetaTemplates(res.templates ?? []);
      setMetaTemplatesSource((res.source as 'meta_sync' | 'local_fallback' | undefined) ?? 'unknown');
    } catch (e) {
      setMetaTemplatesError(e instanceof Error ? e.message : 'Erro ao carregar templates da Meta.');
    } finally {
      setMetaTemplatesLoading(false);
    }
  };

  const handleEnterTemplatesTab = async () => {
    setActiveTab('templates');
    if (metaTemplates.length === 0 && !metaTemplatesLoading) {
      await loadMetaTemplates();
    }
  };

  const handleCreateMetaTemplate = async () => {
    setMetaActionFeedback(null);
    if (!metaTemplateName.trim() || !metaTemplateBody.trim()) {
      setMetaActionFeedback('Nome tecnico e BODY sao obrigatorios.');
      return;
    }
    setMetaActionLoading(true);
    try {
      await whatsappApi.createTemplate({
        name: metaTemplateName.trim(),
        category: metaTemplateCategory,
        language: metaTemplateLanguage.trim() || 'pt_BR',
        body: metaTemplateBody.trim(),
        headerText: metaTemplateHeader.trim() || undefined,
        footerText: metaTemplateFooter.trim() || undefined,
      });
      setMetaActionFeedback('Template enviado para criacao na Meta com sucesso.');
      setMetaTemplateName('');
      setMetaTemplateBody('');
      setMetaTemplateHeader('');
      setMetaTemplateFooter('');
      await loadMetaTemplates();
    } catch (e) {
      setMetaActionFeedback(e instanceof Error ? e.message : 'Erro ao criar template na Meta.');
    } finally {
      setMetaActionLoading(false);
    }
  };

  const handleDeleteMetaTemplate = async (name: string) => {
    const confirmed = window.confirm(`Confirma a exclusao do template "${name}" na Meta?`);
    if (!confirmed) return;
    setMetaActionLoading(true);
    setMetaActionFeedback(null);
    try {
      await whatsappApi.deleteTemplate(name);
      setMetaActionFeedback(`Template ${name} removido na Meta.`);
      await loadMetaTemplates();
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 400)) {
        setMetaActionFeedback('Não foi possível excluir este template. Ele pode não existir mais na Meta.');
      } else {
        setMetaActionFeedback('Não foi possível excluir este template. Ele pode não existir mais na Meta.');
      }
    } finally {
      setMetaActionLoading(false);
    }
  };

  const handleSyncMetaTemplates = async () => {
    setMetaActionLoading(true);
    setMetaActionFeedback(null);
    try {
      await whatsappApi.syncTemplates();
      await loadMetaTemplates();
      const refreshed = await whatsappBatchApi.listTemplates({ refresh: true });
      setTemplates(refreshed.templates ?? []);
      setTemplatesSyncWarning(refreshed.warning ?? null);
      setTemplatesCatalogSource((refreshed.source as 'meta_sync' | 'local_fallback' | undefined) ?? 'unknown');
      setMetaActionFeedback('Sincronizacao concluida.');
    } catch (e) {
      setMetaActionFeedback(e instanceof Error ? e.message : 'Erro ao sincronizar templates.');
    } finally {
      setMetaActionLoading(false);
    }
  };

  const selectedTemplate = templates.find((tpl) => tpl.key === selectedTemplateKey) ?? null;
  const usableTemplates = templates.filter((tpl) => isTemplateUsableForBatch(tpl, templatesCatalogSource));
  const templateStatus = normalizeMetaStatus(selectedTemplate?.status);
  const templateNotApprovedMessage =
    selectedTemplate && templateStatus !== 'APPROVED'
      ? 'Este template ainda nao esta aprovado na Meta. Ele pode ser visualizado, mas nao pode ser usado para disparo.'
      : null;
  const headerMediaMissing = !!selectedTemplate?.requiresHeaderMedia && !selectedTemplate?.headerImageUrl;
  const headerMediaMissingMessage = headerMediaMissing
    ? 'Este template exige imagem de cabecalho. Cadastre uma URL publica antes de enviar.'
    : null;
  const missingBrokersMessage =
    selectedBrokerIds.length === 0 ? 'Selecione ao menos um corretor responsavel para distribuir a base.' : null;
  const actionBlockedReason = templateNotApprovedMessage ?? headerMediaMissingMessage ?? missingBrokersMessage;

  const allMetaStatuses = Array.from(
    new Set(metaTemplates.map((tpl) => normalizeMetaStatus(tpl.status))),
  ).sort((a, b) => a.localeCompare(b));
  const allMetaCategories = Array.from(
    new Set(metaTemplates.map((tpl) => String(tpl.category ?? 'UNKNOWN').toUpperCase())),
  ).sort((a, b) => a.localeCompare(b));
  const filteredMetaTemplates = metaTemplates.filter((tpl) => {
    const status = normalizeMetaStatus(tpl.status);
    const category = String(tpl.category ?? 'UNKNOWN').toUpperCase();
    const language = String(tpl.language ?? '').toLowerCase();
    const name = String(tpl.name ?? '').toLowerCase();
    const search = metaSearch.trim().toLowerCase();
    const matchesSearch =
      !search ||
      name.includes(search) ||
      category.toLowerCase().includes(search) ||
      language.includes(search) ||
      status.toLowerCase().includes(search);
    const matchesStatus = metaStatusFilter === 'ALL' || status === metaStatusFilter;
    const matchesCategory = metaCategoryFilter === 'ALL' || category === metaCategoryFilter;
    return matchesSearch && matchesStatus && matchesCategory;
  });

  const validPreviewRows = (preview?.rows ?? []).filter((row) => row.status === 'valid');
  const canUseRowMode = validPreviewRows.length > 0;
  const selectedPreviewRow =
    testRowNumber == null ? null : validPreviewRows.find((row) => row.rowNumber === testRowNumber) ?? null;

  const buildMappingPayload = () => ({
    templateKey: selectedTemplateKey,
    phoneColumn,
    selectedEnterpriseId: selectedEnterpriseId ? parseInt(selectedEnterpriseId, 10) : null,
    selectedBrokerId: selectedBrokerIds.length > 0 ? parseInt(selectedBrokerIds[0]!, 10) : null,
    selectedBrokerIds: selectedBrokerIds.map((id) => parseInt(id, 10)).filter((id) => Number.isFinite(id)),
    variableMappings,
  });

  const handleFileChange = (next: File | null) => {
    setFile(next);
    setError(null);
    setParseData(null);
    setPreview(null);
    setTestRowNumber(null);
    setSendResult(null);
    setTestResult(null);
  };

  const handleSelectedTemplateKeyChange = (key: string) => {
    setSelectedTemplateKey(key);
    setPreview(null);
    setTestResult(null);
    setSendResult(null);
    setTestRowNumber(null);

    const tpl = templates.find((t) => t.key === key) ?? null;
    setVariableMappings((prev) => {
      if (!tpl) return {};
      const allowed = new Set(tpl.variables.map((v) => String(v.id)));
      const next: Record<string, TemplateVariableSource> = {};
      for (const [k, v] of Object.entries(prev)) {
        if (allowed.has(k)) next[k] = v;
      }
      if (parseData) {
        for (const variable of tpl.variables) {
          const id = String(variable.id);
          if (next[id]) continue;
          const label = variable.label.toLowerCase();
          if (parseData.suggestions.customerNameColumn && label.includes('cliente')) {
            next[id] = { type: 'column', columnName: parseData.suggestions.customerNameColumn };
          } else if (parseData.suggestions.enterpriseColumn && label.includes('empreendimento')) {
            next[id] = { type: 'column', columnName: parseData.suggestions.enterpriseColumn };
          }
        }
      }
      return next;
    });
  };

  const handleParse = async () => {
    if (!file) return;
    setLoadingParse(true);
    setError(null);
    try {
      const parsed = await whatsappBatchApi.parseSpreadsheet(file, { templateKey: selectedTemplateKey || undefined });
      setParseData(parsed);
      if (parsed.suggestions.phoneColumn) setPhoneColumn(parsed.suggestions.phoneColumn);
      if (selectedTemplate) {
        setVariableMappings((prev) => {
          const next = { ...prev };
          for (const variable of selectedTemplate.variables) {
            const existing = next[String(variable.id)];
            if (existing) continue;
            const label = variable.label.toLowerCase();
            if (parsed.suggestions.customerNameColumn && label.includes('cliente')) {
              next[String(variable.id)] = {
                type: 'column',
                columnName: parsed.suggestions.customerNameColumn,
              };
            } else if (parsed.suggestions.enterpriseColumn && label.includes('empreendimento')) {
              next[String(variable.id)] = {
                type: 'column',
                columnName: parsed.suggestions.enterpriseColumn,
              };
            }
          }
          return next;
        });
      }
      setPreview(null);
      setTestRowNumber(null);
      setSendResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao ler planilha.');
    } finally {
      setLoadingParse(false);
    }
  };

  const handlePreview = async () => {
    if (actionBlockedReason) {
      setError(actionBlockedReason);
      return;
    }
    if (!parseData) return;
    if (!Array.isArray(parseData.spreadsheet.rows) || parseData.spreadsheet.rows.length === 0) {
      setError('Processe a planilha com "Ler colunas" antes de gerar o preview.');
      return;
    }
    if (!selectedTemplateKey) {
      setError('Selecione um template para configurar o mapeamento e gerar o preview.');
      return;
    }
    setLoadingPreview(true);
    setError(null);
    try {
      const mapping = buildMappingPayload();
      const previewData = await whatsappBatchApi.buildPreview(parseData.spreadsheet, mapping);
      setPreview(previewData);
      setTestRowNumber(null);
      setTestResult(null);
      setSendResult(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar preview.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleTest = async () => {
    if (actionBlockedReason) {
      setError(actionBlockedReason);
      return;
    }
    if (!selectedTemplate || !parseData) return;
    setLoadingTest(true);
    setError(null);
    setTestResult(null);
    try {
      const mapping = buildMappingPayload();
      const selectedRowIndex =
        testMode === 'row'
          ? selectedPreviewRow?.rowIndex ?? (testRowNumber != null ? testRowNumber - 2 : undefined)
          : undefined;
      const result = await whatsappBatchApi.sendTest({
        spreadsheet: parseData.spreadsheet,
        mapping,
        testPhone,
        mode: testMode,
        sampleRowIndex: selectedRowIndex,
        manualVariables: testMode === 'manual' ? manualTestVariables : undefined,
      });
      setTestResult(JSON.stringify(result, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar teste.');
    } finally {
      setLoadingTest(false);
    }
  };

  const handleSend = async () => {
    if (actionBlockedReason) {
      setError(actionBlockedReason);
      return;
    }
    if (!preview || preview.validCount === 0) return;
    if (!selectedTemplateKey) {
      setError('Selecione um template antes de enviar em lote.');
      return;
    }
    setLoadingSend(true);
    setError(null);
    setSendResult(null);
    try {
      const mapping = buildMappingPayload();
      const result = await whatsappBatchApi.sendBatch(parseData!.spreadsheet, mapping);
      setSendResult(JSON.stringify(result, null, 2));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar mensagens.');
    } finally {
      setLoadingSend(false);
    }
  };

  if (!isAdmin) return <Navigate to="/inbox" replace />;

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-[#111827]">
      <nav className="h-14 border-b border-[#E5E7EB] bg-white/90 backdrop-blur-sm sticky top-0 z-20 px-6 flex items-center justify-between">
        <span className="text-[15px] font-semibold">Disparo em Lote</span>
        <AppNav />
      </nav>

      <div className="w-full max-w-none px-6 lg:px-8 py-6 space-y-5">
        <div>
          <p className="text-[13px] text-[#6B7280]">
            Envie templates do WhatsApp em lote a partir de uma planilha: faca o upload, escolha o template, mapeie colunas e envie.
          </p>
        </div>

        <div className="bg-white border border-[#E5E7EB] rounded-[12px] p-2 inline-flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab('batch')}
            className={`px-3 py-2 rounded-[10px] text-[13px] font-medium ${
              activeTab === 'batch' ? 'bg-[#DBEAFE] text-[#1D4ED8]' : 'text-[#4B5563] hover:bg-[#F3F4F6]'
            }`}
          >
            Disparo em lote
          </button>
          <button
            type="button"
            onClick={() => void handleEnterTemplatesTab()}
            className={`px-3 py-2 rounded-[10px] text-[13px] font-medium ${
              activeTab === 'templates' ? 'bg-[#DBEAFE] text-[#1D4ED8]' : 'text-[#4B5563] hover:bg-[#F3F4F6]'
            }`}
          >
            Templates META
          </button>
        </div>

        {activeTab === 'templates' ? (
          <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-5 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[16px] font-semibold">Templates META</h2>
                <p className="text-[13px] text-[#4B5563] mt-1">
                  Gerencie templates na Meta: liste, crie, exclua e acompanhe o status de aprovacao.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void handleSyncMetaTemplates()}
                disabled={metaActionLoading || metaTemplatesLoading}
                className="px-3 py-2 rounded-[10px] border border-[#BFDBFE] text-[#1D4ED8] bg-[#EFF6FF] hover:bg-[#DBEAFE] disabled:opacity-60"
              >
                {metaActionLoading ? 'Sincronizando...' : 'Atualizar/Sincronizar'}
              </button>
            </div>

            {metaTemplatesError && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">{metaTemplatesError}</div>
            )}
            {metaActionFeedback && (
              <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-sm text-slate-700">{metaActionFeedback}</div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] items-start gap-5">
              <div className="space-y-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[12px] p-4">
                <h3 className="text-[14px] font-semibold">Criar template</h3>
                <div className="grid grid-cols-1 gap-3">
                  <input
                    className="w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px]"
                    placeholder="Nome tecnico (ex: oferta_lancamento_maio)"
                    value={metaTemplateName}
                    onChange={(e) => setMetaTemplateName(e.target.value)}
                  />
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <select
                      className="w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px]"
                      value={metaTemplateCategory}
                      onChange={(e) => setMetaTemplateCategory(e.target.value as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION')}
                    >
                      <option value="MARKETING">MARKETING</option>
                      <option value="UTILITY">UTILITY</option>
                      <option value="AUTHENTICATION">AUTHENTICATION</option>
                    </select>
                    <input
                      className="w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px]"
                      placeholder="Idioma (pt_BR)"
                      value={metaTemplateLanguage}
                      onChange={(e) => setMetaTemplateLanguage(e.target.value)}
                    />
                  </div>
                  <textarea
                    className="w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px] min-h-[100px]"
                    placeholder="BODY (obrigatorio)"
                    value={metaTemplateBody}
                    onChange={(e) => setMetaTemplateBody(e.target.value)}
                  />
                  <input
                    className="w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px]"
                    placeholder="HEADER texto (opcional)"
                    value={metaTemplateHeader}
                    onChange={(e) => setMetaTemplateHeader(e.target.value)}
                  />
                  <input
                    className="w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px]"
                    placeholder="FOOTER texto (opcional)"
                    value={metaTemplateFooter}
                    onChange={(e) => setMetaTemplateFooter(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => void handleCreateMetaTemplate()}
                    disabled={metaActionLoading}
                    className="w-full px-4 py-2 rounded-[10px] bg-[#0EA5E9] text-white text-[13px] font-semibold hover:bg-[#0284C7] disabled:opacity-60"
                  >
                    {metaActionLoading ? 'Enviando...' : 'Criar template na Meta'}
                  </button>
                </div>
              </div>

              <div className="h-fit space-y-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[12px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[14px] font-semibold">Templates</h3>
                  <span className="text-[12px] text-[#6B7280]">
                    {filteredMetaTemplates.length} de {metaTemplates.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input
                    className="md:col-span-2 w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px]"
                    placeholder="Buscar por nome, categoria ou idioma"
                    value={metaSearch}
                    onChange={(e) => setMetaSearch(e.target.value)}
                  />
                  <select
                    className="w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px]"
                    value={metaStatusFilter}
                    onChange={(e) => setMetaStatusFilter(e.target.value)}
                  >
                    <option value="ALL">Todos os status</option>
                    {allMetaStatuses.map((status) => (
                      <option key={status} value={status}>
                        {statusLabel(status)}
                      </option>
                    ))}
                  </select>
                </div>
                <select
                  className="w-full md:w-[280px] border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px]"
                  value={metaCategoryFilter}
                  onChange={(e) => setMetaCategoryFilter(e.target.value)}
                >
                  <option value="ALL">Todas as categorias</option>
                  {allMetaCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </select>
                {metaTemplatesLoading ? (
                  <p className="text-[13px] text-[#6B7280]">Carregando templates...</p>
                ) : filteredMetaTemplates.length === 0 ? (
                  <p className="text-[13px] text-[#6B7280]">Nenhum template retornado pela Meta.</p>
                ) : (
                  <div className="overflow-auto border border-[#E5E7EB] rounded-[10px] bg-white max-h-[380px]">
                    <table className="w-full text-left">
                      <thead className="border-b border-[#E5E7EB] bg-[#F8FAFC]">
                        <tr className="text-[11px] uppercase tracking-wide text-[#6B7280]">
                          <th className="px-3 py-2">Nome</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Categoria</th>
                          <th className="px-3 py-2">Idioma</th>
                          <th className="px-3 py-2 text-right">Acoes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredMetaTemplates.map((tpl) => {
                          const status = normalizeMetaStatus(tpl.status);
                          const isLocalFallbackRow =
                            metaTemplatesSource === 'local_fallback' || tpl.source === 'local_fallback';
                          return (
                            <tr key={`${tpl.id ?? tpl.name}-${status}`} className="border-b border-[#F3F4F6] text-[12px]">
                              <td className="px-3 py-2 font-medium text-[#111827]">{tpl.name ?? '-'}</td>
                              <td className="px-3 py-2">
                                <span
                                  className={`px-2 py-1 rounded-full text-[10px] font-semibold ${
                                    isLocalFallbackRow ? 'bg-slate-200 text-slate-800' : statusBadgeClass(status)
                                  }`}
                                >
                                  {isLocalFallbackRow ? 'LOCAL' : statusLabel(status)}
                                </span>
                              </td>
                              <td className="px-3 py-2">{String(tpl.category ?? 'UNKNOWN').toUpperCase()}</td>
                              <td className="px-3 py-2">{tpl.language ?? '-'}</td>
                              <td className="px-3 py-2 text-right">
                                {tpl.name ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteMetaTemplate(tpl.name!)}
                                    disabled={metaActionLoading}
                                    className="px-2.5 py-1 rounded-[8px] border border-red-200 text-red-700 bg-red-50 hover:bg-red-100 disabled:opacity-60"
                                  >
                                    Excluir
                                  </button>
                                ) : null}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : (
          <>
            {templatesLoadError && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <p className="text-red-800 text-sm font-medium">{templatesLoadError}</p>
              </div>
            )}

            {!templatesLoading && !templatesLoadError && templates.length === 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
                <p className="text-amber-900 text-sm">Nenhum template foi encontrado para esta conta.</p>
              </div>
            )}

            {templatesSyncWarning && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
                <p className="text-amber-900 text-sm">{templatesSyncWarning}</p>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-4">
                <p className="text-red-800 text-sm">{error}</p>
              </div>
            )}

            {parseData && !selectedTemplateKey && (
              <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
                <p className="text-blue-900 text-sm">Selecione um template para configurar o mapeamento e gerar o preview.</p>
              </div>
            )}

            {templateNotApprovedMessage && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
                <p className="text-amber-900 text-sm">{templateNotApprovedMessage}</p>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="space-y-6">
                <TemplateSelector
                  templates={usableTemplates}
                  selectedKey={selectedTemplateKey}
                  onSelect={handleSelectedTemplateKeyChange}
                  loading={templatesLoading}
                  selectDisabled={!!templatesLoadError}
                />
                {!templatesLoading && !templatesLoadError && usableTemplates.length === 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                    <p className="text-amber-900 text-sm">
                      Nenhum template aprovado disponível para disparo. Acompanhe aprovações na aba Templates META.
                    </p>
                  </div>
                )}

                <SpreadsheetUploadPanel file={file} onFileChange={handleFileChange} onParse={handleParse} loading={loadingParse} />

                {parseData && (
                  <ColumnMappingPanel
                    spreadsheet={parseData.spreadsheet}
                    suggestions={parseData.suggestions}
                    template={selectedTemplate}
                    phoneColumn={phoneColumn}
                    onPhoneColumnChange={setPhoneColumn}
                    selectedEnterpriseId={selectedEnterpriseId}
                    onSelectedEnterpriseIdChange={setSelectedEnterpriseId}
                    selectedBrokerIds={selectedBrokerIds}
                    onSelectedBrokerIdsChange={setSelectedBrokerIds}
                    projects={projects}
                    brokers={brokers}
                    variableMappings={variableMappings}
                    onVariableMappingsChange={setVariableMappings}
                    onPreview={handlePreview}
                    loadingPreview={loadingPreview}
                    previewDisabledReason={actionBlockedReason}
                  />
                )}
              </div>

              <div className="space-y-6">
                <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-5 space-y-5">
                  <div>
                    <h2 className="text-[16px] font-semibold text-[#111827]">Validacao e envio</h2>
                    <p className="text-[13px] text-[#4B5563] mt-1">Revise os contatos, envie um teste e confirme o disparo final.</p>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-[14px] font-semibold text-[#111827]">1. Preview dos contatos</h3>
                    {preview ? (
                      <BatchPreviewTable
                        preview={preview}
                        onSelectTestRow={setTestRowNumber}
                        selectedTestRow={testRowNumber}
                        embedded
                      />
                    ) : (
                      <div className="rounded-[10px] border border-[#DBEAFE] bg-[#EFF6FF] px-3 py-3">
                        <p className="text-[13px] text-[#1E3A8A] font-medium">Gere o preview para validar os contatos antes do envio.</p>
                      </div>
                    )}
                  </div>

                  <div className="h-px bg-[#E5E7EB]" />

                  <div className="space-y-3">
                    <h3 className="text-[14px] font-semibold text-[#111827]">2. Envio de teste</h3>
                    {selectedTemplate && preview ? (
                      <TestSendPanel
                        template={selectedTemplate}
                        testPhone={testPhone}
                        onTestPhoneChange={setTestPhone}
                        testMode={testMode}
                        onTestModeChange={setTestMode}
                        testRowNumber={testRowNumber}
                        onTestRowNumberChange={setTestRowNumber}
                        availableTestRows={validPreviewRows.map((r) => r.rowNumber)}
                        manualTestVariables={manualTestVariables}
                        onManualTestVariablesChange={setManualTestVariables}
                        onTest={handleTest}
                        loadingTest={loadingTest}
                        testResult={testResult}
                        canUseRowMode={canUseRowMode}
                        selectedPreviewRow={selectedPreviewRow}
                        disableReason={actionBlockedReason}
                        embedded
                      />
                    ) : (
                      <div className="px-1 py-1">
                        <p className="text-[13px] text-[#6B7280]">Selecione um template e gere o preview para testar o envio.</p>
                      </div>
                    )}
                  </div>

                  <div className="h-px bg-[#E5E7EB]" />

                  <div className="space-y-4">
                    <h3 className="text-[14px] font-semibold text-[#111827]">3. Envio final</h3>
                    <p className="text-[13px] text-[#4B5563]">
                      Revise os dados antes de confirmar. Apenas contatos validos serao enviados.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 font-medium">Total: {preview?.total ?? 0}</span>
                      <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-medium">
                        Validos: {preview?.validCount ?? 0}
                      </span>
                      <span className="px-3 py-1 rounded-full bg-red-100 text-red-800 font-medium">
                        Invalidos/Bloqueados: {(preview?.invalidCount ?? 0) + (preview?.blockedCount ?? 0)}
                      </span>
                    </div>
                    <button
                      onClick={handleSend}
                      disabled={loadingSend || (preview?.validCount ?? 0) === 0 || !selectedTemplateKey || !!actionBlockedReason}
                      className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                      {loadingSend ? 'Enviando...' : `Enviar ${preview?.validCount ?? 0} mensagens`}
                    </button>
                    {sendResult && (
                      <div className="bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] p-4">
                        <p className="text-[12px] font-semibold text-[#334155] mb-2">Resultado do envio</p>
                        <pre className="text-xs text-gray-700 whitespace-pre-wrap">{sendResult}</pre>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


