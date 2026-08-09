import { APPOINTMENT_BUSINESS_TZ } from './appointmentDateNormalize.js';

export function formatYmdForAnaVisitAvailability(value: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APPOINTMENT_BUSINESS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
}

export function addDaysYmdForAnaVisitAvailability(ymd: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const base = new Date(`${ymd}T12:00:00-03:00`);
  if (Number.isNaN(base.getTime())) return null;
  base.setTime(base.getTime() + days * 86_400_000);
  return formatYmdForAnaVisitAvailability(base);
}
