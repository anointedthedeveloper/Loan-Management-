/**
 * Loan / ledger reference data. Add a row to introduce a status, frequency or transaction type.
 * Flags describe behaviour so services never compare against literal strings in many places.
 */
export const LOAN_STATUSES = [
  { value: 'pending', label: 'Pending', tone: 'amber', manual: true, acceptsRepayments: false },
  { value: 'approved', label: 'Approved', tone: 'blue', manual: true, acceptsRepayments: false },
  { value: 'active', label: 'Active', tone: 'green', manual: false, acceptsRepayments: true },
  { value: 'overdue', label: 'Overdue', tone: 'red', manual: false, acceptsRepayments: true },
  { value: 'completed', label: 'Completed', tone: 'slate', manual: false, acceptsRepayments: false },
  { value: 'defaulted', label: 'Defaulted', tone: 'red', manual: true, acceptsRepayments: true },
  { value: 'rejected', label: 'Rejected', tone: 'slate', manual: true, acceptsRepayments: false },
  { value: 'cancelled', label: 'Cancelled', tone: 'slate', manual: true, acceptsRepayments: false },
] as const;
/** `manual` statuses are set by workflow actions and are never auto-resolved from balances. */
export const loanStatus = (v: string) => LOAN_STATUSES.find((s) => s.value === v);
export const isLoanStatus = (v: string) => !!loanStatus(v);
export const LIVE_LOAN_STATUSES = ['active', 'overdue', 'defaulted'] as const; // carry an outstanding obligation

export const FREQUENCIES = [
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'custom', label: 'Custom interval (days)' },
] as const;
export type Frequency = (typeof FREQUENCIES)[number]['value'];
export const isFrequency = (v: string): v is Frequency => FREQUENCIES.some((f) => f.value === v);

export const DURATION_UNITS = [{ value: 'days', label: 'Days' }, { value: 'weeks', label: 'Weeks' }, { value: 'months', label: 'Months' }] as const;
export const RATE_BASES = [
  { value: 'per_month', label: '% per month, flat on the principal (5% x 12 months = 60% of the principal)' },
  { value: 'per_loan', label: '% one-time flat charge on the principal (e.g. 5% of ₦1,000,000 = ₦50,000)' },
  { value: 'per_annum', label: '% per annum, pro-rated' },
] as const;

export const INSTALLMENT_STATUSES = ['upcoming', 'due', 'partially_paid', 'paid', 'overdue'] as const;

export const PAYMENT_METHODS = [
  { value: 'cash', label: 'Cash' }, { value: 'bank_transfer', label: 'Bank transfer' }, { value: 'pos', label: 'POS' },
  { value: 'cheque', label: 'Cheque' }, { value: 'mobile_money', label: 'Mobile money' }, { value: 'other', label: 'Other' },
] as const;

/** direction: money in/out of Protech's books. `manual` = may be created through POST /transactions. */
export const TRANSACTION_TYPES = [
  { value: 'disbursement', label: 'Loan disbursement', direction: 'out', manual: false, reversible: false },
  { value: 'repayment', label: 'Repayment', direction: 'in', manual: false, reversible: true },
  { value: 'topup', label: 'Top-up', direction: 'out', manual: false, reversible: false },
  { value: 'adjustment', label: 'Adjustment', direction: 'none', manual: true, reversible: true },
  { value: 'fee', label: 'Fee', direction: 'in', manual: true, reversible: true },
  { value: 'refund', label: 'Refund', direction: 'out', manual: true, reversible: true },
  { value: 'waiver', label: 'Interest waiver', direction: 'none', manual: false, reversible: true },
  { value: 'reversal', label: 'Reversal', direction: 'none', manual: false, reversible: false },
  { value: 'other', label: 'Other', direction: 'none', manual: true, reversible: true },
] as const;
export const transactionType = (v: string) => TRANSACTION_TYPES.find((t) => t.value === v);

/**
 * Protech's monthly repayment cycle: deductions are collected from the 25th, and the installment is due on the
 * 30th (the last day of the month in February: 28/29), whatever day in the previous month the loan started.
 */
export const REPAYMENT_CYCLE = { opensDay: 25, dueDay: 30 } as const;
/** Day the payment window opens for the cycle that ends on `due` (undefined for loans on a custom first-payment date). */
export const windowOpens = (due: Date) => (due.getUTCDate() >= REPAYMENT_CYCLE.opensDay ? new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), REPAYMENT_CYCLE.opensDay)) : undefined);
