/** Nigerian mobile numbers: accepts 080…, +234 80…, 234 80… and stores the local 11-digit form. */
const NG_MOBILE = /^(?:0|234)([789][01]\d{8})$/;

export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[\s\-().]/g, '').replace(/^\+/, '');
  const m = NG_MOBILE.exec(digits);
  return m ? `0${m[1]}` : null;
}
