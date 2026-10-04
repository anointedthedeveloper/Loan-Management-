/**
 * Calendar dates are stored as UTC midnight so they never shift with server timezone.
 * "Today" is the current date in Africa/Lagos.
 */
export const DAY_MS = 86_400_000;

export const utcDate = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
export function dateOnly(d: Date | string): Date {
  const x = typeof d === 'string' ? new Date(d) : d;
  return utcDate(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
}
export function todayLagos(now: Date = new Date()): Date {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos' }).format(now).split('-').map(Number);
  return utcDate(y!, m! - 1, d!);
}
export const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
/** Adds calendar months, clamping to month end (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(d: Date, n: number): Date {
  const total = d.getUTCMonth() + n;
  const y = d.getUTCFullYear() + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return utcDate(y, m, Math.min(d.getUTCDate(), last));
}
export const diffDays = (a: Date, b: Date) => Math.round((a.getTime() - b.getTime()) / DAY_MS);
export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Day `day` of the month `n` months after `d`'s month, clamped to month end (30 -> 28/29 Feb). Independent of d's own day. */
export function monthDay(d: Date, n: number, day: number): Date {
  const total = d.getUTCMonth() + n;
  const y = d.getUTCFullYear() + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return utcDate(y, m, Math.min(day, new Date(Date.UTC(y, m + 1, 0)).getUTCDate()));
}
