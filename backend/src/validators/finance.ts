import { z } from 'zod';
import { DURATION_UNITS, FREQUENCIES, PAYMENT_METHODS, RATE_BASES, TRANSACTION_TYPES, isLoanStatus } from '../config/loanOptions.js';
import { dateOnly } from '../utils/dates.js';
import { objectId, pageQuery } from './common.js';

const blank = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const vals = <T extends readonly { value: string }[]>(l: T) => l.map((x) => x.value) as [string, ...string[]];
const money = (label = 'Amount') => z.coerce.number({ error: `Enter ${label.toLowerCase()}` }).positive(`${label} must be greater than zero`).max(1e12)
  .refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Use at most 2 decimal places');
const optMoney = z.preprocess(blank, z.coerce.number().min(0).optional());
const date = z.preprocess(blank, z.coerce.date().transform(dateOnly));
const optDate = z.preprocess(blank, z.coerce.date().transform(dateOnly).optional());
const text = (max = 500) => z.preprocess(blank, z.string().trim().max(max).optional());
const csv = z.preprocess((v) => (typeof v === 'string' && v ? v.split(',').map((s) => s.trim()) : undefined), z.array(z.string()).optional());

/* ---------- loan products ---------- */
const productBody = (create: boolean) => ({
  name: z.string().trim().min(2, 'Enter product name').max(80),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{2,20}$/, '2-20 letters, numbers, - _'),
  description: text(300),
  category: dflt(z.string().trim().min(1, 'Enter a category').max(60), 'General', create),
  interestRate: z.coerce.number().min(0, 'Rate cannot be negative').max(100),
  rateBasis: dflt(z.enum(vals(RATE_BASES)), 'per_month', create),
  bankDeductionRate: dflt(z.coerce.number().min(0).max(99), 0, create),
  minAmount: dflt(z.coerce.number().min(0), 0, create),
  maxAmount: z.preprocess(blank, z.coerce.number().positive().optional()),
  minDuration: dflt(z.coerce.number().int().min(1), 1, create),
  maxDuration: z.preprocess(blank, z.coerce.number().int().min(1).optional()),
  durationUnit: dflt(z.enum(vals(DURATION_UNITS)), 'months', create),
  allowedFrequencies: z.array(z.enum(vals(FREQUENCIES))).min(1, 'Choose at least one frequency'),
  defaultFrequency: z.enum(vals(FREQUENCIES)),
  isActive: dflt(z.boolean(), true, create),
});
/** Defaults apply when creating only; a PATCH must never reset fields the caller did not send. */
const dflt = <T extends z.ZodType>(schema: T, value: z.infer<T>, create: boolean) => (create ? schema.default(value as never) : schema);
const productRules = (v: { minAmount?: number; maxAmount?: number; minDuration?: number; maxDuration?: number; allowedFrequencies?: string[]; defaultFrequency?: string }, ctx: z.RefinementCtx) => {
  if (v.maxAmount !== undefined && v.minAmount !== undefined && v.maxAmount < v.minAmount) ctx.addIssue({ code: 'custom', path: ['maxAmount'], message: 'Maximum must not be below the minimum' });
  if (v.maxDuration !== undefined && v.minDuration !== undefined && v.maxDuration < v.minDuration) ctx.addIssue({ code: 'custom', path: ['maxDuration'], message: 'Maximum must not be below the minimum' });
  if (v.defaultFrequency && v.allowedFrequencies && !v.allowedFrequencies.includes(v.defaultFrequency)) ctx.addIssue({ code: 'custom', path: ['defaultFrequency'], message: 'Default must be one of the allowed frequencies' });
};
export const createProductSchema = z.object(productBody(true)).superRefine(productRules);
export const updateProductSchema = z.object(productBody(false)).partial().superRefine(productRules);

/* ---------- loans ---------- */
const pricing = {
  productId: objectId,
  amount: money('Loan amount'),
  duration: z.object({ value: z.coerce.number().int().min(1, 'Enter duration').max(1200), unit: z.enum(vals(DURATION_UNITS)) }).optional(),
  frequency: z.preprocess(blank, z.enum(vals(FREQUENCIES)).optional()),
  customIntervalDays: z.preprocess(blank, z.coerce.number().int().min(1).max(365).optional()),
  numberOfInstallments: z.preprocess(blank, z.coerce.number().int().min(1).max(1000).optional()),
  startDate: date,
  firstPaymentDate: optDate,
};
export const previewLoanSchema = z.object({ ...pricing, customerId: objectId.optional() });
export const createLoanSchema = z.object({ ...pricing, customerId: objectId, notes: text(1000) });
/** `interestRate` / `bankDeductionRate` / `reason` are only honoured when editing a running loan (needs loans.editActive). */
export const updateLoanSchema = z.object({
  ...pricing, notes: text(1000),
  interestRate: z.preprocess(blank, z.coerce.number().min(0).max(100).optional()),
  bankDeductionRate: z.preprocess(blank, z.coerce.number().min(0).max(99).optional()),
  reason: text(300),
}).partial();
export const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Please give a reason').max(500) });
export const optionalReasonSchema = z.object({ reason: text(500) });

export const listLoansSchema = z.object({
  ...pageQuery,
  q: z.string().trim().max(100).optional(),
  /** `open` (default) hides completed loans, `completed` shows only them. An explicit status filter overrides it. */
  scope: z.enum(['open', 'completed', 'all']).default('open'),
  status: csv, customer: objectId.optional(), createdBy: objectId.optional(), product: objectId.optional(),
  repaymentStatus: z.enum(['unpaid', 'partial', 'paid', 'overdue']).optional(),
  from: optDate, to: optDate,
  minAmount: z.preprocess(blank, z.coerce.number().min(0).optional()), maxAmount: z.preprocess(blank, z.coerce.number().min(0).optional()),
  sort: z.enum(['createdAt', 'loanId', 'amount', 'startDate', 'dueDate', 'outstandingBalance', 'status']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
}).superRefine((v, ctx) => { if (v.status?.some((s) => !isLoanStatus(s))) ctx.addIssue({ code: 'custom', path: ['status'], message: 'Unknown status' }); });

/* ---------- repayments & transactions ---------- */
const txCommon = {
  date: optDate,
  method: z.preprocess(blank, z.enum(vals(PAYMENT_METHODS)).optional()),
  reference: z.preprocess(blank, z.string().trim().max(80).optional()),
  description: text(300),
  /** Files uploaded beforehand (POST /attachments) as proof of payment: debit/credit alert, receipt... */
  attachmentIds: z.array(objectId).max(5, 'At most 5 files per payment').optional(),
};
/** `amount` lets the user change what was paid; blank means "exactly what is still owed". */
export const markPaidSchema = z.object({ ...txCommon, amount: z.preprocess(blank, money('Amount paid').optional()) });
export const editRepaymentSchema = z.object({ ...txCommon, amount: money('Amount paid'), reason: z.string({ error: 'Enter the reason for the change' }).trim().min(3, 'Enter the reason for the change').max(300) });
export const settleSchema = z.object({ ...txCommon });
export const scheduleExportSchema = z.object({ format: z.enum(['pdf', 'xlsx', 'csv']).default('pdf') });
export const settlementQuerySchema = z.object({ date: optDate });
export const recordRepaymentSchema = z.object({ loanId: objectId, amount: money('Payment amount'), ...txCommon });
export const manualTransactionSchema = z.object({
  type: z.enum(vals(TRANSACTION_TYPES.filter((t) => t.manual))),
  customerId: objectId.optional(), loanId: objectId.optional(), amount: money(), ...txCommon,
}).refine((v) => v.customerId || v.loanId, { path: ['customerId'], message: 'Choose a customer or a loan' });

export const listTransactionsSchema = z.object({
  ...pageQuery,
  q: z.string().trim().max(100).optional(),
  type: z.preprocess(blank, z.enum(vals(TRANSACTION_TYPES)).optional()),
  method: z.preprocess(blank, z.enum(vals(PAYMENT_METHODS)).optional()),
  loan: objectId.optional(), customer: objectId.optional(), createdBy: objectId.optional(),
  state: z.enum(['posted', 'reversed']).optional(),
  from: optDate, to: optDate,
  minAmount: z.preprocess(blank, z.coerce.number().min(0).optional()), maxAmount: z.preprocess(blank, z.coerce.number().min(0).optional()),
  sort: z.enum(['date', 'amount', 'transactionId', 'createdAt']).default('date'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

/* ---------- top-ups ---------- */
const topUpPricing = {
  loanId: objectId,
  amount: money('Top-up amount'),
  duration: z.object({ value: z.coerce.number().int().min(1).max(1200), unit: z.enum(vals(DURATION_UNITS)) }),
  frequency: z.enum(vals(FREQUENCIES)),
  customIntervalDays: z.preprocess(blank, z.coerce.number().int().min(1).max(365).optional()),
  interestRate: z.preprocess(blank, z.coerce.number().min(0).max(100).optional()),
  startDate: optDate,
};
export const previewTopUpSchema = z.object(topUpPricing);
export const requestTopUpSchema = z.object({ ...topUpPricing, notes: text(1000) });
export const listTopUpsSchema = z.object({
  ...pageQuery, status: z.preprocess(blank, z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional()),
  customer: objectId.optional(), loan: objectId.optional(), from: optDate, to: optDate,
});

/* ---------- reports & audit ---------- */
export const reportQuerySchema = z.object({
  from: optDate, to: optDate,
  format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
  ...pageQuery, limit: z.coerce.number().int().min(1).max(5000).default(50),
  status: csv, customer: objectId.optional(),
});
export const statementQuerySchema = z.object({ from: optDate, to: optDate, format: z.enum(['json', 'pdf', 'xlsx', 'csv']).default('json') });
export const pageViewSchema = z.object({ path: z.string().trim().min(1).max(200).regex(/^\//, 'Must be an app path'), title: z.string().trim().max(100).optional() });
export const listAuditSchema = z.object({
  ...pageQuery, q: z.string().trim().max(100).optional(), action: csv, entity: z.string().trim().max(50).optional(),
  user: objectId.optional(), role: z.string().trim().max(30).optional(), category: z.enum(['navigation', 'auth', 'changes']).optional(), from: optDate, to: optDate,
});
