import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INBOX_FILTERS,
  getInboxDateRangeError,
  hasActiveInboxFilters,
  inboxFiltersToApiParams,
} from '../components/inboxFilters';

describe('Inbox date filters', () => {
  it('does not send a date filter when both dates are empty', () => {
    expect(inboxFiltersToApiParams(DEFAULT_INBOX_FILTERS)).toEqual({});
    expect(hasActiveInboxFilters(DEFAULT_INBOX_FILTERS)).toBe(false);
  });

  it('sends either boundary together with the selected reference', () => {
    expect(inboxFiltersToApiParams({
      ...DEFAULT_INBOX_FILTERS,
      dateFrom: '2026-08-01',
      dateReference: 'conversation_started',
    })).toEqual({ dateFrom: '2026-08-01', dateReference: 'conversation_started' });
    expect(inboxFiltersToApiParams({ ...DEFAULT_INBOX_FILTERS, dateTo: '2026-08-31' }))
      .toEqual({ dateTo: '2026-08-31', dateReference: 'last_message' });
  });

  it('validates a reversed range by calendar value, not string comparison', () => {
    expect(getInboxDateRangeError({ dateFrom: '2026-08-02', dateTo: '2026-08-01' }))
      .toBe('A data inicial não pode ser posterior à data final.');
    expect(getInboxDateRangeError({ dateFrom: '2026-08-01', dateTo: '2026-08-01' })).toBeNull();
  });
});
