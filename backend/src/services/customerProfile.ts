/**
 * Which details a customer profile still lacks. Profiles imported from the old loan book only have a name, IPPIS and ministry;
 * this drives the "incomplete profile" reminders and filters. Keys are stable; labels are what people read.
 */
export const PROFILE_FIELDS: { key: string; label: string }[] = [
  { key: 'phone', label: 'Phone number' }, { key: 'email', label: 'Email' }, { key: 'address', label: 'Address' }, { key: 'state', label: 'State' },
  { key: 'dateOfBirth', label: 'Date of birth' }, { key: 'gender', label: 'Gender' }, { key: 'maritalStatus', label: 'Marital status' },
  { key: 'nin', label: 'NIN' }, { key: 'bvn', label: 'BVN' }, { key: 'sector', label: 'Worker type (government / non-government)' },
  { key: 'ippisNumber', label: 'IPPIS number' }, { key: 'ministry', label: 'Ministry / organisation' },
  { key: 'emergencyName', label: 'Next of kin name' }, { key: 'emergencyPhone', label: 'Next of kin phone' },
];

const has = (v: unknown) => (typeof v === 'string' ? v.trim() !== '' : v !== undefined && v !== null);

export function profileGaps(c: any): string[] {
  const e = c.employment ?? {}; const k = c.emergencyContact ?? {};
  const sector = e.sector ?? (has(e.ippisNumber) ? 'government' : undefined);
  const present: Record<string, boolean> = {
    phone: has(c.phone), email: has(c.email), address: has(c.address), state: has(c.state), dateOfBirth: has(c.dateOfBirth), gender: has(c.gender), maritalStatus: has(c.maritalStatus),
    nin: has(c.nin), bvn: has(c.bvn), sector: has(sector), ippisNumber: sector !== 'government' || has(e.ippisNumber), ministry: has(e.ministry),
    emergencyName: has(k.name), emergencyPhone: has(k.phone),
  };
  return PROFILE_FIELDS.filter((f) => !present[f.key]).map((f) => f.label);
}
