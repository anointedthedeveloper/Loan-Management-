import type { Customer } from '../types'

export interface CustomerFormValues {
  firstName: string; middleName: string; lastName: string
  phone: string; altPhone: string; email: string
  address: string; state: string; lga: string
  dateOfBirth: string; gender: string
  idType: string; idNumber: string
  employmentType: string; employerName: string; occupation: string
  ecName: string; ecRelationship: string; ecPhone: string
  status: string; notes: string
}

export const emptyForm: CustomerFormValues = {
  firstName: '', middleName: '', lastName: '', phone: '', altPhone: '', email: '', address: '', state: '', lga: '',
  dateOfBirth: '', gender: '', idType: '', idNumber: '', employmentType: '', employerName: '', occupation: '',
  ecName: '', ecRelationship: '', ecPhone: '', status: 'active', notes: '',
}

export const fromCustomer = (c: Customer): CustomerFormValues => ({
  firstName: c.firstName, middleName: c.middleName ?? '', lastName: c.lastName, phone: c.phone, altPhone: c.altPhone ?? '', email: c.email ?? '',
  address: c.address, state: c.state ?? '', lga: c.lga ?? '', dateOfBirth: c.dateOfBirth ? c.dateOfBirth.slice(0, 10) : '', gender: c.gender ?? '',
  idType: c.idType ?? '', idNumber: c.idNumber ?? '', employmentType: c.employment?.employmentType ?? '', employerName: c.employment?.employerName ?? '',
  occupation: c.employment?.occupation ?? '', ecName: c.emergencyContact?.name ?? '', ecRelationship: c.emergencyContact?.relationship ?? '',
  ecPhone: c.emergencyContact?.phone ?? '', status: c.status, notes: c.notes ?? '',
})

/** Blank values are sent as '' so the server can clear them; the server is the source of truth for validation. */
export const toPayload = (v: CustomerFormValues) => ({
  firstName: v.firstName, middleName: v.middleName, lastName: v.lastName, phone: v.phone, altPhone: v.altPhone, email: v.email,
  address: v.address, state: v.state, lga: v.lga, dateOfBirth: v.dateOfBirth, gender: v.gender, idType: v.idType, idNumber: v.idNumber,
  employment: { employmentType: v.employmentType, employerName: v.employerName, occupation: v.occupation },
  emergencyContact: { name: v.ecName, relationship: v.ecRelationship, phone: v.ecPhone },
  status: v.status, notes: v.notes,
})

/** Quick client-side hints only; the API re-validates everything. */
export function quickValidate(v: CustomerFormValues): Record<string, string> {
  const e: Record<string, string> = {}
  if (!v.firstName.trim()) e.firstName = 'Enter first name'
  if (!v.lastName.trim()) e.lastName = 'Enter last name'
  if (!v.phone.trim()) e.phone = 'Enter phone number'
  if (!v.address.trim()) e.address = 'Enter residential address'
  if (v.email && !/^\S+@\S+\.\S+$/.test(v.email)) e.email = 'Enter a valid email address'
  if (v.idType && !v.idNumber) e.idNumber = 'Enter the identification number'
  if (v.idNumber && !v.idType) e.idType = 'Choose the identification type'
  return e
}

/** Server error keys (e.g. "employment.occupation", "emergencyContact.phone") -> form field names. */
export const serverKeyToField = (k: string) => ({ 'emergencyContact.phone': 'ecPhone', 'emergencyContact.name': 'ecName', 'emergencyContact.relationship': 'ecRelationship', 'employment.employmentType': 'employmentType', 'employment.employerName': 'employerName', 'employment.occupation': 'occupation' } as Record<string, string>)[k] ?? k
