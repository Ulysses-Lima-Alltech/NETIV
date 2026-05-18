interface Props {
  file: File | null;
  onFileChange: (file: File | null) => void;
  onParse: () => Promise<void>;
  loading: boolean;
  disabled?: boolean;
}

const fileInputId = 'batch-spreadsheet-upload';

export function SpreadsheetUploadPanel({ file, onFileChange, onParse, loading, disabled }: Props) {
  return (
    <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3">
      <h2 className="text-[14px] font-semibold">Upload da planilha (CSV ou XLSX)</h2>
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_180px] gap-3 items-start">
        <input
          id={fileInputId}
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          className="sr-only"
          disabled={disabled}
        />
        <div className="space-y-2">
          <label
            htmlFor={fileInputId}
            className={`inline-flex w-full items-center justify-center gap-2 rounded-[10px] border border-[#0EA5E9] bg-[#F0F9FF] px-4 py-2 text-[13px] font-semibold text-[#0369A1] transition ${
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-[#E0F2FE]'
            }`}
          >
            <span aria-hidden="true">+</span>
            <span>Selecionar planilha</span>
          </label>
          <p className="text-[12px] text-[#6B7280]">
            {file ? `Arquivo selecionado: ${file.name}` : 'Nenhum arquivo selecionado.'}
          </p>
        </div>
        <button
          type="button"
          disabled={!file || loading || disabled}
          onClick={() => void onParse()}
          className="h-[38px] px-4 py-2 rounded-[10px] bg-[#0EA5E9] text-white text-[13px] font-semibold hover:bg-[#0284C7] disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {loading ? 'Lendo planilha...' : 'Ler colunas'}
        </button>
      </div>
    </section>
  );
}
