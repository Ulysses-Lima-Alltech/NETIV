/** Fuso horário do negócio (Brazil/São Paulo). */
export const APPLICATION_TIME_ZONE = 'America/Sao_Paulo';
const TZ = APPLICATION_TIME_ZONE;

/**
 * Retorna o dia da semana (0=domingo … 6=sábado) em America/Sao_Paulo.
 * Evita dependência implícita do timezone do ambiente.
 */
export function getDayOfWeekInTz(date: Date): number {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'long' });
  const dayName = fmt.format(date);
  const days: Record<string, number> = {
    Sunday: 0,
    Monday: 1,
    Tuesday: 2,
    Wednesday: 3,
    Thursday: 4,
    Friday: 5,
    Saturday: 6,
  };
  return days[dayName] ?? 0;
}

/**
 * Retorna string HH:mm:ss em America/Sao_Paulo, compatível com TIME do PostgreSQL.
 */
export function getTimeStringInTz(date: Date): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  return fmt.format(date);
}
