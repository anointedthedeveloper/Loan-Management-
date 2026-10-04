import { z } from 'zod';
import { GENDERS, isCustomerStatus } from '../config/customerOptions.js';
import { normalizePhone } from '../utils/phone.js';
import { pageQuery } from './common.js';

/** Blank strings from forms become "not provided". */
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const text = (max = 200) => z.preprocess(blank, z.string().trim().max(max).optional());

const phone = (required: boolean) => {
  const base = z.string().transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a valid Nigerian mobile number (e.g. 0803 123 4567)' });
    return n ?? v;
  });
  return required ? z.preprocess(blank, base) : z.preprocess(blank, base.optional());
};

/** A required text field: blank is an error (never "not provided"). */
const req = (label: string, max = 200) => z.string({ error: `Enter ${label}` }).trim().min(1, `Enter ${label}`).max(max);
const requiredPhone = (label: string) => z.string({ error: `Enter ${label}` }).trim().min(1, `Enter ${label}`).transform((v, ctx) => {
  const n = normalizePhone(v);
  if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a valid Nigerian mobile number (e.g. 0803 123 4567)' });
  return n ?? v;
});
const requiredDob = z.preprocess(blank, z.coerce.date({ error: 'Enter date of birth' }).refine((d) => d < new Date(), 'Date of birth must be in the past'));
/** NIN and BVN are required for every customer: exactly 11 digits. */
const digits11 = (short: string, label: string) =>
  z.string({ error: `Enter the ${label}` }).trim().min(1, `Enter the ${label}`).regex(/^\d{11}$/, `A ${short} is exactly 11 digits`);
const requiredOneOf = (values: readonly { value: string }[], label: string) =>
  z.string({ error: `Choose ${label}` }).refine((v) => values.some((o) => o.value === v), `Choose ${label}`);

/**
 * Required for every customer: identity (name, date of birth, gender), contact (phone, email, address, state),
 * NIN and BVN, payroll (IPPIS number, ministry) and an emergency contact.
 * Optional: middle name, alternative phone, LGA, employment type/occupation/employer, notes.
 */
const body = {
  firstName: req('first name', 60),
  middleName: text(60),
  lastName: req('last name', 60),
  phone: requiredPhone('phone number'),
  altPhone: phone(false),
  email: z.string({ error: 'Enter email address' }).trim().toLowerCase().min(1, 'Enter email address').email('Enter a valid email address'),
  address: req('residential address', 300),
  state: req('state', 60),
  lga: text(80),
  dateOfBirth: requiredDob,
  gender: requiredOneOf(GENDERS, 'gender'),
  nin: digits11('NIN', 'National Identification Number (NIN)'),
  bvn: digits11('BVN', 'Bank Verification Number (BVN)'),
  employment: z.object({
    employerName: text(120), occupation: text(120),
    sector: z.enum(['government', 'non_government'], { error: 'Choose government or non-government worker' }),
    ippisNumber: z.preprocess(blank, z.string().trim().toUpperCase().max(40).optional()),
    ministry: text(120),
  }),
  emergencyContact: z.object({ name: req('emergency contact name', 100), relationship: text(60), phone: requiredPhone('emergency contact phone') }),
  legacyId: text(40),
  status: z.preprocess(blank, z.string().refine(isCustomerStatus, 'Choose a valid status').optional()),
  notes: text(2000),
  registrationDate: z.preprocess(blank, z.coerce.date().optional()),
};

/** Government workers must have an IPPIS number (and a ministry); non-government workers need neither. */
export const sectorRules = (e: { sector?: string; ippisNumber?: string; ministry?: string } | undefined, ctx: z.RefinementCtx) => {
  if (e?.sector !== 'government') return;
  if (!e.ippisNumber) ctx.addIssue({ code: 'custom', path: ['employment', 'ippisNumber'], message: 'Enter the IPPIS number (required for government workers)' });
  if (!e.ministry) ctx.addIssue({ code: 'custom', path: ['employment', 'ministry'], message: 'Enter ministry / department' });
};

export const createCustomerSchema = z.object(body).superRefine((v, ctx) => { sectorRules(v.employment, ctx); });
/** On update every field is optional, but any field that is sent must still be valid (required fields cannot be blanked); sector rules are re-checked on the merged record in the service. */
export const updateCustomerSchema = z.object({
  ...body,
  employment: body.employment.partial(),
  emergencyContact: body.emergencyContact.partial(),
}).partial();

const csv = (allowed: (v: string) => boolean) =>
  z.preprocess((v) => (typeof v === 'string' && v ? v.split(',').map((s) => s.trim()) : undefined), z.array(z.string().refine(allowed, 'Unknown status')).optional());

export const SORT_FIELDS = ['registrationDate', 'fullName', 'customerId', 'status', 'createdAt'] as const;
export const listCustomersSchema = z.object({
  ...pageQuery,
  q: z.string().trim().max(100).optional(),
  status: csv(isCustomerStatus),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(SORT_FIELDS).default('fullName'),
  order: z.enum(['asc', 'desc']).default('asc'),
});
export type ListCustomersQuery = z.infer<typeof listCustomersSchema>;
export type CustomerInput = z.infer<typeof createCustomerSchema>;
