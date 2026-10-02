import { calculateLoan } from './LoanCalculationService.js';
import type { LoanTerms, LoanTermsInput } from './types.js';

export interface TopUpRules {
  mode: 'consolidate' | 'new_loan';
  balanceBasis: 'outstanding_total' | 'outstanding_principal';
  interestBasis: 'full_principal' | 'new_funds_only';
  minimumPercentRepaid: number;
}
export interface ExistingLoanPosition { outstandingBalance: number; principalBalance: number; totalRepayment: number; amountPaid: number }
export interface TopUpResult {
  mode: TopUpRules['mode'];
  /** Existing obligation rolled into the new loan (the calculator's "Balance B/Fwd"). */
  carriedBalance: number;
  newFunds: number;
  percentRepaid: number;
  eligible: boolean;
  ineligibleReason?: string;
  terms: LoanTerms;
}

/**
 * Configurable top-up pricing. The exact Protech formula is NOT assumed: the mode and bases come
 * from Settings > Top-up rules. The default mirrors the reference calculator (carried balance +
 * new funds become the principal, interest recalculated on it).
 */
export function calculateTopUp(existing: ExistingLoanPosition, newFunds: number, pricing: Omit<LoanTermsInput, 'amount' | 'carriedBalance' | 'interestBasis'>, rules: TopUpRules): TopUpResult {
  const percentRepaid = existing.totalRepayment > 0 ? Math.round((existing.amountPaid / existing.totalRepayment) * 10000) / 100 : 0;
  const carried = rules.mode === 'consolidate' ? (rules.balanceBasis === 'outstanding_total' ? existing.outstandingBalance : existing.principalBalance) : 0;
  const eligible = percentRepaid >= rules.minimumPercentRepaid;
  const terms = calculateLoan({ ...pricing, amount: newFunds, carriedBalance: carried, interestBasis: rules.mode === 'consolidate' ? rules.interestBasis : 'full_principal' });
  return {
    mode: rules.mode, carriedBalance: carried, newFunds, percentRepaid, eligible,
    ...(eligible ? {} : { ineligibleReason: `At least ${rules.minimumPercentRepaid}% of the existing loan must be repaid (currently ${percentRepaid}%)` }),
    terms,
  };
}
