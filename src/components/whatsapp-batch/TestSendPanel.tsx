import type { BatchTemplateCatalogItem, BatchPreviewRow } from '../../types/whatsappBatch';

interface Props {
  template: BatchTemplateCatalogItem;
  testPhone: string;
  onTestPhoneChange: (value: string) => void;
  testMode: 'row' | 'manual';
  onTestModeChange: (value: 'row' | 'manual') => void;
  testRowNumber: number | null;
  availableTestRows: number[];
  manualTestVariables: Record<string, string>;
  onManualTestVariablesChange: (variables: Record<string, string>) => void;
  onTest: () => Promise<void>;
  loadingTest: boolean;
  testResult: string | null;
  canUseRowMode: boolean;
  selectedPreviewRow: BatchPreviewRow | null;
}

const inputCls =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px] bg-white focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

export function TestSendPanel({
  template,
  testPhone,
  onTestPhoneChange,
  testMode,
  onTestModeChange,
  testRowNumber,
  availableTestRows,
  manualTestVariables,
  onManualTestVariablesChange,
  onTest,
  loadingTest,
  testResult,
  canUseRowMode,
  selectedPreviewRow,
}: Props) {
  const updateManualVariable = (variableId: string, value: string) => {
    onManualTestVariablesChange({ ...manualTestVariables, [variableId]: value });
  };

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3">
      <h2 className="text-[14px] font-semibold">Envio de teste</h2>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="block text-[12px] text-[#374151] mb-1">Número de teste</label>
          <input
            className={inputCls}
            value={testPhone}
            placeholder="Número para teste (com DDD)"
            onChange={(e) => onTestPhoneChange(e.target.value)}
          />
        </div>
        <div>
          <label className="block text-[12px] text-[#374151] mb-1">Modo do teste</label>
          <select className={inputCls} value={testMode} onChange={(e) => onTestModeChange(e.target.value as 'row' | 'manual')}>
            <option value="row" disabled={!canUseRowMode}>
              Usar uma linha da planilha
            </option>
            <option value="manual">Preencher manualmente</option>
          </select>
        </div>
      </div>

      {testMode === 'row' ? (
        <div>
          <label className="block text-[12px] text-[#374151] mb-1">Linha da planilha</label>
          <select
            className={inputCls}
            value={testRowNumber == null ? '' : String(testRowNumber)}
            onChange={(e) => onTestModeChange('row')} // This will be handled by parent
            disabled={!canUseRowMode}
          >
            <option value="">Selecione uma linha válida</option>
            {availableTestRows.map((rowNumber) => (
              <option key={rowNumber} value={String(rowNumber)}>
                Linha {rowNumber}
              </option>
            ))}
          </select>
          {!canUseRowMode && (
            <p className="text-[11px] text-[#B45309] mt-1">Gere o preview para selecionar uma linha válida.</p>
          )}
          {selectedPreviewRow && (
            <div className="mt-2 p-2 bg-[#F8FAFC] border border-[#E2E8F0] rounded-[8px] text-[11px]">
              <p className="font-semibold mb-1">Variáveis da linha selecionada:</p>
              {selectedPreviewRow.resolvedVariables.map((v) => (
                <div key={v.variableId} className="mb-1">
                  <span className="font-mono">
                    {'{{'}{v.variableId}{'}'}
                  </span>
                  <span className="ml-1">
                    {v.value ?? '(vazio)'}
                  </span>
                  <span className="text-[#6B7280]">
                    [{v.sourceType}]
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {template.variables.map((variable) => (
            <div key={variable.id}>
              <label className="block text-[12px] text-[#374151] mb-1">
                {'{{'}
                {variable.id}
                {'}}'} {variable.label} {variable.required && <span className="text-red-500">*</span>}
              </label>
              <input
                className={inputCls}
                value={manualTestVariables[String(variable.id)] || ''}
                onChange={(e) => updateManualVariable(String(variable.id), e.target.value)}
                placeholder="Digite o valor manual"
              />
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={() => void onTest()}
          disabled={!testPhone || loadingTest || (testMode === 'row' && !testRowNumber) || (testMode === 'manual' && template.variables.some(v => v.required && !manualTestVariables[String(v.id)]))}
          className="px-4 py-2 rounded-[10px] bg-[#0EA5E9] text-white text-[13px] font-semibold hover:bg-[#0284C7] disabled:opacity-60"
        >
          {loadingTest ? 'Enviando teste...' : 'Enviar teste'}
        </button>
      </div>

      {testResult && (
        <div className="bg-gray-50 border border-gray-200 rounded-md p-4">
          <h3 className="text-sm font-medium text-gray-900 mb-2">Resultado do teste:</h3>
          <pre className="text-xs text-gray-700 whitespace-pre-wrap">{testResult}</pre>
        </div>
      )}
    </section>
  );
}
