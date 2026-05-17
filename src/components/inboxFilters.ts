export type InboxMode = 'all' | 'ANA' | 'handoff';

export interface InboxFilters {
  mode: InboxMode;
  status: string;
  readState: 'all' | 'read' | 'unread';
  enterpriseId: number | '';
  search: string;
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
