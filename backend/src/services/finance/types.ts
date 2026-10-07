import type { Frequency } from '../../config/loanOptions.js';

export type DurationUnit = 'days' | 'weeks' | 'months';
export type RateBasis = 'per_month' | 'per_annum' | 'per_loan';

/** Everything the engine needs to price a loan. Amounts are in naira; the engine works in kobo internally. */
export interface LoanTermsInput {
  /** The requested loan amount. It is the principal. */
  amount: number;
  /** Outstanding balance rolled into the new loan (the calculator's "Balance B/Fwd"). */
  carriedBalance?: number;
  /** Application fee % of the requested amount. A standalone charge: never part of principal, interest, EMI or the balance. */
  applicationFeeRate?: number;
  interestRate: number;
  rateBasis: RateBasis;
  duration: { value: number; unit: DurationUnit };
  frequency: Frequency;
  customIntervalDays?: number;
  /** Override the derived installment count. */
  numberOfInstallments?: number;
  interestBasis?: 'full_principal' | 'new_funds_only';
  startDate: Date;
  /** Optional explicit date of the first installment (otherwise one period after startDate). */
  firstPaymentDate?: Date;
}

export interface LoanTerms {
  amount: number;
  carriedBalance: number;
  applicationFeeRate: number;
  /** Requested amount x application fee %. Standalone: not in principal, interest, total repayment or any balance. */
  applicationFee: number;
  principal: number;
  interestBase: number;
  interestAmount: number;
  /** Principal x rate for one month (display). The interest charge itself is fixed once, up front: this x tenor. */
  monthlyInterest: number;
  totalRepayment: number;
  numberOfInstallments: number;
  installmentAmount: number;
  finalInstallmentAmount: number;
  durationMonths: number;
  startDate: Date;
  /** The explicit first-payment date if one was supplied (kept so dates are always derived from the original anchor). */
  firstPaymentDate?: Date;
  firstDueDate: Date;
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
