import type { Customer } from '../types'

export interface CustomerFormValues {
  firstName: string; middleName: string; lastName: string
  phone: string; altPhone: string; email: string
  address: string; state: string; lga: string
  dateOfBirth: string; gender: string; maritalStatus: string
  nin: string; bvn: string
  sector: string; employerName: string; occupation: string; ippisNumber: string; ministry: string; legacyId: string
  ecName: string; ecRelationship: string; ecPhone: string
  status: string; notes: string
}

export const emptyForm: CustomerFormValues = {
  firstName: '', middleName: '', lastName: '', phone: '', altPhone: '', email: '', address: '', state: '', lga: '',
  dateOfBirth: '', gender: '', maritalStatus: '', nin: '', bvn: '', sector: '', employerName: '', occupation: '', ippisNumber: '', ministry: '', legacyId: '',
  ecName: '', ecRelationship: '', ecPhone: '', status: 'active', notes: '',
}

export const fromCustomer = (c: Customer): CustomerFormValues => ({
  firstName: c.firstName, middleName: c.middleName ?? '', lastName: c.lastName, phone: c.phone ?? '', altPhone: c.altPhone ?? '', email: c.email ?? '',
  address: c.address ?? '', state: c.state ?? '', lga: c.lga ?? '', dateOfBirth: c.dateOfBirth ? c.dateOfBirth.slice(0, 10) : '', gender: c.gender ?? '', maritalStatus: c.maritalStatus ?? '',
  nin: c.nin ?? '', bvn: c.bvn ?? '', sector: c.employment?.sector ?? (c.employment?.ippisNumber ? 'government' : ''), employerName: c.employment?.employerName ?? '',
  occupation: c.employment?.occupation ?? '', ippisNumber: c.employment?.ippisNumber ?? '', ministry: c.employment?.ministry ?? '', legacyId: c.legacyId ?? '', ecName: c.emergencyContact?.name ?? '', ecRelationship: c.emergencyContact?.relationship ?? '',
  ecPhone: c.emergencyContact?.phone ?? '', status: c.status, notes: c.notes ?? '',
})

/**
 * Blank values are sent as '' so the server can clear them; the server is the source of truth for validation.
 * When editing a profile that is still incomplete (e.g. imported from the old loan book), required details that were never filled in
 * are left out instead of being sent blank, so staff can complete the profile a piece at a time.
 */
export function toPayload(v: CustomerFormValues, original?: CustomerFormValues) {
  const skip = (k: keyof CustomerFormValues) => !!original && !String(original[k]).trim() && !String(v[k]).trim()
  const pick = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined)) as T
  const f = (k: keyof CustomerFormValues) => (skip(k) ? undefined : v[k])
  const gov = v.sector === 'government'
  return pick({
    firstName: f('firstName'), middleName: v.middleName, lastName: f('lastName'), phone: f('phone'), altPhone: v.altPhone, email: f('email'),
    address: f('address'), state: f('state'), lga: v.lga, dateOfBirth: f('dateOfBirth'), gender: f('gender'), maritalStatus: f('maritalStatus'), nin: f('nin'), bvn: f('bvn'),
    employment: pick({ sector: v.sector || undefined, occupation: v.occupation, ippisNumber: gov ? v.ippisNumber : skip('ippisNumber') ? undefined : '', ministry: v.ministry }),
    legacyId: v.legacyId,
    emergencyContact: pick({ name: f('ecName'), relationship: v.ecRelationship, phone: f('ecPhone') }),
    status: v.status, notes: v.notes,
  })
}

/** Quick client-side checks so people get instant feedback; the API re-validates everything. */
export function quickValidate(v: CustomerFormValues, original?: CustomerFormValues): Record<string, string> {
  const e: Record<string, string> = {}
  // when completing an incomplete profile, details that were never filled in are not forced; ones that exist cannot be blanked
  const need = (k: keyof CustomerFormValues, msg: string) => { if (!String(v[k]).trim() && !(original && !String(original[k]).trim())) e[k] = msg }
  need('firstName', 'Enter first name'); need('lastName', 'Enter last name'); need('dateOfBirth', 'Enter date of birth'); need('gender', 'Choose gender'); need('maritalStatus', 'Choose marital status')
  need('phone', 'Enter phone number'); need('email', 'Enter email address'); need('address', 'Enter residential address'); need('state', 'Enter state')
  need('nin', 'Enter the NIN'); need('bvn', 'Enter the BVN')
  if (v.nin && !/^\d{11}$/.test(v.nin.trim())) e.nin = 'A NIN is exactly 11 digits'
  if (v.bvn && !/^\d{11}$/.test(v.bvn.trim())) e.bvn = 'A BVN is exactly 11 digits'
  need('sector', 'Choose government or non-government worker')
  if (v.sector === 'government') { if (!v.ippisNumber.trim()) e.ippisNumber = 'Enter IPPIS number (required for government workers)'; if (!v.ministry.trim()) e.ministry = 'Enter ministry / department' }
  need('ecName', 'Enter emergency contact name'); need('ecPhone', 'Enter emergency contact phone')
  if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) e.email = 'Enter a valid email address'
  if (v.dateOfBirth && new Date(v.dateOfBirth) >= new Date()) e.dateOfBirth = 'Date of birth must be in the past'
  return e
}

/** Server error keys (e.g. "employment.occupation", "emergencyContact.phone") -> form field names. */
export const serverKeyToField = (k: string) => ({ 'emergencyContact.phone': 'ecPhone', 'emergencyContact.name': 'ecName', 'emergencyContact.relationship': 'ecRelationship', 'employment.sector': 'sector', 'employment.employerName': 'employerName', 'employment.occupation': 'occupation', 'employment.ippisNumber': 'ippisNumber', 'employment.ministry': 'ministry' } as Record<string, string>)[k] ?? k
