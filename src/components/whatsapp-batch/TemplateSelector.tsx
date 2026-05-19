import type { BatchTemplateCatalogItem } from '../../types/whatsappBatch';

interface Props {
  templates: BatchTemplateCatalogItem[];
  selectedKey: string;
  onSelect: (key: string) => void;
  loading?: boolean;
  selectDisabled?: boolean;
}

const inputCls =
  'w-full border border-[#E5E7EB] rounded-[10px] px-3 py-2 text-[13px] bg-white focus:border-[#3B82F6] focus:ring-[3px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

export function TemplateSelector({ templates, selectedKey, onSelect, loading, selectDisabled }: Props) {
  const selected = templates.find((item) => item.key === selectedKey) ?? null;
  const statusBadge = String(selected?.status ?? 'APPROVED').toUpperCase();
  const categoryBadge = selected?.category ?? 'UTILITY';
  const languageBadge = selected?.languageCode ?? 'pt_BR';
  const contentBadge = selected?.requiresHeaderMedia ? 'Requer imagem' : 'Texto puro';
  const variableBadge = selected?.hasBodyVariables
    ? `Possui variaveis (${selected.bodyVariableCount ?? 0})`
    : 'Sem variaveis';

  const statusColors: Record<string, string> = {
    APPROVED: 'bg-emerald-100 text-emerald-800',
    PENDING: 'bg-amber-100 text-amber-800',
    REJECTED: 'bg-red-100 text-red-800',
    PAUSED: 'bg-slate-200 text-slate-700',
    DELETED: 'bg-slate-700 text-white',
    DISABLED: 'bg-orange-100 text-orange-800',
    UNKNOWN: 'bg-slate-100 text-slate-700',
  };
  const statusClass = statusColors[statusBadge] ?? 'bg-slate-100 text-slate-700';

  return (
    <section className="bg-white border border-[#E5E7EB] rounded-[12px] p-4 space-y-3">
      <h2 className="text-[14px] font-semibold">Templates</h2>
      {loading ? <p className="text-[13px] text-[#6B7280]">Carregando templates...</p> : null}
      <select
        className={inputCls}
        value={selectedKey}
        onChange={(e) => onSelect(e.target.value)}
        disabled={loading || selectDisabled}
        aria-busy={loading}
      >
        <option value="">Selecione um template</option>
        {templates.map((tpl) => (
          <option key={tpl.key} value={tpl.key}>
            {`${tpl.name} - ${String(tpl.status ?? 'UNKNOWN').toUpperCase()} - ${String(tpl.category ?? 'SEM_CATEGORIA').toUpperCase()}`}
          </option>
        ))}
      </select>
      {selected && (
        <div className="text-[12px] text-[#374151] bg-[#F8FAFC] border border-[#E2E8F0] rounded-[10px] p-3 space-y-1">
          <div className="flex flex-wrap gap-2 mb-2">
            <span className={`px-2 py-1 rounded-full text-[11px] font-semibold ${statusClass}`}>{statusBadge}</span>
            <span className="px-2 py-1 rounded-full bg-sky-100 text-sky-800 text-[11px] font-semibold">{categoryBadge}</span>
            <span className="px-2 py-1 rounded-full bg-slate-100 text-slate-700 text-[11px] font-semibold">{languageBadge}</span>
            <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold">{contentBadge}</span>
            <span className="px-2 py-1 rounded-full bg-violet-100 text-violet-800 text-[11px] font-semibold">{variableBadge}</span>
          </div>
          <p>Idioma: {selected.languageCode}</p>
          {selected.variables.map((v) => (
            <p key={v.id}>
              {'{{'}
              {v.id}
              {'}}'} - {v.label}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
