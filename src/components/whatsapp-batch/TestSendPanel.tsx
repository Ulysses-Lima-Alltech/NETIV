interface Props {
  testPhone: string;
  mode: 'row' | 'manual';
  canUseRowMode: boolean;
  selectedRowNumber: number | null;
  rowOptions: Array<{ rowNumber: number; label: string }>;
  manualVariables: Array<{ variableId: number; label: string; value: string }>;
  previewVariables: Array<{ variableId: number; label: string; value: string | null; sourceType: string }>;
  loading: boolean;
  result: string | null;
  onTestPhoneChange: (value: string) => void;
  onModeChange: (value: 'row' | 'manual') => void;
  onSelectedRowNumberChange: (value: number | null) => void;
  onManualVariableChange: (variableId: number, value: string) => void;
  onSendTest: () => Promise<void>;
}

const inputCls =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px] bg-white focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

export function TestSendPanel({
  testPhone,
  mode,
  canUseRowMode,
  selectedRowNumber,
  rowOptions,
  manualVariables,
  previewVariables,
  loading,
  result,
  onTestPhoneChange,
  onModeChange,
  onSelectedRowNumberChange,
  onManualVariableChange,
  onSendTest,
}: Props) {
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
          <select className={inputCls} value={mode} onChange={(e) => onModeChange(e.target.value as 'row' | 'manual')}>
            <option value="row" disabled={!canUseRowMode}>
              Usar uma linha da planilha
            </option>
            <option value="manual">Preencher manualmente</option>
          </select>
        </div>
      </div>

      {mode === 'row' ? (
        <div>
          <label className="block text-[12px] text-[#374151] mb-1">Linha da planilha</label>
          <select
            className={inputCls}
            value={selectedRowNumber == null ? '' : String(selectedRowNumber)}
            onChange={(e) => onSelectedRowNumberChange(e.target.value ? parseInt(e.target.value, 10) : null)}
            disabled={!canUseRowMode}
          >
            <option value="">Selecione uma linha válida</option>
            {rowOptions.map((row) => (
              <option key={row.rowNumber} value={String(row.rowNumber)}>
                {row.label}
              </option>
            ))}
          </select>
          {!canUseRowMode && (
            <p className="text-[11px] text-[#B45309] mt-1">Gere o preview para selecionar uma linha válida.</p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {manualVariables.map((item) => (
            <div key={item.variableId}>
              <label className="block text-[12px] text-[#374151] mb-1">
                {'{{'}
                {item.variableId}
                {'}}'} {item.label}
              </label>
              <input
                className={inputCls}
                value={item.value}
                onChange={(e) => onManualVariableChange(item.variableId, e.target.value)}
                placeholder="Digite o valor manual"
              />
            </div>
          ))}
        </div>
      )}

      <div className="border border-[#E5E7EB] rounded-[10px] p-3 text-[12px] bg-[#F9FAFB] space-y-2">
        <p className="font-semibold text-[#111827]">Preview final das variáveis do teste</p>
        {mode === 'row' && selectedRowNumber != null && <p>Linha escolhida: {selectedRowNumber}</p>}
        {previewVariables.length === 0 ? (
          <p className="text-[#6B7280]">Sem variáveis para exibir.</p>
        ) : (
          previewVariables.map((v) => (
            <div key={v.variableId}>
              {'{{'}
              {v.variableId}
              {'}}'} {v.label}: {v.value ?? '(vazio)'} [{v.sourceType}]
            </div>
          ))
        )}
      </div>

      <div className="flex items-end">
        <button
          type="button"
          onClick={() => void onSendTest()}
          disabled={!testPhone || loading}
          className="px-4 py-2 rounded-[10px] bg-[#7C3AED] text-white text-[13px] font-semibold hover:bg-[#6D28D9] disabled:opacity-60"
        >
          {loading ? 'Enviando teste...' : 'Enviar teste'}
        </button>
      </div>
      {result && <p className="text-[12px] text-[#374151]">{result}</p>}
    </section>
  );
}
