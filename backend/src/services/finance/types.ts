import type { Frequency } from '../../config/loanOptions.js';

export type DurationUnit = 'days' | 'weeks' | 'months';
export type RateBasis = 'per_month' | 'per_annum' | 'per_loan';

/** Everything the engine needs to price a loan. Amounts are in naira; the engine works in kobo internally. */
export interface LoanTermsInput {
  /** Net amount the customer receives (the calculator's "Bank payment"). */
  amount: number;
  /** Outstanding balance rolled into the new loan (the calculator's "Balance B/Fwd"). */
  carriedBalance?: number;
  /** Deduction % grossed up so the customer still receives `amount` (calculator default 4). */
  bankDeductionRate?: number;
  interestRate: number;
  rateBasis: RateBasis;
  duration: { value: number; unit: DurationUnit };
  frequency: Frequency;
  customIntervalDays?: number;
  /** Override the derived installment count. */
  numberOfInstallments?: number;
  interestBasis?: 'full_principal' | 'new_funds_only';
  startDate: Date;
}

export interface LoanTerms {
  amount: number;
  carriedBalance: number;
  bankDeductionRate: number;
  grossAmount: number;
  principal: number;
  interestBase: number;
  interestAmount: number;
  totalRepayment: number;
  numberOfInstallments: number;
  installmentAmount: number;
  finalInstallmentAmount: number;
  durationMonths: number;
  startDate: Date;
  dueDate: Date;
}

export interface ScheduleInstallment {
  number: number;
  dueDate: Date;
  expectedAmount: number;
  principalComponent: number;
  interestComponent: number;
}

/** An installment's integer-kobo working state used while replaying repayments. */
export interface WorkingInstallment {
  number: number;
  dueDate: Date;
  principalKobo: number;
  interestKobo: number;
  paidPrincipalKobo: number;
  paidInterestKobo: number;
}

export interface RepaymentRules {
  allocationOrder: 'oldest_first' | 'interest_first_overall';
  withinInstallment: 'interest_first' | 'principal_first' | 'proportional';
  overpaymentPolicy: 'reject' | 'credit';
}
