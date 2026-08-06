import { APPLICATION_TIME_ZONE } from '../lib/timezone.js';

export const INBOX_DATE_TIME_ZONE = APPLICATION_TIME_ZONE;
export type ConversationDateReference = 'last_message' | 'conversation_started';

export interface ConversationDateFilter {
  dateFrom?: string;
  dateTo?: string;
  dateReference?: ConversationDateReference;
}

export class ConversationDateFilterError extends Error {}

function normalizeDate(value: unknown, label: string): string | undefined {
  if (value == null || value === '') return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ConversationDateFilterError(`${label} deve estar no formato YYYY-MM-DD.`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    throw new ConversationDateFilterError(`${label} é inválida.`);
  }
  return value;
}

function dateOnlyToUtcMillis(value: string): number {
  const [year, month, day] = value.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

export function parseConversationDateFilter(input: {
  dateFrom?: unknown;
  dateTo?: unknown;
  dateReference?: unknown;
}): ConversationDateFilter {
  const dateFrom = normalizeDate(input.dateFrom, 'Data inicial');
  const dateTo = normalizeDate(input.dateTo, 'Data final');
  const dateReferenceRaw = input.dateReference;
  if (dateReferenceRaw != null && dateReferenceRaw !== '' && dateReferenceRaw !== 'last_message' && dateReferenceRaw !== 'conversation_started') {
    throw new ConversationDateFilterError('Referência de data inválida.');
  }
  if (dateFrom && dateTo && dateOnlyToUtcMillis(dateFrom) > dateOnlyToUtcMillis(dateTo)) {
    throw new ConversationDateFilterError('A data inicial não pode ser posterior à data final.');
  }
  return {
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...((dateFrom || dateTo) ? { dateReference: (dateReferenceRaw || 'last_message') as ConversationDateReference } : {}),
  };
}
