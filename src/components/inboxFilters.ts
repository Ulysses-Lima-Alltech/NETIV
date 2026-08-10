export type InboxMode = 'all' | 'ANA' | 'handoff';
export type InboxDateReference = 'last_message' | 'conversation_started';

export interface InboxFilters {
  mode: InboxMode;
  status: string;
  readState: 'all' | 'read' | 'unread';
  enterpriseId: number | '';
  search: string;
  dateFrom: string | null;
  dateTo: string | null;
  dateReference: InboxDateReference;
}

export const DEFAULT_INBOX_FILTERS: InboxFilters = {
  mode: 'all',
  status: 'all',
  readState: 'all',
  enterpriseId: '',
  search: '',
  dateFrom: null,
  dateTo: null,
  dateReference: 'last_message',
};

export function hasActiveInboxFilters(f: InboxFilters): boolean {
  return f.mode !== 'all'
    || f.status !== 'all'
    || f.readState !== 'all'
    || f.enterpriseId !== ''
    || f.search.trim() !== ''
    || f.dateFrom !== null
    || f.dateTo !== null;
}

function dateInputToUtcMillis(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const millis = Date.UTC(year, month - 1, day);
  const date = new Date(millis);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
    ? millis
    : null;
}

export function getInboxDateRangeError(f: Pick<InboxFilters, 'dateFrom' | 'dateTo'>): string | null {
  const from = dateInputToUtcMillis(f.dateFrom);
  const to = dateInputToUtcMillis(f.dateTo);
  if (f.dateFrom && from == null) return 'Informe uma data inicial válida.';
  if (f.dateTo && to == null) return 'Informe uma data final válida.';
  if (from != null && to != null && from > to) return 'A data inicial não pode ser posterior à data final.';
  return null;
}

export function inboxFiltersToApiParams(f: InboxFilters): {
  mode?: 'all' | 'ANA' | 'handoff';
  status?: string;
  enterpriseId?: number;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  dateReference?: InboxDateReference;
} {
  const p: {
    mode?: 'all' | 'ANA' | 'handoff';
    status?: string;
    enterpriseId?: number;
    search?: string;
    dateFrom?: string;
    dateTo?: string;
    dateReference?: InboxDateReference;
  } = {};
  if (f.mode !== 'all') p.mode = f.mode;
  if (f.status !== 'all') p.status = f.status;
  if (f.enterpriseId !== '') p.enterpriseId = f.enterpriseId as number;
  if (f.search.trim() !== '') p.search = f.search.trim();
  if (f.dateFrom) p.dateFrom = f.dateFrom;
  if (f.dateTo) p.dateTo = f.dateTo;
  if (f.dateFrom || f.dateTo) p.dateReference = f.dateReference;
  return p;
}
