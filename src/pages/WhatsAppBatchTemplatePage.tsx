import { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AppNav } from '../components/AppNav';
import { useAuth } from '../contexts/AuthContext';
import { projectsApi, whatsappBatchApi, type ProjectListItem } from '../api/client';
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
  const [selectedTemplateKey, setSelectedTemplateKey] = useState('');
  const [parseData, setParseData] = useState<BatchParseResponse | null>(null);
  const [phoneColumn, setPhoneColumn] = useState('');
  const [selectedEnterpriseId, setSelectedEnterpriseId] = useState('');
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
  }, []);

  const selectedTemplate = templates.find((tpl) => tpl.key === selectedTemplateKey) ?? null;
  const validPreviewRows = (preview?.rows ?? []).filter((row) => row.status === 'valid');
  const canUseRowMode = validPreviewRows.length > 0;
  const selectedPreviewRow = testRowNumber == null ? null : validPreviewRows.find((row) => row.rowNumber === testRowNumber) ?? null;

  const buildMappingPayload = () => ({
    templateKey: selectedTemplateKey,
    phoneColumn,
    selectedEnterpriseId: selectedEnterpriseId ? parseInt(selectedEnterpriseId, 10) : null,
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
    if (!file) return;
    setLoadingPreview(true);
    setError(null);
    try {
      const data = await whatsappBatchApi.preview(file, { mapping: buildMappingPayload() });
      setPreview(data);
      const firstValidRow = data.rows.find((row) => row.status === 'valid') ?? null;
      setTestRowNumber(firstValidRow?.rowNumber ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erro ao gerar preview.');
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleTest = async () => {
    if (!file) return;
    if (testMode === 'row' && testRowNumber == null) {
      setTestResult('Selecione uma linha válida do preview para enviar o teste.');
      return;
    }
    setLoadingTest(true);
    setError(null);
    try {
      const sampleRowIndex = testMode === 'row' && testRowNumber != null ? testRowNumber - 2 : undefined;
      const result = await whatsappBatchApi.sendTest(file, {
        mapping: buildMappingPayload(),
        testPhone,
        mode: testMode,
        sampleRowIndex,
        manualVariables: testMode === 'manual' ? manualTestVariables : undefined,
      });
      setTestResult(result.success ? `Teste enviado com sucesso (${result.metaMessageId ?? 'sem id'}).` : result.error || 'Falha no teste.');
    } catch (e) {
      setTestResult(e instanceof Error ? e.message : 'Falha no envio de teste.');
    } finally {
      setLoadingTest(false);
    }
  };

  const handleSend = async () => {
    if (!file) return;
    setLoadingSend(true);
    setError(null);
    try {
      const result = await whatsappBatchApi.sendBatch(file, { mapping: buildMappingPayload() });
      setSendResult(`Envio finalizado. Total: ${result.total}, Sucesso: ${result.success}, Falhas: ${result.failed}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha no envio em lote.');
    } finally {
      setLoadingSend(false);
    }
  };

  useEffect(() => {
    if (!canUseRowMode && testMode === 'row') setTestMode('manual');
  }, [canUseRowMode, testMode]);

  useEffect(() => {
    if (!selectedTemplate) {
      setManualTestVariables({});
      return;
    }
    setManualTestVariables((prev) => {
      const next: Record<string, string> = {};
      for (const variable of selectedTemplate.variables) {
        next[String(variable.id)] = prev[String(variable.id)] ?? '';
      }
      return next;
    });
  }, [selectedTemplate]);

  const previewVariablesForTest =
    testMode === 'row'
      ? (selectedPreviewRow?.resolvedVariables ?? []).map((v) => ({
          variableId: v.variableId,
          label: v.label,
          value: v.value,
          sourceType: v.sourceType,
        }))
      : (selectedTemplate?.variables ?? []).map((variable) => ({
          variableId: variable.id,
          label: variable.label,
          value: (manualTestVariables[String(variable.id)] ?? '').trim() || null,
          sourceType: 'manual',
        }));

  if (!isAdmin) return <Navigate to="/inbox" replace />;

  return (
    <div className="min-h-screen bg-[#F9FAFB] text-[#111827]">
      <nav className="h-14 border-b border-[#E5E7EB] bg-white/90 backdrop-blur-sm sticky top-0 z-20 px-6 flex items-center justify-between">
        <span className="text-[15px] font-semibold">Disparo WhatsApp em lote</span>
        <AppNav />
      </nav>
      <div className="max-w-[1280px] mx-auto px-6 py-6 space-y-5">
        <SpreadsheetUploadPanel file={file} onFileChange={setFile} onParse={handleParse} loading={loadingParse} />
        <TemplateSelector templates={templates} selectedTemplateKey={selectedTemplateKey} onChange={setSelectedTemplateKey} />
        {parseData && (
          <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-2 text-[12px]">
            <p>Total de linhas: {parseData.rowCount}</p>
            <p>Colunas detectadas: {parseData.headers.join(', ') || '-'}</p>
          </section>
        )}
        <ColumnMappingPanel
          headers={parseData?.headers ?? []}
          suggestions={parseData?.suggestions ?? null}
          template={selectedTemplate}
          phoneColumn={phoneColumn}
          selectedEnterpriseId={selectedEnterpriseId}
          projects={projects}
          variableMappings={variableMappings}
          onPhoneColumnChange={setPhoneColumn}
          onEnterpriseChange={setSelectedEnterpriseId}
          onVariableMappingChange={(variableId, value) => setVariableMappings((prev) => ({ ...prev, [variableId]: value }))}
        />
        <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4">
          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={!file || !selectedTemplateKey || loadingPreview}
            className="px-4 py-2 rounded-[10px] bg-[#2563EB] text-white text-[13px] font-semibold hover:bg-[#1D4ED8] disabled:opacity-60"
          >
            {loadingPreview ? 'Gerando preview...' : 'Gerar preview'}
          </button>
        </section>
        <BatchPreviewTable preview={preview} />
        <TestSendPanel
          testPhone={testPhone}
          mode={testMode}
          canUseRowMode={canUseRowMode}
          selectedRowNumber={testRowNumber}
          rowOptions={validPreviewRows.map((row) => ({
            rowNumber: row.rowNumber,
            label: `Linha ${row.rowNumber} - ${row.phoneOriginal ?? 'sem telefone'}`,
          }))}
          manualVariables={(selectedTemplate?.variables ?? []).map((variable) => ({
            variableId: variable.id,
            label: variable.label,
            value: manualTestVariables[String(variable.id)] ?? '',
          }))}
          previewVariables={previewVariablesForTest}
          loading={loadingTest}
          result={testResult}
          onTestPhoneChange={setTestPhone}
          onModeChange={setTestMode}
          onSelectedRowNumberChange={setTestRowNumber}
          onManualVariableChange={(variableId, value) =>
            setManualTestVariables((prev) => ({ ...prev, [String(variableId)]: value }))
          }
          onSendTest={handleTest}
        />
        <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3">
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!file || !preview || loadingSend}
            className="px-4 py-2 rounded-[10px] bg-[#16A34A] text-white text-[13px] font-semibold hover:bg-[#15803D] disabled:opacity-60"
          >
            {loadingSend ? 'Enviando lote...' : 'Enviar lote'}
          </button>
          {sendResult && <p className="text-[12px] text-[#047857]">{sendResult}</p>}
          {error && <p className="text-[12px] text-red-700">{error}</p>}
        </section>
      </div>
    </div>
  );
}
