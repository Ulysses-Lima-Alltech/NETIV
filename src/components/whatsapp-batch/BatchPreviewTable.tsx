import type { BatchPreviewResponse } from '../../types/whatsappBatch';

interface Props {
  preview: BatchPreviewResponse | null;
}

export function BatchPreviewTable({ preview }: Props) {
  if (!preview) return null;
  return (
    <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3">
      <h2 className="text-[14px] font-semibold">Preview antes do envio</h2>
      <div className="text-[12px] text-[#374151] bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] p-3">
        Total: {preview.total} | Válidos: {preview.validCount} | Inválidos: {preview.invalidCount} | Bloqueados: {preview.blockedCount}
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
            {preview.rows.slice(0, 50).map((row) => (
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
    </section>
  );
}
