/**
 * EXTENSION POINTS for Protech's financial rules (Phases 3-6).
 * Interfaces only: the final interest formula, repayment allocation order, top-up
 * formula, penalties, overdue and completion rules are intentionally NOT implemented
 * until the business rules are supplied. Each will live behind one of these services
 * so changing a rule never touches controllers or the UI.
 */
export interface LoanCalculationService { calculateLoan(input: unknown): unknown }
export interface BalanceService { recalculate(loanId: string): Promise<unknown> }
export interface RepaymentAllocationService { allocate(loanId: string, amount: number): Promise<unknown> }
export interface TopUpCalculationService { calculate(loanId: string, amount: number): Promise<unknown> }
export interface LoanStatusService { resolveStatus(loanId: string): Promise<string> }

export class RuleNotConfiguredError extends Error {
  constructor(rule: string) { super(`Business rule "${rule}" has not been configured yet`); }
}
