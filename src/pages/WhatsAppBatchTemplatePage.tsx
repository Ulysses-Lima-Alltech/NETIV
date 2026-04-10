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

  useEffect(() => {
    void whatsappBatchApi.listTemplates().then((r) => setTemplates(r.templates)).catch(() => setTemplates([]));
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
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <AppNav />
      <main className="flex-1 p-6">
        <div className="max-w-7xl mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Envio em Lote de Templates WhatsApp</h1>
            <p className="text-gray-600 mt-1">
              Envie mensagens em lote usando templates do WhatsApp. Faça upload de uma planilha, mapeie as colunas e envie.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-4">
              <p className="text-red-800 text-sm">{error}</p>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="space-y-6">
              <SpreadsheetUploadPanel
                file={file}
                onFileChange={setFile}
                onParse={handleParse}
                loading={loadingParse}
                disabled={!selectedTemplateKey}
              />

              <TemplateSelector
                templates={templates}
                selectedKey={selectedTemplateKey}
                onSelect={setSelectedTemplateKey}
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
                      disabled={loadingSend || preview.validCount === 0}
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
      </main>
    </div>
  );
}
