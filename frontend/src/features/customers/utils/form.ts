import type { Customer } from '../types'

export interface CustomerFormValues {
  firstName: string; middleName: string; lastName: string
  phone: string; altPhone: string; email: string
  address: string; state: string; lga: string
  dateOfBirth: string; gender: string
  idType: string; idNumber: string
  employmentType: string; employerName: string; occupation: string; ippisNumber: string; ministry: string; legacyId: string
  ecName: string; ecRelationship: string; ecPhone: string
  status: string; notes: string
}

export const emptyForm: CustomerFormValues = {
  firstName: '', middleName: '', lastName: '', phone: '', altPhone: '', email: '', address: '', state: '', lga: '',
  dateOfBirth: '', gender: '', idType: '', idNumber: '', employmentType: '', employerName: '', occupation: '', ippisNumber: '', ministry: '', legacyId: '',
  ecName: '', ecRelationship: '', ecPhone: '', status: 'active', notes: '',
}

export const fromCustomer = (c: Customer): CustomerFormValues => ({
  firstName: c.firstName, middleName: c.middleName ?? '', lastName: c.lastName, phone: c.phone, altPhone: c.altPhone ?? '', email: c.email ?? '',
  address: c.address, state: c.state ?? '', lga: c.lga ?? '', dateOfBirth: c.dateOfBirth ? c.dateOfBirth.slice(0, 10) : '', gender: c.gender ?? '',
  idType: c.idType ?? '', idNumber: c.idNumber ?? '', employmentType: c.employment?.employmentType ?? '', employerName: c.employment?.employerName ?? '',
  occupation: c.employment?.occupation ?? '', ippisNumber: c.employment?.ippisNumber ?? '', ministry: c.employment?.ministry ?? '', legacyId: c.legacyId ?? '', ecName: c.emergencyContact?.name ?? '', ecRelationship: c.emergencyContact?.relationship ?? '',
  ecPhone: c.emergencyContact?.phone ?? '', status: c.status, notes: c.notes ?? '',
})

/** Blank values are sent as '' so the server can clear them; the server is the source of truth for validation. */
export const toPayload = (v: CustomerFormValues) => ({
  firstName: v.firstName, middleName: v.middleName, lastName: v.lastName, phone: v.phone, altPhone: v.altPhone, email: v.email,
  address: v.address, state: v.state, lga: v.lga, dateOfBirth: v.dateOfBirth, gender: v.gender, idType: v.idType, idNumber: v.idNumber,
  employment: { employmentType: v.employmentType, employerName: v.employerName, occupation: v.occupation, ippisNumber: v.ippisNumber, ministry: v.ministry },
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
  need('idType', 'Choose the identification type'); need('idNumber', 'Enter the identification number')
  need('ippisNumber', 'Enter IPPIS number'); need('ministry', 'Enter ministry / department')
  need('ecName', 'Enter emergency contact name'); need('ecPhone', 'Enter emergency contact phone')
  if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) e.email = 'Enter a valid email address'
  if (v.dateOfBirth && new Date(v.dateOfBirth) >= new Date()) e.dateOfBirth = 'Date of birth must be in the past'
  if ((v.idType === 'nin' || v.idType === 'bvn') && v.idNumber && !/^\d{11}$/.test(v.idNumber.trim())) e.idNumber = `A ${v.idType.toUpperCase()} is exactly 11 digits`
  return e
}

/** Server error keys (e.g. "employment.occupation", "emergencyContact.phone") -> form field names. */
export const serverKeyToField = (k: string) => ({ 'emergencyContact.phone': 'ecPhone', 'emergencyContact.name': 'ecName', 'emergencyContact.relationship': 'ecRelationship', 'employment.employmentType': 'employmentType', 'employment.employerName': 'employerName', 'employment.occupation': 'occupation', 'employment.ippisNumber': 'ippisNumber', 'employment.ministry': 'ministry' } as Record<string, string>)[k] ?? k
