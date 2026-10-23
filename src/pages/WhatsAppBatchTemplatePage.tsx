import { useEffect, useMemo, useRef, useState } from 'react';
import { useCallback } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { DispatchEventsSection } from '../components/DispatchEventsSection';
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
  BatchConversationType,
  BatchParseResponse,
  BatchPostSendMode,
  BatchPreviewResponse,
  BatchSendResponse,
  BatchSendResult,
  BatchSendMode,
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
    DELETED: 'Excluído',
    LOCAL: 'Local',
    UNKNOWN: 'Desconhecido',
  };
  return map[status] ?? `Outro: ${status}`;
}

function categoryLabel(category: string | null | undefined): string {
  const value = String(category ?? '').trim().toUpperCase();
  const map: Record<string, string> = {
    MARKETING: 'Marketing',
    UTILITY: 'Utilidade',
    AUTHENTICATION: 'Autenticação',
    CORRETOR: 'Corretor',
  };
  return map[value] ?? (value || 'Desconhecida');
}
function languageLabel(language: string | null | undefined): string {
  const value = String(language ?? '').trim();
  if (!value) return '-';
  if (value === 'pt_BR') return 'Português do Brasil (pt_BR)';
  if (value === 'en') return 'Inglês (en)';
  return value;
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

function extractBodyVariableIdsFromText(text: string): number[] {
  const ids = new Set<number>();
  const matches = text.matchAll(/\{\{(\d+)\}\}/g);
  for (const match of matches) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) ids.add(value);
  }
  return [...ids].sort((a, b) => a - b);
}

function defaultMetaTemplateExampleValue(variableId: number): string {
  if (variableId === 1) return 'João';
  if (variableId === 2) return 'Maria Silva';
  if (variableId === 3) return 'Residencial Évora';
  if (variableId === 4) return '25/05/2026';
  if (variableId === 5) return '10:00';
  return `Exemplo ${variableId}`;
}

type BatchSendOutcomeCard =
  | {
      kind: 'scheduled';
      batchId: number;
      status: string;
      total: number;
      validRecipients: number;
      invalidRecipients: number;
      scheduledAt: string;
    }
  | {
      kind: 'sent';
      total: number;
      success: number;
      failed: number;
      details: Array<{
        rowNumber: number;
        phoneOriginal: string | null;
        phoneNormalized: string | null;
        status: 'sent' | 'blocked' | 'error';
        error: string | null;
      }>;
    };

function isScheduledBatchSendResponse(
  response: BatchSendResponse,
): response is Extract<BatchSendResponse, { scheduled: true }> {
  return 'scheduled' in response && response.scheduled === true;
}

function isTemplateUsableForBatch(
  template: BatchTemplateCatalogItem,
  catalogSource: 'meta_sync' | 'local_fallback' | 'unknown',
): boolean {
  const status = normalizeMetaStatus(template.status);
  if (status === 'APPROVED') return true;
  if (template.source === 'local_fallback') return true;
  if (status === 'LOCAL') return true;
  if (catalogSource === 'local_fallback' && template.source !== 'meta') return true;
  return false;
}

export function WhatsAppBatchTemplatePage() {
  const { isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') === 'templates' ? 'templates' : 'batch';
  const metaTemplateView = searchParams.get('view') === 'list' ? 'list' : 'create';

  const setActiveTab = (tab: 'batch' | 'templates') => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (tab === 'templates') next.set('tab', 'templates');
      else {
        next.delete('tab');
        next.delete('view');
      }
      return next;
    });
  };
  const setMetaTemplateView = (view: 'create' | 'list') => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('tab', 'templates');
      if (view === 'list') next.set('view', 'list');
      else next.delete('view');
      return next;
    });
  };
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
  const [sendResult, setSendResult] = useState<BatchSendOutcomeCard | null>(null);
  const [conversationType, setConversationType] = useState<BatchConversationType>('CLIENT');
  const [postSendMode, setPostSendMode] = useState<BatchPostSendMode>('ANA');
  const [sendMode, setSendMode] = useState<BatchSendMode>('NOW');
  const [scheduledAtLocal, setScheduledAtLocal] = useState('');
  const [loadingParse, setLoadingParse] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [loadingTest, setLoadingTest] = useState(false);
  const [loadingSend, setLoadingSend] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [templatesLoading, setTemplatesLoading] = useState(true);
  const [templatesLoadError, setTemplatesLoadError] = useState<string | null>(null);
  const [templatesSyncWarning, setTemplatesSyncWarning] = useState<string | null>(null);
  const [templatesCatalogSource, setTemplatesCatalogSource] = useState<'meta_sync' | 'local_fallback' | 'unknown'>('unknown');
  const [headerImageFeedback, setHeaderImageFeedback] = useState<string | null>(null);
  const [headerImageUploading, setHeaderImageUploading] = useState(false);
  const [headerImageRemoving, setHeaderImageRemoving] = useState(false);

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
  const [metaTemplateBodyExamples, setMetaTemplateBodyExamples] = useState<Record<string, string>>({});
  const [metaTemplateHeader, setMetaTemplateHeader] = useState('');
  const [metaTemplateFooter, setMetaTemplateFooter] = useState('');
  const [metaSearch, setMetaSearch] = useState('');
  const [metaStatusFilter, setMetaStatusFilter] = useState('ALL');
  const [metaCategoryFilter, setMetaCategoryFilter] = useState('ALL');
  const metaTemplateBodyRef = useRef<HTMLTextAreaElement | null>(null);
  const headerImageFileInputRef = useRef<HTMLInputElement | null>(null);

  const loadBatchTemplates = async (opts?: { refresh?: boolean }) => {
    setTemplatesLoading(true);
    setTemplatesLoadError(null);
    setTemplatesSyncWarning(null);
    return whatsappBatchApi
      .listTemplates(opts)
      .then((r) => {
        setTemplates(r.templates ?? []);
        setTemplatesSyncWarning(r.warning ?? null);
        setTemplatesCatalogSource((r.source as 'meta_sync' | 'local_fallback' | undefined) ?? 'unknown');
      })
      .catch((err: unknown) => {
        setTemplates([]);
        const base = 'Não foi possível carregar a lista de templates.';
        if (err instanceof ApiError) {
          let msg = `${base} ${err.message}`;
          if (err.status != null) msg += ` (HTTP ${err.status})`;
          if (err.status === 401) msg += ' Faça login novamente (sessão inválida ou expirada).';
          if (err.status === 403) msg += ' A rota exige perfil ADMIN (integrações).';
          setTemplatesLoadError(msg);
        } else if (err instanceof Error) {
          setTemplatesLoadError(`${base} ${err.message}`);
        } else {
          setTemplatesLoadError(`${base} Verifique rede, VITE_API_URL e se o backend está no ar.`);
        }
      })
      .finally(() => setTemplatesLoading(false));
  };

  useEffect(() => {
    void loadBatchTemplates();

    void projectsApi
      .list(true)
      .then((d) => setProjects(d.projects.filter((p) => p.status === 'ativo')))
      .catch(() => setProjects([]));
    void corretoresApi.list().then((d) => setBrokers(d.corretores)).catch(() => setBrokers([]));
  }, []);

  const loadMetaTemplates = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    if (activeTab === 'templates') void loadMetaTemplates();
  }, [activeTab, loadMetaTemplates]);

  const handleEnterTemplatesTab = () => {
    setActiveTab('templates');
  };

  const handleShowMetaTemplates = async () => {
    setMetaTemplateView('list');
    if (metaTemplates.length === 0 && !metaTemplatesLoading) {
      await loadMetaTemplates();
    }
  };

  const handleCreateMetaTemplate = async () => {
    setMetaActionFeedback(null);
    if (!metaTemplateName.trim() || !metaTemplateBody.trim()) {
      setMetaActionFeedback('Nome do template e mensagem principal são obrigatórios.');
      return;
    }
    setMetaActionLoading(true);
    try {
      const bodyExamplesPayload =
        metaTemplateVariableIds.length > 0
          ? Object.fromEntries(
              metaTemplateVariableIds.map((id) => {
                const key = String(id);
                const value = metaTemplateBodyExamples[key]?.trim() || defaultMetaTemplateExampleValue(id);
                return [key, value];
              }),
            )
          : undefined;
      await whatsappApi.createTemplate({
        name: metaTemplateName.trim(),
        category: metaTemplateCategory,
        language: metaTemplateLanguage.trim() || 'pt_BR',
        body: metaTemplateBody.trim(),
        headerText: metaTemplateHeader.trim() || undefined,
        footerText: metaTemplateFooter.trim() || undefined,
        bodyExamples: bodyExamplesPayload,
      });
      setMetaActionFeedback('Solicitação enviada para a Meta. Acompanhe o status na lista de templates.');
      setMetaTemplateView('list');
      setMetaTemplateName('');
      setMetaTemplateBody('');
      setMetaTemplateBodyExamples({});
      setMetaTemplateHeader('');
      setMetaTemplateFooter('');
      await loadMetaTemplates();
    } catch (e) {
      setMetaActionFeedback(e instanceof Error ? e.message : 'Erro ao solicitar criação do template na Meta.');
    } finally {
      setMetaActionLoading(false);
    }
  };

  const handleDeleteMetaTemplate = async (name: string) => {
    const confirmed = window.confirm(`Confirma a exclusão do template "${name}" na Meta?`);
    if (!confirmed) return;
    setMetaActionLoading(true);
    setMetaActionFeedback(null);
    try {
      await whatsappApi.deleteTemplate(name);
      setMetaActionFeedback('Template excluído com sucesso.');
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
      await loadBatchTemplates({ refresh: true });
      setMetaActionFeedback('Templates sincronizados com sucesso.');
    } catch (e) {
      setMetaActionFeedback(e instanceof Error ? e.message : 'Erro ao sincronizar templates.');
    } finally {
      setMetaActionLoading(false);
    }
  };

  const selectedTemplate = templates.find((tpl) => tpl.key === selectedTemplateKey) ?? null;
  const usableTemplates = templates.filter((tpl) => isTemplateUsableForBatch(tpl, templatesCatalogSource));
  const selectedTemplateUsable = selectedTemplate
    ? isTemplateUsableForBatch(selectedTemplate, templatesCatalogSource)
    : false;
  const templateNotApprovedMessage =
    selectedTemplate && !selectedTemplateUsable
      ? 'Este template ainda não está aprovado na Meta. Ele pode ser visualizado, mas não pode ser usado para disparo.'
      : null;
  const headerMediaMissing =
    !!selectedTemplate?.requiresHeaderMedia &&
    !(selectedTemplate?.hasConfiguredHeaderMedia || selectedTemplate?.headerMediaId || selectedTemplate?.headerImageUrl);
  const headerMediaMissingMessage = headerMediaMissing
    ? 'Este template exige imagem de cabeçalho. Anexe uma imagem antes de enviar.'
    : null;
  const actionBlockedReason = templateNotApprovedMessage ?? headerMediaMissingMessage;

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

  const metaTemplateVariableIds = useMemo(() => extractBodyVariableIdsFromText(metaTemplateBody), [metaTemplateBody]);

  useEffect(() => {
    setMetaTemplateBodyExamples((prev) => {
      if (metaTemplateVariableIds.length === 0) return {};
      const next: Record<string, string> = {};
      for (const id of metaTemplateVariableIds) {
        const key = String(id);
        const previousValue = typeof prev[key] === 'string' ? prev[key].trim() : '';
        next[key] = previousValue.length > 0 ? prev[key]! : defaultMetaTemplateExampleValue(id);
      }
      return next;
    });
  }, [metaTemplateVariableIds]);

  const previewMessage = useMemo(() => {
    if (!metaTemplateBody.trim()) return '';
    let preview = metaTemplateBody;
    for (const id of metaTemplateVariableIds) {
      const token = new RegExp(`\\{\\{${id}\\}\\}`, 'g');
      const value = metaTemplateBodyExamples[String(id)]?.trim() || defaultMetaTemplateExampleValue(id);
      preview = preview.replace(token, value);
    }
    return preview;
  }, [metaTemplateBody, metaTemplateBodyExamples, metaTemplateVariableIds]);

  const variableValidation = useMemo(() => {
    const text = metaTemplateBody;
    const validMatches = Array.from(text.matchAll(/\{\{(\d+)\}\}/g));
    const usedNumbers = validMatches
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value) && value > 0);
    const uniqueNumbers = Array.from(new Set(usedNumbers)).sort((a, b) => a - b);
    const hasSequenceGap = uniqueNumbers.some((value, index) => value !== index + 1);
    const hasInvalidFormat =
      /\{[^{}]*\}/.test(text.replace(/\{\{\d+\}\}/g, '')) ||
      /{{\s*\d+\s*}}/.test(text) ||
      /{{[^}]*[a-zA-Z][^}]*}}/.test(text);

    return { hasSequenceGap, hasInvalidFormat };
  }, [metaTemplateBody]);

  const insertVariableIntoBody = (variableToken: string) => {
    const textarea = metaTemplateBodyRef.current;
    if (!textarea) {
      const separator = metaTemplateBody && !metaTemplateBody.endsWith(' ') ? ' ' : '';
      setMetaTemplateBody(`${metaTemplateBody}${separator}${variableToken}`.trim());
      return;
    }

    const start = textarea.selectionStart ?? metaTemplateBody.length;
    const end = textarea.selectionEnd ?? metaTemplateBody.length;
    const before = metaTemplateBody.slice(0, start);
    const after = metaTemplateBody.slice(end);
    const needsLeadingSpace = before.length > 0 && !before.endsWith(' ') && !before.endsWith('\n');
    const needsTrailingSpace = after.length > 0 && !after.startsWith(' ') && !after.startsWith('\n');
    const insertText = `${needsLeadingSpace ? ' ' : ''}${variableToken}${needsTrailingSpace ? ' ' : ''}`;
    const nextValue = `${before}${insertText}${after}`;
    setMetaTemplateBody(nextValue);

    window.requestAnimationFrame(() => {
      textarea.focus();
      const nextCursor = before.length + insertText.length;
      textarea.setSelectionRange(nextCursor, nextCursor);
    });
  };

  const validPreviewRows = (preview?.rows ?? []).filter((row) => row.status === 'valid');
  const canUseRowMode = validPreviewRows.length > 0;
  const selectedPreviewRow =
    testRowNumber == null ? null : validPreviewRows.find((row) => row.rowNumber === testRowNumber) ?? null;
  const scheduledAtDate = useMemo(() => {
    if (!scheduledAtLocal.trim()) return null;
    const parsed = new Date(scheduledAtLocal);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }, [scheduledAtLocal]);
  const scheduleValidationError = useMemo(() => {
    if (sendMode !== 'SCHEDULED') return null;
    if (!scheduledAtLocal.trim()) return 'Informe a data e hora para agendar o disparo.';
    if (!scheduledAtDate) return 'Data/hora inválida para agendamento.';
    if (scheduledAtDate.getTime() <= Date.now()) return 'A data/hora do agendamento deve ser futura.';
    return null;
  }, [scheduledAtDate, scheduledAtLocal, sendMode]);
  const destinationLabel = conversationType === 'ADMIN' ? 'Interno' : 'Clientes';
  const postSendModeLabel = postSendMode === 'HANDOFF' ? 'Handoff / atendimento humano' : 'Atendimento da Ana';
  const sendModeLabel =
    sendMode === 'SCHEDULED' && scheduledAtDate
      ? `Agendado para ${scheduledAtDate.toLocaleString('pt-BR')}`
      : 'Enviar agora';

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
    setHeaderImageFeedback(null);

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
    if (scheduleValidationError) {
      setError(scheduleValidationError);
      return;
    }
    setLoadingSend(true);
    setError(null);
    setSendResult(null);
    try {
      const mapping = buildMappingPayload();
      const scheduledAtIso =
        sendMode === 'SCHEDULED' && scheduledAtDate ? scheduledAtDate.toISOString() : undefined;
      const result: BatchSendResponse =
        sendMode === 'SCHEDULED'
          ? await whatsappBatchApi.scheduleBatch(parseData!.spreadsheet, mapping, {
              conversationType,
              postSendMode,
              sendMode: 'SCHEDULED',
              scheduledAt: scheduledAtIso,
            })
          : await whatsappBatchApi.sendBatch(parseData!.spreadsheet, mapping, {
              conversationType,
              postSendMode,
              sendMode: 'NOW',
            });

      if (isScheduledBatchSendResponse(result)) {
        setSendResult({
          kind: 'scheduled',
          batchId: result.batchId,
          status: result.status,
          total: result.total,
          validRecipients: result.validRecipients,
          invalidRecipients: result.invalidRecipients,
          scheduledAt: result.scheduledAt,
        });
      } else {
        const immediateResult: BatchSendResult = result;
        setSendResult({
          kind: 'sent',
          total: immediateResult.total,
          success: immediateResult.success,
          failed: immediateResult.failed,
          details: immediateResult.details.map((detail) => ({
            rowNumber: detail.rowNumber,
            phoneOriginal: detail.phoneOriginal,
            phoneNormalized: detail.phoneNormalized,
            status: detail.status,
            error: detail.error,
          })),
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao enviar mensagens.');
    } finally {
      setLoadingSend(false);
    }
  };

  const handleUploadHeaderImage = async (fileToUpload: File) => {
    if (!selectedTemplate) return;
    setHeaderImageUploading(true);
    setHeaderImageFeedback(null);
    try {
      const form = new FormData();
      form.append('file', fileToUpload);
      form.append('language', selectedTemplate.languageCode || 'pt_BR');
      await whatsappBatchApi.uploadTemplateHeaderImage(selectedTemplate.key, form);
      setHeaderImageFeedback('Mídia anexada com sucesso.');
      await loadBatchTemplates({ refresh: true });
    } catch (e) {
      setHeaderImageFeedback(e instanceof Error ? e.message : 'Erro ao anexar mídia.');
    } finally {
      setHeaderImageUploading(false);
      if (headerImageFileInputRef.current) headerImageFileInputRef.current.value = '';
    }
  };

  const handleRemoveHeaderImage = async () => {
    if (!selectedTemplate) return;
    setHeaderImageRemoving(true);
    setHeaderImageFeedback(null);
    try {
      await whatsappBatchApi.deleteTemplateHeaderImage(selectedTemplate.key, selectedTemplate.languageCode || 'pt_BR');
      setHeaderImageFeedback('Mídia removida com sucesso.');
      await loadBatchTemplates({ refresh: true });
    } catch (e) {
      setHeaderImageFeedback(e instanceof Error ? e.message : 'Erro ao remover mídia.');
    } finally {
      setHeaderImageRemoving(false);
    }
  };

  if (!isAdmin) return <Navigate to="/inbox" replace />;

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-[#111827]">
      <nav className="h-14 border-b border-[#E5E7EB] bg-white/90 backdrop-blur-sm sticky top-0 z-20 px-6 flex items-center justify-between">
        <span className="text-[18px] font-extrabold uppercase tracking-wide">Disparo em Lote</span>
        <AppNav />
      </nav>

      <div className="w-full max-w-none px-6 lg:px-8 py-6 space-y-5">
        <div>
          <p className="text-[16px] italic leading-relaxed text-[#475569]">
            Envie templates do WhatsApp em lote a partir de uma planilha: faça o upload, escolha o template, mapeie colunas e envie.
          </p>
        </div>

        <div className="relative grid w-full max-w-[520px] grid-cols-2 gap-2 rounded-[12px] border-2 border-[#F97316] bg-[#FFF1E8] p-2">
          <button
            type="button"
            onClick={() => setActiveTab('batch')}
            className={`inline-flex min-h-[42px] items-center justify-center gap-2 rounded-[8px] px-2 py-2 text-[11px] font-extrabold uppercase tracking-wide transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C2410C] sm:px-5 sm:text-[13px] ${
              activeTab === 'batch' ? 'bg-white text-[#C2410C] shadow-sm' : 'text-[#9A3412] hover:bg-white/70'
            }`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
              className="h-4 w-4 shrink-0" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="3" width="16" height="18" rx="2" />
              <path d="M8 8h8M8 12h8M8 16h5" />
            </svg>
            <span>DISPARO EM LOTE</span>
          </button>
          <button
            type="button"
            onClick={() => void handleEnterTemplatesTab()}
            className={`inline-flex min-h-[42px] items-center justify-center gap-2 rounded-[8px] px-2 py-2 text-[11px] font-extrabold uppercase tracking-wide transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#C2410C] sm:px-5 sm:text-[13px] ${
              activeTab === 'templates' ? 'bg-white text-[#C2410C] shadow-sm' : 'text-[#9A3412] hover:bg-white/70'
            }`}
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
              className="h-4 w-4 shrink-0" stroke="currentColor" strokeWidth="2"
              strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
              <path d="M14 2v6h6M8 13h8M8 17h8" />
            </svg>
            <span>TEMPLATES META</span>
          </button>
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-3 left-1/2 top-3 w-px -translate-x-1/2 bg-[#FDBA74]"
          />
        </div>

        <DispatchEventsSection showEvents={false} />

        {activeTab === 'templates' ? (
          <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-5 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-[20px] font-bold text-[#123A73]">Templates do WhatsApp</h2>
                <p className="text-[13px] text-[#4B5563] mt-1">
                  Crie um modelo e acompanhe a aprovação. Criar um modelo não envia mensagens.
                </p>
              </div>
              {metaTemplateView === 'list' && (
                <button
                  type="button"
                  onClick={() => void handleSyncMetaTemplates()}
                  disabled={metaActionLoading || metaTemplatesLoading}
                  className="px-3 py-2 rounded-[10px] border border-[#BFDBFE] text-[#1D4ED8] bg-[#EFF6FF] hover:bg-[#DBEAFE] disabled:opacity-60"
                >
                  {metaActionLoading ? 'Atualizando...' : 'Atualizar lista'}
                </button>
              )}
            </div>

            {metaTemplatesError && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 text-sm text-red-800">{metaTemplatesError}</div>
            )}
            {metaActionFeedback && (
              <div className="bg-slate-50 border border-slate-200 rounded-md p-3 text-sm text-slate-700">{metaActionFeedback}</div>
            )}

            <div role="tablist" aria-label="Área de templates Meta" className="grid grid-cols-2 gap-2 rounded-[8px] border border-[#BFDBFE] bg-[#EFF6FF] p-1">
              <button
                type="button"
                onClick={() => setMetaTemplateView('create')}
                role="tab"
                aria-selected={metaTemplateView === 'create'}
                aria-controls="meta-template-create-panel"
                aria-pressed={metaTemplateView === 'create'}
                className={`rounded-[6px] px-3 py-2 text-sm font-semibold transition-colors ${
                  metaTemplateView === 'create'
                    ? 'bg-white text-[#123A73] shadow-sm'
                    : 'text-[#475569] hover:bg-white/70'
                }`}
              >
                1. Criar novo modelo
              </button>
              <button
                type="button"
                onClick={() => void handleShowMetaTemplates()}
                role="tab"
                aria-selected={metaTemplateView === 'list'}
                aria-controls="meta-template-list-panel"
                aria-pressed={metaTemplateView === 'list'}
                className={`rounded-[6px] px-3 py-2 text-sm font-semibold transition-colors ${
                  metaTemplateView === 'list'
                    ? 'bg-white text-[#123A73] shadow-sm'
                    : 'text-[#475569] hover:bg-white/70'
                }`}
              >
                2. Meus modelos e status
              </button>
            </div>

            <div className="space-y-4">
              {metaTemplateView === 'create' && (
              <div id="meta-template-create-panel" role="tabpanel" aria-label="Criar novo modelo" className="space-y-4">
                <section className="space-y-4 rounded-[6px] border border-[#F97316] bg-white p-4">
                  <header className="flex items-start gap-3 border-b border-[#E2E8F0] pb-3">
                    <span className="rounded-[4px] bg-[#FFF1E8] px-2 py-1 text-xs font-bold text-[#C2410C]">01</span>
                    <div>
                      <h3 className="text-base font-bold text-[#123A73]">Identifique o modelo</h3>
                      <p className="mt-0.5 text-xs text-[#64748B]">Escolha um nome, a finalidade e o idioma.</p>
                    </div>
                  </header>
                  <div className="grid grid-cols-1 gap-3">
                  <div>
                    <label className="block text-[12px] text-[#374151] mb-1">Nome interno do modelo</label>
                    <input
                      className="w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px]"
                      placeholder="Ex: convite_evento_maio"
                      value={metaTemplateName}
                      onChange={(e) => setMetaTemplateName(e.target.value)}
                    />
                    <p className="text-[11px] text-[#6B7280] mt-1">
                      Este nome identifica o modelo na Meta. Use letras minúsculas, números e underline (_).
                    </p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[12px] text-[#374151] mb-1">Finalidade da mensagem</label>
                      <select
                        className="w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px]"
                        value={metaTemplateCategory}
                        onChange={(e) => setMetaTemplateCategory(e.target.value as 'MARKETING' | 'UTILITY' | 'AUTHENTICATION')}
                      >
                        <option value="MARKETING">Marketing</option>
                        <option value="UTILITY">Utilidade</option>
                        <option value="AUTHENTICATION">Autenticação</option>
                      </select>
                      <p className="text-[11px] text-[#6B7280] mt-1">
                        {metaTemplateCategory === 'MARKETING'
                          ? 'Para convites, campanhas e divulgações.'
                          : metaTemplateCategory === 'UTILITY'
                            ? 'Para avisos ligados a uma solicitação ou transação existente, sem promoção.'
                            : 'Para códigos de verificação em fluxos de autenticação.'}
                      </p>
                    </div>
                    <div>
                      <label className="block text-[12px] text-[#374151] mb-1">Idioma da mensagem</label>
                      <input
                        className="w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px]"
                        placeholder="Português do Brasil (pt_BR)"
                        value={metaTemplateLanguage}
                        onChange={(e) => setMetaTemplateLanguage(e.target.value)}
                      />
                      <p className="text-[11px] text-[#6B7280] mt-1">
                        Padrão recomendado: Português do Brasil (pt_BR). Mantenha esse valor se estiver em dúvida.
                      </p>
                    </div>
                  </div>
                  </div>
                </section>

                <section className="space-y-4 rounded-[6px] border border-emerald-600 bg-white p-4">
                  <header className="flex items-start gap-3 border-b border-[#E2E8F0] pb-3">
                    <span className="rounded-[4px] bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">02</span>
                    <div>
                      <h3 className="text-base font-bold text-emerald-700">Escreva a mensagem</h3>
                      <p className="mt-0.5 text-xs text-[#64748B]">Adicione a mensagem e os dados que mudam para cada lead.</p>
                    </div>
                  </header>
                  <div className="rounded-[6px] border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-xs text-[#1E3A8A]">
                    Este formulário cria cabeçalho de texto. Para um cabeçalho com imagem, use o WhatsApp Manager da Meta.
                  </div>
                  <div className="space-y-3">
                  <div>
                    <label className="block text-[12px] font-semibold text-[#374151] mb-1">Mensagem principal</label>
                    <textarea
                      ref={metaTemplateBodyRef}
                      className="w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px] min-h-[100px]"
                      placeholder="Exemplo: Olá, quero convidar você para conhecer nosso empreendimento."
                      value={metaTemplateBody}
                      onChange={(e) => setMetaTemplateBody(e.target.value)}
                    />
                    <p className="text-[11px] text-[#6B7280] mt-1">
                      Escreva a mensagem como se estivesse falando com uma pessoa. Use os botões abaixo para inserir dados variáveis.
                    </p>
                    <div className="mt-2 rounded-[10px] border border-[#DBEAFE] bg-[#EFF6FF] px-3 py-2">
                      <p className="text-[11px] font-semibold text-[#1E3A8A]">Exemplo:</p>
                      <p className="text-[12px] text-[#1E3A8A] mt-1">Olá {`{{1}}`}, temos um convite especial para você conhecer o {`{{2}}`}.</p>
                      <p className="text-[11px] text-[#1D4ED8] mt-2">Neste exemplo:</p>
                      <p className="text-[11px] text-[#1D4ED8]">{`{{1}}`} pode ser a coluna Nome</p>
                      <p className="text-[11px] text-[#1D4ED8]">{`{{2}}`} pode ser a coluna Empreendimento</p>
                    </div>
                    <p className="mt-3 text-[11px] text-[#64748B]">
                      Clique nos dados na ordem, começando pelo número 1. O número indica a posição da informação.
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => insertVariableIntoBody('{{1}}')}
                        className="px-2.5 py-1 rounded-[8px] border border-[#BFDBFE] bg-white text-[#1E40AF] text-[11px] font-medium hover:bg-[#EFF6FF]"
                      >
                        + 1: Nome do lead
                      </button>
                      <button
                        type="button"
                        onClick={() => insertVariableIntoBody('{{2}}')}
                        className="px-2.5 py-1 rounded-[8px] border border-[#BFDBFE] bg-white text-[#1E40AF] text-[11px] font-medium hover:bg-[#EFF6FF]"
                      >
                        + 2: Empreendimento
                      </button>
                      <button
                        type="button"
                        onClick={() => insertVariableIntoBody('{{3}}')}
                        className="px-2.5 py-1 rounded-[8px] border border-[#BFDBFE] bg-white text-[#1E40AF] text-[11px] font-medium hover:bg-[#EFF6FF]"
                      >
                        + 3: Nome do corretor
                      </button>
                    </div>
                    {(variableValidation.hasSequenceGap || variableValidation.hasInvalidFormat) && (
                      <div className="mt-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 space-y-1">
                        {variableValidation.hasSequenceGap && (
                          <p className="text-[11px] text-amber-800">
                            As variáveis devem seguir a ordem {`{{1}}`}, {`{{2}}`}, {`{{3}}`} sem pular números.
                          </p>
                        )}
                        {variableValidation.hasInvalidFormat && (
                          <p className="text-[11px] text-amber-800">
                            Use variáveis no formato {`{{1}}`}, {`{{2}}`}, {`{{3}}`}. Evite nomes ou espaços dentro das chaves.
                          </p>
                        )}
                      </div>
                    )}
                    {metaTemplateVariableIds.length > 0 && (
                      <div className="mt-2 rounded-[10px] border border-[#E5E7EB] bg-white px-3 py-3 space-y-2">
                        <p className="text-[12px] font-semibold text-[#111827]">
                          Exemplos para aprovação da Meta
                        </p>
                        <p className="text-[11px] text-[#6B7280]">
                          A Meta usa estes exemplos para entender como cada variável será preenchida. Use dados fictícios.
                        </p>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                          {metaTemplateVariableIds.map((id) => {
                            const key = String(id);
                            return (
                              <label key={key} className="space-y-1">
                                <span className="block text-[11px] text-[#374151]">
                                  Exemplo para o espaço {id}
                                </span>
                                <input
                                  className="w-full border border-[#E5E7EB] rounded-[8px] px-2.5 py-1.5 text-[12px]"
                                  value={metaTemplateBodyExamples[key] ?? ''}
                                  onChange={(e) =>
                                    setMetaTemplateBodyExamples((prev) => ({
                                      ...prev,
                                      [key]: e.target.value,
                                    }))
                                  }
                                  placeholder={defaultMetaTemplateExampleValue(id)}
                                />
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    <div className="mt-2 rounded-[10px] border border-[#E5E7EB] bg-white px-3 py-2">
                      <p className="text-[11px] font-semibold text-[#374151]">Prévia de exemplo</p>
                      <p className="text-[12px] text-[#4B5563] mt-1">
                        {previewMessage || 'A prévia aparecerá aqui conforme você escrever a mensagem.'}
                      </p>
                    </div>
                  </div>
                  <details className="rounded-[6px] border border-[#BFDBFE] bg-[#F8FBFF] px-3 py-3">
                    <summary className="cursor-pointer text-sm font-semibold text-[#123A73]">
                      Como funcionam as variáveis?
                    </summary>
                    <div className="mt-3 space-y-2 text-[12px] text-[#4B5563]">
                      <p>Variáveis são espaços preenchidos com dados da planilha no momento do disparo.</p>
                      <p>Exemplo: Olá {`{{1}}`}, conheça o empreendimento {`{{2}}`}.</p>
                      <p>{`{{1}}`} pode receber o nome do lead; {`{{2}}`} pode receber o empreendimento.</p>
                      <ul className="list-disc space-y-1 pl-5">
                        <li>Use números em sequência, sem pular nenhum.</li>
                        <li>No disparo em lote, cada variável será ligada a uma coluna da planilha.</li>
                        <li>Use exemplos fictícios para a análise da Meta.</li>
                      </ul>
                    </div>
                  </details>
                    <details className="rounded-[6px] border border-[#E2E8F0] bg-white px-3 py-3">
                      <summary className="cursor-pointer text-sm font-semibold text-[#374151]">
                        Personalizar apresentação (opcional)
                      </summary>
                      <div className="mt-3 space-y-3">
                        <label className="block text-[12px] text-[#374151]">
                          Título da mensagem <span className="text-[#6B7280]">(opcional, somente texto)</span>
                          <input
                            className="mt-1 w-full border border-[#E5E7EB] rounded-[8px] px-3 py-2 text-[13px]"
                            placeholder="Exemplo: Convite especial"
                            value={metaTemplateHeader}
                            onChange={(e) => setMetaTemplateHeader(e.target.value)}
                          />
                        </label>
                        <label className="block text-[12px] text-[#374151]">
                          Texto final <span className="text-[#6B7280]">(opcional)</span>
                          <input
                            className="mt-1 w-full border border-[#E5E7EB] rounded-[8px] px-3 py-2 text-[13px]"
                            placeholder="Exemplo: Equipe Quero Meu Apê"
                            value={metaTemplateFooter}
                            onChange={(e) => setMetaTemplateFooter(e.target.value)}
                          />
                        </label>
                        <p className="text-xs text-[#64748B]">
                          Este formulário aceita cabeçalho de texto. Para usar imagem no cabeçalho, crie o modelo no WhatsApp Manager da Meta.
                        </p>
                      </div>
                    </details>
                  </div>
                </section>

                <details className="rounded-[6px] border-2 border-[#3B82F6] bg-[#EFF6FF] p-3 text-sm text-[#123A73]">
                  <summary className="cursor-pointer font-semibold">Preciso de ajuda para criar o modelo</summary>
                  <ol className="list-decimal space-y-2 pl-5 pt-3">
                    <li>Escolha o nome, a finalidade e o idioma no bloco 01.</li>
                    <li>Escreva a mensagem no bloco 02. Use os botões para inserir Nome, Empreendimento ou Corretor.</li>
                    <li>Confira a prévia e preencha um exemplo fictício para cada variável.</li>
                    <li>Envie para análise e aguarde a aprovação da Meta. Acompanhe o resultado em “Meus modelos e status”.</li>
                  </ol>
                  <p className="mt-3 text-xs">
                    Criar ou aprovar um modelo não envia mensagens.
                  </p>
                </details>

                <button
                  type="button"
                  onClick={() => void handleCreateMetaTemplate()}
                  disabled={metaActionLoading}
                  className="mx-auto flex w-full items-center justify-center gap-2 rounded-[8px] border-[3px] border-[#F97316] bg-white px-5 py-3 text-sm font-extrabold text-[#F97316] shadow-[0_3px_12px_rgba(249,115,22,0.16)] transition-colors hover:bg-[#FFF7ED] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F97316] disabled:opacity-60 sm:w-fit sm:min-w-[280px]"
                >
                  <svg aria-hidden="true" viewBox="0 0 24 24" fill="none"
                    className="h-[18px] w-[18px]" stroke="currentColor" strokeWidth="2"
                    strokeLinecap="round" strokeLinejoin="round">
                    <path d="m22 2-7 20-4-9-9-4Z" />
                    <path d="M22 2 11 13" />
                  </svg>
                  {metaActionLoading ? 'Enviando para análise...' : 'Enviar modelo para aprovação'}
                </button>
                <p className="text-center text-xs text-[#64748B]">
                  A solicitação não dispara mensagens. Acompanhe o status na Meta.
                </p>
              </div>
              )}

              {metaTemplateView === 'list' && (
              <div id="meta-template-list-panel" role="tabpanel" aria-label="Meus modelos e status" className="h-fit space-y-3 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[12px] p-4">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-[14px] font-semibold">Meus modelos e status</h3>
                  <span className="text-[12px] text-[#6B7280]">
                    {filteredMetaTemplates.length} de {metaTemplates.length}
                  </span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                  <input
                    className="md:col-span-2 w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px]"
                    placeholder="Buscar por nome, tipo de mensagem ou idioma"
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
                      {categoryLabel(category)}
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
                          <th className="px-3 py-2 text-right">Ações</th>
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
                                  {isLocalFallbackRow ? statusLabel('LOCAL') : statusLabel(status)}
                                </span>
                              </td>
                              <td className="px-3 py-2">{categoryLabel(tpl.category)}</td>
                              <td className="px-3 py-2">{languageLabel(tpl.language)}</td>
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
              )}
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
            {headerMediaMissingMessage && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
                <p className="text-amber-900 text-sm">{headerMediaMissingMessage}</p>
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
                {selectedTemplate?.requiresHeaderMedia && (
                  <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3">
                    <div className="flex items-center gap-2">
                      {selectedTemplate.hasConfiguredHeaderMedia || selectedTemplate.headerMediaId || selectedTemplate.headerImageUrl ? (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-100 text-emerald-800">
                          Mídia anexada
                        </span>
                      ) : (
                        <span className="px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-100 text-amber-800">
                          Requer mídia
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="text-[12px] font-medium text-[#374151] mb-2">Mídia do cabeçalho</p>
                      {selectedTemplate.headerMediaFilename ? (
                        <p className="text-[12px] text-[#4B5563] mb-2">Mídia atual: {selectedTemplate.headerMediaFilename}</p>
                      ) : null}
                      <input
                        ref={headerImageFileInputRef}
                        type="file"
                        accept={selectedTemplate.hasHeaderVideo
                          ? 'video/mp4,video/3gpp,.mp4,.3gp'
                          : selectedTemplate.hasHeaderDocument
                            ? '.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,application/pdf'
                            : '.png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp'}
                        className="hidden"
                        onChange={(e) => {
                          const nextFile = e.target.files?.[0];
                          if (nextFile) void handleUploadHeaderImage(nextFile);
                        }}
                      />
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => headerImageFileInputRef.current?.click()}
                          disabled={headerImageUploading || headerImageRemoving}
                          className="px-4 py-2 rounded-[10px] bg-[#0EA5E9] text-white text-[13px] font-semibold hover:bg-[#0284C7] disabled:opacity-60"
                        >
                          {headerImageUploading
                            ? 'Enviando mídia...'
                            : selectedTemplate.headerMediaFilename
                              ? 'Substituir mídia'
                              : 'Anexar mídia'}
                        </button>
                        {(selectedTemplate.headerMediaId || selectedTemplate.headerImageUrl) && (
                          <button
                            type="button"
                            onClick={() => void handleRemoveHeaderImage()}
                            disabled={headerImageUploading || headerImageRemoving}
                            className="px-4 py-2 rounded-[10px] border border-red-200 text-red-700 bg-red-50 text-[13px] font-semibold hover:bg-red-100 disabled:opacity-60"
                          >
                            {headerImageRemoving ? 'Removendo...' : 'Remover mídia'}
                          </button>
                        )}
                      </div>
                      {headerImageFeedback ? <p className="text-[12px] text-[#065F46] mt-2">{headerImageFeedback}</p> : null}
                    </div>
                  </section>
                )}
                {!templatesLoading && !templatesLoadError && usableTemplates.length === 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
                    <p className="text-amber-900 text-sm">
                      Nenhum template aprovado disponível para disparo. Verifique o status na aba Templates META.
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
                    <h2 className="text-[16px] font-semibold text-[#111827]">Validação e envio</h2>
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
                      Revise os dados antes de confirmar. Apenas contatos válidos serão enviados.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="px-3 py-1 rounded-full bg-slate-100 text-slate-700 font-medium">Total: {preview?.total ?? 0}</span>
                      <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-800 font-medium">
                        Válidos: {preview?.validCount ?? 0}
                      </span>
                      <span className="px-3 py-1 rounded-full bg-red-100 text-red-800 font-medium">
                        Inválidos/Bloqueados: {(preview?.invalidCount ?? 0) + (preview?.blockedCount ?? 0)}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="space-y-1">
                        <span className="block text-[12px] font-medium text-[#374151]">Destino das conversas</span>
                        <select
                          value={conversationType}
                          onChange={(e) => setConversationType(e.target.value === 'ADMIN' ? 'ADMIN' : 'CLIENT')}
                          className="w-full border border-[#D1D5DB] rounded-[10px] px-3 py-2 text-[13px] bg-white"
                        >
                          <option value="CLIENT">Clientes</option>
                          <option value="ADMIN">Interno</option>
                        </select>
                      </label>
                      <label className="space-y-1">
                        <span className="block text-[12px] font-medium text-[#374151]">Atendimento após o disparo</span>
                        <select
                          value={postSendMode}
                          onChange={(e) => setPostSendMode(e.target.value === 'HANDOFF' ? 'HANDOFF' : 'ANA')}
                          className="w-full border border-[#D1D5DB] rounded-[10px] px-3 py-2 text-[13px] bg-white"
                        >
                          <option value="ANA">Ana atende automaticamente</option>
                          <option value="HANDOFF">Handoff / atendimento humano</option>
                        </select>
                      </label>
                    </div>
                    <div className="space-y-2">
                      <span className="block text-[12px] font-medium text-[#374151]">Envio</span>
                      <div className="flex flex-wrap gap-4 text-[13px] text-[#111827]">
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name="batch-send-mode"
                            checked={sendMode === 'NOW'}
                            onChange={() => setSendMode('NOW')}
                          />
                          <span>Enviar agora</span>
                        </label>
                        <label className="inline-flex items-center gap-2">
                          <input
                            type="radio"
                            name="batch-send-mode"
                            checked={sendMode === 'SCHEDULED'}
                            onChange={() => setSendMode('SCHEDULED')}
                          />
                          <span>Agendar envio</span>
                        </label>
                      </div>
                      {sendMode === 'SCHEDULED' && (
                        <div className="space-y-1">
                          <input
                            type="datetime-local"
                            value={scheduledAtLocal}
                            onChange={(e) => setScheduledAtLocal(e.target.value)}
                            className="w-full md:w-[320px] border border-[#D1D5DB] rounded-[10px] px-3 py-2 text-[13px] bg-white"
                          />
                          {scheduleValidationError && (
                            <p className="text-[12px] text-red-700">{scheduleValidationError}</p>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="rounded-[10px] border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-3 text-[12px] text-[#334155] space-y-1">
                      <p><strong>Destino:</strong> {destinationLabel}</p>
                      <p><strong>Atendimento:</strong> {postSendModeLabel}</p>
                      <p><strong>Envio:</strong> {sendModeLabel}</p>
                    </div>
                    <button
                      onClick={handleSend}
                      disabled={
                        loadingSend ||
                        (preview?.validCount ?? 0) === 0 ||
                        !selectedTemplateKey ||
                        !!actionBlockedReason ||
                        !!scheduleValidationError
                      }
                      className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                    >
                      {loadingSend
                        ? (sendMode === 'SCHEDULED' ? 'Agendando...' : 'Enviando...')
                        : (sendMode === 'SCHEDULED' ? 'Agendar disparo' : 'Enviar disparo')}
                    </button>
                    {sendResult && (
                      <div
                        className={`rounded-[10px] p-4 space-y-3 ${
                          sendResult.kind === 'scheduled'
                            ? 'bg-blue-50 border border-blue-200'
                            : sendResult.failed > 0
                              ? 'bg-amber-50 border border-amber-200'
                              : 'bg-emerald-50 border border-emerald-200'
                        }`}
                      >
                        {sendResult.kind === 'scheduled' ? (
                          <>
                            <div className="flex items-center gap-2">
                              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-100 text-blue-700 font-bold">◷</span>
                              <p className="text-[14px] font-semibold text-[#1E3A8A]">Disparo agendado com sucesso</p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[12px] text-[#334155]">
                              <p><strong>Total de contatos agendados:</strong> {sendResult.validRecipients}</p>
                              <p>
                                <strong>Data/hora do envio:</strong>{' '}
                                {new Date(sendResult.scheduledAt).toLocaleString('pt-BR')}
                              </p>
                              <p><strong>Destino:</strong> {destinationLabel}</p>
                              <p><strong>Atendimento:</strong> {postSendModeLabel}</p>
                              <p><strong>Status:</strong> Agendado</p>
                              <p><strong>Inválidos/Bloqueados:</strong> {sendResult.invalidRecipients}</p>
                            </div>
                            <p className="text-[12px] text-[#1E3A8A]">
                              O envio será realizado automaticamente no horário programado, desde que o backend esteja ativo.
                            </p>
                            <details className="text-[12px] text-[#334155]">
                              <summary className="cursor-pointer font-medium">Ver detalhes técnicos</summary>
                              <p className="mt-2">batchId: {sendResult.batchId}</p>
                              <p>status: {sendResult.status}</p>
                              <p>total informado: {sendResult.total}</p>
                            </details>
                          </>
                        ) : (
                          <>
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex h-6 w-6 items-center justify-center rounded-full font-bold ${
                                  sendResult.failed > 0
                                    ? 'bg-amber-100 text-amber-700'
                                    : 'bg-emerald-100 text-emerald-700'
                                }`}
                              >
                                {sendResult.failed > 0 ? '!' : '✓'}
                              </span>
                              <p
                                className={`text-[14px] font-semibold ${
                                  sendResult.failed > 0 ? 'text-[#92400E]' : 'text-[#065F46]'
                                }`}
                              >
                                {sendResult.failed > 0 ? 'Alguns contatos não foram enviados' : 'Disparo enviado com sucesso'}
                              </p>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[12px] text-[#334155]">
                              <p><strong>Total de contatos:</strong> {sendResult.total}</p>
                              <p><strong>Enviados:</strong> {sendResult.success}</p>
                              <p><strong>Falhas:</strong> {sendResult.failed}</p>
                              <p><strong>Destino:</strong> {destinationLabel}</p>
                              <p><strong>Atendimento:</strong> {postSendModeLabel}</p>
                            </div>
                            {sendResult.failed > 0 && (
                              <details className="text-[12px] text-[#334155]">
                                <summary className="cursor-pointer font-medium">Ver detalhes técnicos</summary>
                                <div className="mt-2 space-y-1">
                                  {sendResult.details
                                    .filter((detail) => detail.status !== 'sent')
                                    .map((detail) => (
                                      <p key={`${detail.rowNumber}-${detail.phoneNormalized ?? detail.phoneOriginal ?? 'sem-telefone'}`}>
                                        Linha {detail.rowNumber} • {detail.phoneNormalized ?? detail.phoneOriginal ?? 'sem telefone'} •{' '}
                                        {detail.error ?? 'Falha no envio'}
                                      </p>
                                    ))}
                                </div>
                              </details>
                            )}
                          </>
                        )}
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
