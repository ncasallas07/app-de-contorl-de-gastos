// Fechas del agente en la zona horaria del usuario.
// Las Edge Functions corren en UTC: sin esto, a las 7 p. m. en Bogotá
// el agente ya creería que es "mañana".

export const DEFAULT_TIME_ZONE = 'America/Bogota';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Fecha de hoy (YYYY-MM-DD) en la zona indicada. */
export function todayInZone(now: Date = new Date(), timeZone = DEFAULT_TIME_ZONE): string {
  // en-CA formatea como YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Días calendario de `fromIso` a `toIso` (negativo si `toIso` ya pasó). */
export function daysBetween(fromIso: string, toIso: string): number {
  const toUtc = (iso: string) => {
    const [y, m, d] = iso.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((toUtc(toIso) - toUtc(fromIso)) / 86_400_000);
}
