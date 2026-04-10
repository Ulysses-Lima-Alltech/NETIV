import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { useAuth } from '../contexts/AuthContext';
import { corretoresApi, projectsApi, whatsappBatchApi, type Corretor, type ProjectListItem } from '../api/client';
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
  const [selectedBrokerId, setSelectedBrokerId] = useState('');
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

  useEffect(() => {
    setTemplatesLoading(true);
    setTemplatesLoadError(null);
    void whatsappBatchApi
      .listTemplates()
      .then((r) => {
        setTemplates(r.templates ?? []);
      })
      .catch(() => {
        setTemplates([]);
        setTemplatesLoadError(
          'Não foi possível carregar os templates do WhatsApp. Verifique a API/configuração.',
        );
      })
      .finally(() => setTemplatesLoading(false));

    void projectsApi
      .list(true)
      .then((d) => setProjects(d.projects.filter((p) => p.status === 'ativo')))
      .catch(() => setProjects([]));
    void corretoresApi.list().then((d) => setBrokers(d.corretores)).catch(() => setBrokers([]));
  }, []);

  const selectedTemplate = templates.find((tpl) => tpl.key === selectedTemplateKey) ?? null;
  const validPreviewRows = (preview?.rows ?? []).filter((row) => row.status === 'valid');
  const canUseRowMode = validPreviewRows.length > 0;
  const selectedPreviewRow = testRowNumber == null ? null : validPreviewRows.find((row) => row.rowNumber === testRowNumber) ?? null;

  const buildMappingPayload = () => ({
    templateKey: selectedTemplateKey,
    phoneColumn,
    selectedEnterpriseId: selectedEnterpriseId ? parseInt(selectedEnterpriseId, 10) : null,
    selectedBrokerId: selectedBrokerId ? parseInt(selectedBrokerId, 10) : null,
    variableMappings,
  });

  const handleSelectedTemplateKeyChange = (key: string) => {
    setSelectedTemplateKey(key);
    setPreview(null);
    setTestResult(null);
    setSendResult(null);
    setTestRowNumber(null);

    const tpl = templates.find((t) => t.key === key) ?? null;
    setVariableMappings((prev) => {
      if (!tpl) {
        return {};
      }
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
    if (!parseData) return;
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
    if (!selectedTemplate) return;
    setLoadingTest(true);
    setError(null);
    setTestResult(null);
    try {
      const mapping = buildMappingPayload();
      const result = await whatsappBatchApi.sendTest({
        mapping,
        testPhone,
        mode: testMode,
        sampleRowIndex: testMode === 'row' ? (testRowNumber ?? 0) - 2 : undefined,
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
      <div className="max-w-[1280px] mx-auto px-6 py-6 space-y-5">
      <div>
        <p className="text-[13px] text-[#6B7280]">
          Envie templates do WhatsApp em lote a partir de uma planilha: faça o upload, escolha o template, mapeie colunas e envie.
        </p>
      </div>

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

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800 text-sm">{error}</p>
        </div>
      )}

      {parseData && !selectedTemplateKey && (
        <div className="bg-blue-50 border border-blue-200 rounded-md p-4">
          <p className="text-blue-900 text-sm">
            Selecione um template para configurar o mapeamento e gerar o preview.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <SpreadsheetUploadPanel
            file={file}
            onFileChange={setFile}
            onParse={handleParse}
            loading={loadingParse}
          />

          <TemplateSelector
            templates={templates}
            selectedKey={selectedTemplateKey}
            onSelect={handleSelectedTemplateKeyChange}
            loading={templatesLoading}
            selectDisabled={!!templatesLoadError}
          />

          {parseData && (
            <ColumnMappingPanel
              spreadsheet={parseData.spreadsheet}
              suggestions={parseData.suggestions}
              template={selectedTemplate}
              phoneColumn={phoneColumn}
              onPhoneColumnChange={setPhoneColumn}
              selectedEnterpriseId={selectedEnterpriseId}
              onSelectedEnterpriseIdChange={setSelectedEnterpriseId}
              selectedBrokerId={selectedBrokerId}
              onSelectedBrokerIdChange={setSelectedBrokerId}
              projects={projects}
              brokers={brokers}
              variableMappings={variableMappings}
              onVariableMappingsChange={setVariableMappings}
              onPreview={handlePreview}
              loadingPreview={loadingPreview}
            />
          )}
        </div>

        <div className="space-y-6">
          {preview && (
            <BatchPreviewTable
              preview={preview}
              onSelectTestRow={setTestRowNumber}
              selectedTestRow={testRowNumber}
            />
          )}

          {selectedTemplate && (
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
            />
          )}

          {preview && preview.validCount > 0 && (
            <div className="bg-white border border-gray-200 rounded-md p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">Enviar Mensagens</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-4 text-sm">
                  <div>
                    <span className="text-gray-500">Total:</span>
                    <span className="ml-2 font-medium">{preview.total}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Válidos:</span>
                    <span className="ml-2 font-medium text-green-600">{preview.validCount}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Inválidos:</span>
                    <span className="ml-2 font-medium text-red-600">{preview.invalidCount + preview.blockedCount}</span>
                  </div>
                </div>
                <button
                  onClick={handleSend}
                  disabled={loadingSend || preview.validCount === 0 || !selectedTemplateKey}
                  className="w-full bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {loadingSend ? 'Enviando...' : `Enviar ${preview.validCount} mensagens`}
                </button>
                {sendResult && (
                  <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
                    <pre className="text-xs text-gray-700 whitespace-pre-wrap">{sendResult}</pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
