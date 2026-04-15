export type InboxMode = 'all' | 'ANA' | 'handoff';

export interface InboxFilters {
  mode: InboxMode;
  status: string;
  readState: 'all' | 'read' | 'unread';
  enterpriseId: number | '';
  search: string;
}

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
  { value: 'unread', label: 'Não lidas' },
];

const inputClass =
  'w-full border border-[#E5E7EB] rounded-[8px] px-2.5 py-[7px] text-[12px] text-[#111827] placeholder:text-[#9CA3AF] bg-[#F9FAFB] focus:bg-white focus:border-[#3B82F6] focus:ring-[2px] focus:ring-[rgba(59,130,246,0.15)] focus:outline-none';

interface InboxFilterBarProps {
  filters: InboxFilters;
  onChange: (f: InboxFilters) => void;
  projects: { id: number; name: string; active: boolean }[];
  onClear: () => void;
  hasActiveFilters: boolean;
}

export function InboxFilterBar({ filters, onChange, projects, onClear, hasActiveFilters }: InboxFilterBarProps) {
  return (
    <div className="p-3 border-b border-[#E5E7EB] bg-[#F9FAFB] space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[11px] font-medium text-[#6B7280] mb-0.5">Modo</label>
          <select
            value={filters.mode}
            onChange={(e) => onChange({ ...filters, mode: e.target.value as InboxMode })}
            className={inputClass}
          >
            {MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[11px] font-medium text-[#6B7280] mb-0.5">Status</label>
          <select
            value={filters.status}
            onChange={(e) => onChange({ ...filters, status: e.target.value })}
            className={inputClass}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-[#6B7280] mb-0.5">Status</label>
        <select
          value={filters.readState}
          onChange={(e) => onChange({ ...filters, readState: e.target.value as InboxFilters['readState'] })}
          className={inputClass}
        >
          {READ_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-[#6B7280] mb-0.5">Empreendimento</label>
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
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-[11px] font-medium text-[#6B7280] mb-0.5">Busca</label>
        <input
          type="search"
          placeholder="Nome, telefone ou mensagem…"
          value={filters.search}
          onChange={(e) => onChange({ ...filters, search: e.target.value })}
          className={inputClass}
        />
      </div>
      {hasActiveFilters && (
        <button
          type="button"
          onClick={onClear}
          className="w-full text-[12px] font-medium text-[#6B7280] hover:text-[#111827] py-1.5 rounded-[6px] hover:bg-[#E5E7EB]/60 transition-colors"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}

export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  mode: 'all',
  status: 'all',
  readState: 'all',
  enterpriseId: '',
  search: '',
};

export function hasActiveInboxFilters(f: InboxFilters): boolean {
  return f.mode !== 'all' || f.status !== 'all' || f.readState !== 'all' || f.enterpriseId !== '' || f.search.trim() !== '';
}

export function inboxFiltersToApiParams(f: InboxFilters): {
  mode?: 'all' | 'ANA' | 'handoff';
  status?: string;
  enterpriseId?: number;
  search?: string;
} {
  const p: { mode?: 'all' | 'ANA' | 'handoff'; status?: string; enterpriseId?: number; search?: string } = {};
  if (f.mode !== 'all') p.mode = f.mode;
  if (f.status !== 'all') p.status = f.status;
  if (f.enterpriseId !== '') p.enterpriseId = f.enterpriseId as number;
  if (f.search.trim() !== '') p.search = f.search.trim();
  return p;
}
