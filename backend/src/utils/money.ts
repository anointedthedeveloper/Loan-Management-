/** All arithmetic is done in integer kobo so results are exact and deterministic. */
export const toKobo = (naira: number): number => Math.sign(naira) * Math.round((Math.abs(naira) + Number.EPSILON) * 100);
export const fromKobo = (kobo: number): number => kobo / 100;
export const round2 = (n: number): number => fromKobo(toKobo(n));

/** Splits an integer total into n parts that sum exactly; the remainder goes on the last part. */
export function splitEvenly(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const parts = Array<number>(n).fill(base);
  parts[n - 1] = total - base * (n - 1);
  return parts;
}
