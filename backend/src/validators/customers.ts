import { z } from 'zod';
import { GENDERS, ID_TYPES, EMPLOYMENT_TYPES, isCustomerStatus } from '../config/customerOptions.js';
import { normalizePhone } from '../utils/phone.js';
import { pageQuery } from './common.js';

/** Blank strings from forms become "not provided". */
const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const text = (max = 200) => z.preprocess(blank, z.string().trim().max(max).optional());
const oneOf = (values: readonly { value: string }[], label: string) =>
  z.preprocess(blank, z.string().refine((v) => values.some((o) => o.value === v), `Choose a valid ${label}`).optional());

const phone = (required: boolean) => {
  const base = z.string().transform((v, ctx) => {
    const n = normalizePhone(v);
    if (!n) ctx.addIssue({ code: 'custom', message: 'Enter a valid Nigerian mobile number (e.g. 0803 123 4567)' });
    return n ?? v;
  });
  return required ? z.preprocess(blank, base) : z.preprocess(blank, base.optional());
};

const dob = z.preprocess(blank, z.coerce.date().refine((d) => d < new Date(), 'Date of birth must be in the past').optional());

const body = {
  firstName: z.preprocess(blank, z.string({ error: 'Enter first name' }).trim().min(1, 'Enter first name').max(60)),
  middleName: text(60),
  lastName: z.preprocess(blank, z.string({ error: 'Enter last name' }).trim().min(1, 'Enter last name').max(60)),
  phone: phone(true),
  altPhone: phone(false),
  email: z.preprocess(blank, z.string().trim().toLowerCase().email('Enter a valid email address').optional()),
  address: z.preprocess(blank, z.string({ error: 'Enter residential address' }).trim().min(3, 'Enter residential address').max(300)),
  state: text(60),
  lga: text(80),
  dateOfBirth: dob,
  gender: oneOf(GENDERS, 'gender'),
  idType: oneOf(ID_TYPES, 'identification type'),
  idNumber: z.preprocess(blank, z.string().trim().toUpperCase().regex(/^[A-Z0-9\-/]{4,30}$/, 'Enter a valid identification number').optional()),
  employment: z.object({ employmentType: oneOf(EMPLOYMENT_TYPES, 'employment type'), employerName: text(120), occupation: text(120) }).optional(),
  emergencyContact: z.object({ name: text(100), relationship: text(60), phone: phone(false) }).optional(),
  status: z.preprocess(blank, z.string().refine(isCustomerStatus, 'Choose a valid status').optional()),
  notes: text(2000),
  registrationDate: z.preprocess(blank, z.coerce.date().optional()),
};

const idPairing = (v: { idType?: string; idNumber?: string }, ctx: z.RefinementCtx) => {
  if (v.idType && !v.idNumber) ctx.addIssue({ code: 'custom', path: ['idNumber'], message: 'Enter the identification number' });
  if (v.idNumber && !v.idType) ctx.addIssue({ code: 'custom', path: ['idType'], message: 'Choose the identification type' });
};

export const createCustomerSchema = z.object(body).superRefine(idPairing);
export const updateCustomerSchema = z.object(body).partial().superRefine(idPairing);

const csv = (allowed: (v: string) => boolean) =>
  z.preprocess((v) => (typeof v === 'string' && v ? v.split(',').map((s) => s.trim()) : undefined), z.array(z.string().refine(allowed, 'Unknown status')).optional());

export const SORT_FIELDS = ['registrationDate', 'fullName', 'customerId', 'status', 'createdAt'] as const;
export const listCustomersSchema = z.object({
  ...pageQuery,
  q: z.string().trim().max(100).optional(),
  status: csv(isCustomerStatus),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  sort: z.enum(SORT_FIELDS).default('registrationDate'),
  order: z.enum(['asc', 'desc']).default('desc'),
});
export type ListCustomersQuery = z.infer<typeof listCustomersSchema>;
export type CustomerInput = z.infer<typeof createCustomerSchema>;
