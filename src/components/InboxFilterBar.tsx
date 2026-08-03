import { useMemo, useState } from 'react';
import { getInboxDateRangeError, type InboxFilters, type InboxMode } from './inboxFilters';

const STATUS_OPTIONS = [
  { value: 'all', label: 'Todos' },
  { value: 'Novo', label: 'Novo' },
  { value: 'Qualificado', label: 'Qualificado' },
  { value: 'Carteira', label: 'Carteira' },
  { value: 'Handoff', label: 'Handoff' },
];

const MODE_OPTIONS: { value: InboxMode; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'ANA', label: 'ANA' },
  { value: 'handoff', label: 'Handoff' },
];

const READ_OPTIONS: Array<{ value: InboxFilters['readState']; label: string }> = [
  { value: 'all', label: 'Todas' },
  { value: 'read', label: 'Lidas' },
  { value: 'unread', label: 'Nao lidas' },
];

const inputClass =
  'w-full rounded-[12px] border border-[#e2e8f0] bg-white px-3 py-[9px] text-[13px] text-[#0f172a] placeholder:text-[#94a3b8] transition focus:border-[#3b82f6] focus:ring-[4px] focus:ring-[rgba(59,130,246,0.12)] focus:outline-none';

interface InboxFilterBarProps {
  filters: InboxFilters;
  onChange: (f: InboxFilters) => void;
  projects: { id: number; name: string; active: boolean }[];
  onClear: () => void;
  hasActiveFilters: boolean;
}

export function InboxFilterBar({ filters, onChange, projects, onClear, hasActiveFilters }: InboxFilterBarProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const activeCount = useMemo(() => {
    let count = 0;
    if (filters.mode !== 'all') count += 1;
    if (filters.status !== 'all') count += 1;
    if (filters.readState !== 'all') count += 1;
    if (filters.enterpriseId !== '') count += 1;
    if (filters.dateFrom || filters.dateTo) count += 1;
    return count;
  }, [filters.dateFrom, filters.dateTo, filters.enterpriseId, filters.mode, filters.readState, filters.status]);

  const dateRangeError = getInboxDateRangeError(filters);

  return (
    <div className="space-y-3 border-b border-[#e2e8f0] bg-white px-3 pb-3 pt-2">
      <label className="block">
        <span className="mb-1 block text-[11px] font-medium text-[#64748b]">Busca</span>
        <input
          type="search"
          placeholder="Nome, telefone ou mensagem..."
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className={inputClass}
        />
      </label>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setAdvancedOpen((prev) => !prev)}
          className="inline-flex items-center gap-2 rounded-[10px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-1.5 text-[12px] font-medium text-[#475569] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
          aria-expanded={advancedOpen}
          aria-label={advancedOpen ? 'Recolher filtros avançados' : 'Expandir filtros avançados'}
        >
          <svg viewBox="0 0 24 24" fill="none" className={`h-4 w-4 transition-transform ${advancedOpen ? 'rotate-90' : ''}`}>
            <path d="M9 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Filtros avançados
        </button>

        {activeCount > 0 && (
          <span className="inline-flex items-center rounded-full bg-[#eaf2ff] px-2 py-0.5 text-[11px] font-medium text-[#123a73]">
            {activeCount} ativo{activeCount > 1 ? 's' : ''}
          </span>
        )}
      </div>

      {advancedOpen && (
        <div className="space-y-3 rounded-[12px] border border-[#e2e8f0] bg-[#fbfdff] p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[#64748b]">Modo</span>
              <select
                value={filters.mode}
                onChange={(e) => onChange({ ...filters, mode: e.target.value as InboxMode })}
                className={inputClass}
              >
                {MODE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-medium text-[#64748b]">Funil</span>
              <select
                value={filters.status}
                onChange={(e) => onChange({ ...filters, status: e.target.value })}
                className={inputClass}
              >
                {STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-[#64748b]">Leitura</span>
            <select
              value={filters.readState}
              onChange={(e) => onChange({ ...filters, readState: e.target.value as InboxFilters['readState'] })}
              className={inputClass}
            >
              {READ_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-medium text-[#64748b]">Empreendimento</span>
            <select
              value={filters.enterpriseId === '' ? 'all' : filters.enterpriseId}
              onChange={(e) => {
                const v = e.target.value;
                onChange({ ...filters, enterpriseId: v === 'all' ? '' : Number(v) });
              }}
              className={inputClass}
            >
              <option value="all">Todos</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="min-w-0">
            <legend className="mb-1 block text-[11px] font-medium text-[#64748b]">Período</legend>
            <div className="grid grid-cols-[repeat(auto-fit,minmax(132px,1fr))] gap-2">
              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] font-medium text-[#64748b]">Data inicial</span>
                <input
                  type="date"
                  value={filters.dateFrom ?? ''}
                  max={filters.dateTo ?? undefined}
                  aria-describedby={dateRangeError ? 'inbox-date-range-error' : undefined}
                  onChange={(e) => onChange({ ...filters, dateFrom: e.target.value || null })}
                  className={inputClass}
                />
              </label>
              <label className="block min-w-0">
                <span className="mb-1 block text-[11px] font-medium text-[#64748b]">Data final</span>
                <input
                  type="date"
                  value={filters.dateTo ?? ''}
                  min={filters.dateFrom ?? undefined}
                  aria-describedby={dateRangeError ? 'inbox-date-range-error' : undefined}
                  onChange={(e) => onChange({ ...filters, dateTo: e.target.value || null })}
                  className={inputClass}
                />
              </label>
            </div>
            <label className="mt-2 flex cursor-pointer items-start gap-2 text-[12px] text-[#475569]">
              <input
                type="checkbox"
                checked={filters.dateReference === 'conversation_started'}
                onChange={(e) => onChange({
                  ...filters,
                  dateReference: e.target.checked ? 'conversation_started' : 'last_message',
                })}
                className="mt-0.5 h-3.5 w-3.5 rounded border-[#cbd5e1] text-[#2563eb] focus:ring-[#93c5fd]"
              />
              Usar data de início da conversa
            </label>
            {dateRangeError && (
              <p id="inbox-date-range-error" role="alert" className="mt-1.5 text-[11px] text-[#b91c1c]">
                {dateRangeError}
              </p>
            )}
            {(filters.dateFrom || filters.dateTo) && (
              <button
                type="button"
                onClick={() => onChange({ ...filters, dateFrom: null, dateTo: null })}
                className="mt-2 text-[12px] font-medium text-[#475569] underline decoration-[#cbd5e1] underline-offset-2 hover:text-[#0f172a]"
              >
                Limpar período
              </button>
            )}
          </fieldset>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={onClear}
              className="w-full rounded-[11px] border border-[#e2e8f0] bg-white px-3 py-2 text-[12px] font-medium text-[#475569] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
            >
              Limpar filtros
            </button>
          )}
        </div>
      )}
    </div>
  );
}
