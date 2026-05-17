import type { InboxFilters, InboxMode } from './inboxFilters';

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
  return (
    <div className="space-y-3 border-b border-[#e2e8f0] bg-white px-3 pb-3 pt-2">
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

      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClear}
          className="w-full rounded-[11px] border border-[#e2e8f0] bg-[#f8fafc] px-3 py-2 text-[12px] font-medium text-[#475569] transition-colors hover:bg-[#f1f5f9] hover:text-[#0f172a]"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
