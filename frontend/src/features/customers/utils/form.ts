import type { Customer } from '../types'

export interface CustomerFormValues {
  firstName: string; middleName: string; lastName: string
  phone: string; altPhone: string; email: string
  address: string; state: string; lga: string
  dateOfBirth: string; gender: string
  nin: string; bvn: string
  sector: string; employerName: string; occupation: string; ippisNumber: string; ministry: string; legacyId: string
  ecName: string; ecRelationship: string; ecPhone: string
  status: string; notes: string
}

export const emptyForm: CustomerFormValues = {
  firstName: '', middleName: '', lastName: '', phone: '', altPhone: '', email: '', address: '', state: '', lga: '',
  dateOfBirth: '', gender: '', nin: '', bvn: '', sector: '', employerName: '', occupation: '', ippisNumber: '', ministry: '', legacyId: '',
  ecName: '', ecRelationship: '', ecPhone: '', status: 'active', notes: '',
}

export const fromCustomer = (c: Customer): CustomerFormValues => ({
  firstName: c.firstName, middleName: c.middleName ?? '', lastName: c.lastName, phone: c.phone, altPhone: c.altPhone ?? '', email: c.email ?? '',
  address: c.address, state: c.state ?? '', lga: c.lga ?? '', dateOfBirth: c.dateOfBirth ? c.dateOfBirth.slice(0, 10) : '', gender: c.gender ?? '',
  nin: c.nin ?? '', bvn: c.bvn ?? '', sector: c.employment?.sector ?? (c.employment?.ippisNumber ? 'government' : ''), employerName: c.employment?.employerName ?? '',
  occupation: c.employment?.occupation ?? '', ippisNumber: c.employment?.ippisNumber ?? '', ministry: c.employment?.ministry ?? '', legacyId: c.legacyId ?? '', ecName: c.emergencyContact?.name ?? '', ecRelationship: c.emergencyContact?.relationship ?? '',
  ecPhone: c.emergencyContact?.phone ?? '', status: c.status, notes: c.notes ?? '',
})

/** Blank values are sent as '' so the server can clear them; the server is the source of truth for validation. */
export const toPayload = (v: CustomerFormValues) => ({
  firstName: v.firstName, middleName: v.middleName, lastName: v.lastName, phone: v.phone, altPhone: v.altPhone, email: v.email,
  address: v.address, state: v.state, lga: v.lga, dateOfBirth: v.dateOfBirth, gender: v.gender, nin: v.nin, bvn: v.bvn,
  employment: { sector: v.sector, employerName: v.employerName, occupation: v.occupation, ippisNumber: v.sector === 'government' ? v.ippisNumber : '', ministry: v.sector === 'government' ? v.ministry : '' },
  legacyId: v.legacyId,
  emergencyContact: { name: v.ecName, relationship: v.ecRelationship, phone: v.ecPhone },
  status: v.status, notes: v.notes,
})

/** Quick client-side checks so people get instant feedback; the API re-validates everything. */
export function quickValidate(v: CustomerFormValues): Record<string, string> {
  const e: Record<string, string> = {}
  const need = (k: keyof CustomerFormValues, msg: string) => { if (!String(v[k]).trim()) e[k] = msg }
  need('firstName', 'Enter first name'); need('lastName', 'Enter last name'); need('dateOfBirth', 'Enter date of birth'); need('gender', 'Choose gender')
  need('phone', 'Enter phone number'); need('email', 'Enter email address'); need('address', 'Enter residential address'); need('state', 'Enter state')
  need('nin', 'Enter the NIN'); need('bvn', 'Enter the BVN')
  if (v.nin && !/^\d{11}$/.test(v.nin.trim())) e.nin = 'A NIN is exactly 11 digits'
  if (v.bvn && !/^\d{11}$/.test(v.bvn.trim())) e.bvn = 'A BVN is exactly 11 digits'
  need('sector', 'Choose government or non-government worker')
  if (v.sector === 'government') { need('ippisNumber', 'Enter IPPIS number (required for government workers)'); need('ministry', 'Enter ministry / department') }
  need('ecName', 'Enter emergency contact name'); need('ecPhone', 'Enter emergency contact phone')
  if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) e.email = 'Enter a valid email address'
  if (v.dateOfBirth && new Date(v.dateOfBirth) >= new Date()) e.dateOfBirth = 'Date of birth must be in the past'
  return e
}

/** Server error keys (e.g. "employment.occupation", "emergencyContact.phone") -> form field names. */
export const serverKeyToField = (k: string) => ({ 'emergencyContact.phone': 'ecPhone', 'emergencyContact.name': 'ecName', 'emergencyContact.relationship': 'ecRelationship', 'employment.sector': 'sector', 'employment.employerName': 'employerName', 'employment.occupation': 'occupation', 'employment.ippisNumber': 'ippisNumber', 'employment.ministry': 'ministry' } as Record<string, string>)[k] ?? k
