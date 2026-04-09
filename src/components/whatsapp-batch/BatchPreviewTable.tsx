import type { BatchPreviewResponse } from '../../types/whatsappBatch';
import { useMemo, useState } from 'react';

interface Props {
  preview: BatchPreviewResponse | null;
}

type PreviewFilter = 'all' | 'valid' | 'invalid' | 'blocked';

export function BatchPreviewTable({ preview }: Props) {
  const [filter, setFilter] = useState<PreviewFilter>('all');
  const [page, setPage] = useState(1);
  const pageSize = 100;

  const filteredRows = useMemo(() => {
    if (!preview) return [];
    if (filter === 'all') return preview.rows;
    return preview.rows.filter((row) => row.status === filter);
  }, [filter, preview]);
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const pageRows = filteredRows.slice(pageStart, pageStart + pageSize);

  const setFilterAndResetPage = (nextFilter: PreviewFilter) => {
    setFilter(nextFilter);
    setPage(1);
  };

  if (!preview) return null;

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3">
      <h2 className="text-[14px] font-semibold">Preview antes do envio</h2>
      <div className="text-[12px] text-[#374151] bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] p-3 flex flex-wrap gap-2">
        <button type="button" className={`px-2 py-1 rounded ${filter === 'all' ? 'bg-[#DBEAFE] text-[#1D4ED8]' : 'bg-white border border-[#E5E7EB]'}`} onClick={() => setFilterAndResetPage('all')}>
          Total: {preview.total}
        </button>
        <button type="button" className={`px-2 py-1 rounded ${filter === 'valid' ? 'bg-[#DCFCE7] text-[#166534]' : 'bg-white border border-[#E5E7EB]'}`} onClick={() => setFilterAndResetPage('valid')}>
          Válidos: {preview.validCount}
        </button>
        <button type="button" className={`px-2 py-1 rounded ${filter === 'invalid' ? 'bg-[#FEE2E2] text-[#991B1B]' : 'bg-white border border-[#E5E7EB]'}`} onClick={() => setFilterAndResetPage('invalid')}>
          Inválidos: {preview.invalidCount}
        </button>
        <button type="button" className={`px-2 py-1 rounded ${filter === 'blocked' ? 'bg-[#FEF3C7] text-[#92400E]' : 'bg-white border border-[#E5E7EB]'}`} onClick={() => setFilterAndResetPage('blocked')}>
          Bloqueados: {preview.blockedCount}
        </button>
        <div className="ml-auto flex items-center gap-2">
          <span>
            Exibindo {pageRows.length} de {filteredRows.length}
          </span>
          <span>
            Página {currentPage} / {pageCount}
          </span>
        </div>
      </div>
      <div className="overflow-x-auto border border-[#E5E7EB] rounded-[10px]">
        <table className="w-full text-left">
          <thead className="bg-[#F9FAFB] border-b border-[#E5E7EB]">
            <tr className="text-[11px] uppercase tracking-wide text-[#6B7280]">
              <th className="px-3 py-2">Linha</th>
              <th className="px-3 py-2">Telefone original</th>
              <th className="px-3 py-2">Telefone normalizado</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Variáveis resolvidas</th>
              <th className="px-3 py-2">Erro</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => (
              <tr key={row.rowNumber} className="border-b border-[#F3F4F6] text-[12px]">
                <td className="px-3 py-2">{row.rowNumber}</td>
                <td className="px-3 py-2">{row.phoneOriginal || '-'}</td>
                <td className="px-3 py-2">{row.phoneNormalized || '-'}</td>
                <td className="px-3 py-2">{row.status}</td>
                <td className="px-3 py-2">
                  {row.resolvedVariables.map((v) => (
                    <div key={`${row.rowNumber}-${v.variableId}`}>
                      {'{{'}
                      {v.variableId}
                      {'}}'} {v.value ?? '(vazio)'} [{v.sourceType}]
                    </div>
                  ))}
                </td>
                <td className="px-3 py-2 text-red-700">{row.error || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          disabled={currentPage <= 1}
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          className="px-3 py-1 rounded border border-[#E5E7EB] text-[12px] disabled:opacity-50"
        >
          Anterior
        </button>
        <button
          type="button"
          disabled={currentPage >= pageCount}
          onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
          className="px-3 py-1 rounded border border-[#E5E7EB] text-[12px] disabled:opacity-50"
        >
          Próxima
        </button>
      </div>
    </section>
  );
}
