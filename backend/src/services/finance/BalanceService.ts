import { diffDays } from '../../utils/dates.js';
import { fromKobo, toKobo } from '../../utils/money.js';
import { allocatePayment, type Allocation } from './RepaymentAllocationService.js';
import {
  calculateInterestBalance, calculateOutstandingBalance, calculateOverdueAmount, calculatePrincipalBalance, installmentRemaining,
} from './LoanCalculationService.js';
import type { RepaymentRules, WorkingInstallment } from './types.js';

export type InstallmentStatus = 'upcoming' | 'due' | 'partially_paid' | 'paid' | 'overdue';

export interface PaymentEvent { id: string; amountKobo: number }
export interface InstallmentState {
  number: number; dueDate: Date; expectedAmount: number; principalComponent: number; interestComponent: number;
  paidPrincipal: number; paidInterest: number; amountPaid: number; remaining: number; status: InstallmentStatus;
}
export interface LoanState {
  installments: InstallmentState[];
  amountPaid: number; principalPaid: number; interestPaid: number;
  principalBalance: number; interestBalance: number; outstandingBalance: number; totalExpected: number;
  nextInstallmentNumber: number | null; nextDueDate: Date | null; nextInstallmentAmount: number;
  daysOverdue: number; overdueAmount: number; creditBalance: number; fullyPaid: boolean;
  /** Per-payment breakdown, recorded on each transaction for audit. */
  allocationsByPayment: Record<string, Allocation[]>;
}

export interface SchedulePlan { number: number; dueDate: Date; principalComponent: number; interestComponent: number }

/**
 * The ledger is the source of truth: derived balances are *replayed* from the payments in
 * chronological order against the original schedule. Reversing a payment therefore needs
 * no special maths: drop it from the list and recompute.
 */
export function computeLoanState(plan: SchedulePlan[], payments: PaymentEvent[], today: Date, rules: RepaymentRules, graceDays = 0): LoanState {
  const working: WorkingInstallment[] = plan.map((p) => ({
    number: p.number, dueDate: p.dueDate, principalKobo: toKobo(p.principalComponent), interestKobo: toKobo(p.interestComponent), paidPrincipalKobo: 0, paidInterestKobo: 0,
  }));
  const allocationsByPayment: Record<string, Allocation[]> = {};
  let credit = 0;
  for (const p of payments) {
    const r = allocatePayment(working, p.amountKobo, rules);
    allocationsByPayment[p.id] = r.allocations;
    credit += r.unapplied;
  }

  const installments: InstallmentState[] = working.map((w) => {
    const remaining = installmentRemaining(w);
    const paid = w.paidPrincipalKobo + w.paidInterestKobo;
    const late = diffDays(today, w.dueDate);
    let status: InstallmentStatus;
    if (remaining === 0) status = 'paid';
    else if (late > graceDays) status = 'overdue';
    else if (paid > 0) status = 'partially_paid';
    else if (late >= 0) status = 'due';
    else status = 'upcoming';
    return {
      number: w.number, dueDate: w.dueDate, expectedAmount: fromKobo(w.principalKobo + w.interestKobo),
      principalComponent: fromKobo(w.principalKobo), interestComponent: fromKobo(w.interestKobo),
      paidPrincipal: fromKobo(w.paidPrincipalKobo), paidInterest: fromKobo(w.paidInterestKobo), amountPaid: fromKobo(paid), remaining: fromKobo(remaining), status,
    };
  });

  const outstanding = calculateOutstandingBalance(working);
  const totalExpected = working.reduce((s, w) => s + w.principalKobo + w.interestKobo, 0);
  const next = working.find((w) => installmentRemaining(w) > 0);
  const overdue = working.filter((w) => installmentRemaining(w) > 0 && diffDays(today, w.dueDate) > graceDays);
  return {
    installments,
    amountPaid: fromKobo(working.reduce((s, w) => s + w.paidPrincipalKobo + w.paidInterestKobo, 0)),
    principalPaid: fromKobo(working.reduce((s, w) => s + w.paidPrincipalKobo, 0)),
    interestPaid: fromKobo(working.reduce((s, w) => s + w.paidInterestKobo, 0)),
    principalBalance: fromKobo(calculatePrincipalBalance(working)),
    interestBalance: fromKobo(calculateInterestBalance(working)),
    outstandingBalance: fromKobo(outstanding), totalExpected: fromKobo(totalExpected),
    nextInstallmentNumber: next?.number ?? null, nextDueDate: next?.dueDate ?? null,
    nextInstallmentAmount: next ? fromKobo(installmentRemaining(next)) : 0,
    daysOverdue: overdue.length ? Math.max(...overdue.map((w) => diffDays(today, w.dueDate))) : 0,
    overdueAmount: fromKobo(calculateOverdueAmount(working, today, graceDays)),
    creditBalance: fromKobo(credit), fullyPaid: totalExpected > 0 && outstanding === 0, allocationsByPayment,
  };
}
