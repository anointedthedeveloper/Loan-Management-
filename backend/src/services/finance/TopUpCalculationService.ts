import { calculateLoan } from './LoanCalculationService.js';
import { fromKobo, toKobo } from '../../utils/money.js';
import type { LoanTerms, LoanTermsInput, RateBasis } from './types.js';

export interface TopUpRules {
  mode: 'consolidate' | 'new_loan';
  /** liquidation_formula: Protech's revised-tenor liquidation (see `liquidate`). */
  balanceBasis: 'outstanding_total' | 'outstanding_principal' | 'liquidation_formula';
  /** Liquidation fee, % of the outstanding balance (liquidation_formula only). */
  liquidationFeeRate?: number;
  interestBasis: 'full_principal' | 'new_funds_only';
  minimumPercentRepaid: number;
}
export interface ExistingLoanPosition {
  outstandingBalance: number; principalBalance: number; totalRepayment: number; amountPaid: number
  /** For the liquidation formula: the old loan's principal ("loan taken"), its rate and basis, and the tenor actually used (months). */
  loanTaken?: number; interestRate?: number; rateBasis?: RateBasis | string; revisedTenor?: number
}
/** The worked liquidation of the old loan, as on Protech's top-up sheet. */
export interface Liquidation { loanTaken: number; revisedTenor: number; revisedCost: number; paidToDate: number; outstanding: number; feeRate: number; fee: number; amountDue: number }
export interface TopUpResult {
  mode: TopUpRules['mode'];
  /** Existing obligation rolled into the new loan (the calculator's "Balance B/Fwd"). */
  carriedBalance: number;
  newFunds: number;
  percentRepaid: number;
  eligible: boolean;
  ineligibleReason?: string;
  liquidation?: Liquidation;
  terms: LoanTerms;
}

/**
 * Protech's top-up (liquidation) formula:
 *   (c) revised cost = loan taken x (1 + rate x months actually used)      (per-month loans; a one-time-interest loan keeps its full cost)
 *   (e) outstanding  = (c) - repayments made to date
 *   (f) fee          = liquidation fee % x (e)
 *   (g) amount due   = (e) + (f)      <- this is carried into the new loan as its balance brought forward
 */
export function liquidate(e: ExistingLoanPosition, feeRate: number): Liquidation {
  const taken = toKobo(e.loanTaken ?? e.principalBalance); const months = Math.max(1, e.revisedTenor ?? 1);
  const rate = (e.interestRate ?? 0) / 100;
  const cost = e.rateBasis === 'per_month' ? Math.round(taken * (1 + rate * months)) : e.rateBasis === 'per_annum' ? Math.round(taken * (1 + (rate * months) / 12)) : toKobo(e.totalRepayment);
  const outstanding = Math.max(0, cost - toKobo(e.amountPaid));
  const fee = Math.round((outstanding * feeRate) / 100);
  return { loanTaken: fromKobo(taken), revisedTenor: months, revisedCost: fromKobo(cost), paidToDate: e.amountPaid, outstanding: fromKobo(outstanding), feeRate, fee: fromKobo(fee), amountDue: fromKobo(outstanding + fee) };
}

/**
 * Configurable top-up pricing. The exact Protech formula is NOT assumed: the mode and bases come
 * from Settings > Top-up rules. The default mirrors the reference calculator (carried balance +
 * new funds become the principal, interest recalculated on it).
 */
export function calculateTopUp(existing: ExistingLoanPosition, newFunds: number, pricing: Omit<LoanTermsInput, 'amount' | 'carriedBalance' | 'interestBasis'>, rules: TopUpRules): TopUpResult {
  const percentRepaid = existing.totalRepayment > 0 ? Math.round((existing.amountPaid / existing.totalRepayment) * 10000) / 100 : 0;
  const liquidation = rules.mode === 'consolidate' && rules.balanceBasis === 'liquidation_formula' ? liquidate(existing, rules.liquidationFeeRate ?? 5) : undefined;
  const carried = rules.mode === 'consolidate' ? (liquidation ? liquidation.amountDue : rules.balanceBasis === 'outstanding_total' ? existing.outstandingBalance : existing.principalBalance) : 0;
  const eligible = percentRepaid >= rules.minimumPercentRepaid;
  const terms = calculateLoan({ ...pricing, amount: newFunds, carriedBalance: carried, interestBasis: rules.mode === 'consolidate' ? rules.interestBasis : 'full_principal' });
  return {
    mode: rules.mode, carriedBalance: carried, newFunds, percentRepaid, eligible, ...(liquidation ? { liquidation } : {}),
    ...(eligible ? {} : { ineligibleReason: `At least ${rules.minimumPercentRepaid}% of the existing loan must be repaid (currently ${percentRepaid}%)` }),
    terms,
  };
}
