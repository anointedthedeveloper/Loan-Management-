import { z } from 'zod';
import { PAYMENT_METHODS } from '../config/loanOptions.js';

const nonNegInt = z.coerce.number().int().min(0).max(3650);
const nullableInt = z.preprocess((v) => (v === '' || v === undefined ? null : v), z.coerce.number().int().min(1).max(3650).nullable());

/** Every settings section has a schema, so bad values can never reach the financial services. */
export const settingsSchemas = {
  company: z.object({
    name: z.string().trim().min(1, 'Enter company name').max(120),
    address: z.string().trim().max(300).default(''), phone: z.string().trim().max(40).default(''),
    email: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]).default(''),
    rcNumber: z.string().trim().max(40).default(''), currency: z.string().trim().length(3).default('NGN'),
  }),
  loans: z.object({
    requireApproval: z.boolean(), preventSelfApproval: z.boolean(), autoDisburseOnApproval: z.boolean(),
    maxActiveLoansPerCustomer: nullableInt, allowBackdatedStart: z.boolean(),
  }),
  repayment: z.object({
    allocationOrder: z.enum(['oldest_first', 'interest_first_overall']),
    withinInstallment: z.enum(['interest_first', 'principal_first', 'proportional']),
    overpaymentPolicy: z.enum(['reject', 'credit']), allowFutureDatedPayments: z.boolean(),
    earlySettlement: z.enum(['full_balance', 'waive_future_interest']).default('full_balance'),
  }),
  latePayment: z.object({ graceDays: nonNegInt, penalty: z.object({ type: z.literal('none') }), defaultAfterDays: nullableInt }),
  topup: z.object({
    requireApproval: z.boolean(), mode: z.enum(['consolidate', 'new_loan']),
    balanceBasis: z.enum(['outstanding_total', 'outstanding_principal']), interestBasis: z.enum(['full_principal', 'new_funds_only']),
    minimumPercentRepaid: z.coerce.number().min(0).max(100),
  }),
  transactions: z.object({ referenceRequiredFor: z.array(z.enum(PAYMENT_METHODS.map((m) => m.value) as [string, ...string[]])) }),
  preferences: z.object({ rowsPerPage: z.coerce.number().int().min(5).max(100) }),
};
