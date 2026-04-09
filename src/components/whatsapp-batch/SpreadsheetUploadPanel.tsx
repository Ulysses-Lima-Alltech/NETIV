interface Props {
  file: File | null;
  onFileChange: (file: File | null) => void;
  onParse: () => Promise<void>;
  loading: boolean;
}

const inputCls =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px] bg-white focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

export function SpreadsheetUploadPanel({ file, onFileChange, onParse, loading }: Props) {
  return (
    <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3">
      <h2 className="text-[14px] font-semibold">Upload da planilha (CSV ou XLSX)</h2>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 items-end">
        <input
          type="file"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
          className={inputCls}
        />
        <button
          type="button"
          disabled={!file || loading}
          onClick={() => void onParse()}
          className="px-4 py-2 rounded-[10px] bg-[#0EA5E9] text-white text-[13px] font-semibold hover:bg-[#0284C7] disabled:opacity-60"
        >
          {loading ? 'Lendo planilha...' : 'Ler colunas'}
        </button>
        <p className="text-[12px] text-[#6B7280]">
          {file ? `Arquivo selecionado: ${file.name}` : 'Nenhum arquivo selecionado.'}
        </p>
      </div>
    </section>
  );
}
