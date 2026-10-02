import { installmentRemaining } from './LoanCalculationService.js';
import type { RepaymentRules, WorkingInstallment } from './types.js';

export interface Allocation { number: number; principal: number; interest: number } // kobo
export interface AllocationResult { allocations: Allocation[]; applied: number; unapplied: number }

/**
 * Decides how a payment is split across installments and between principal and interest.
 * Mutates the working installments (their paid fields) so repayments can be replayed in order.
 * The order is configuration (Settings > Repayment), not hard-coded.
 */
export function allocatePayment(installments: WorkingInstallment[], amountKobo: number, rules: RepaymentRules, target?: number): AllocationResult {
  const byNumber = new Map<number, Allocation>();
  const bucket = (n: number) => { let a = byNumber.get(n); if (!a) { a = { number: n, principal: 0, interest: 0 }; byNumber.set(n, a); } return a; };
  let left = amountKobo;

  const payInterest = (i: WorkingInstallment) => {
    const due = i.interestKobo - i.paidInterestKobo; const pay = Math.min(left, due);
    if (pay > 0) { i.paidInterestKobo += pay; bucket(i.number).interest += pay; left -= pay; }
  };
  const payPrincipal = (i: WorkingInstallment) => {
    const due = i.principalKobo - i.paidPrincipalKobo; const pay = Math.min(left, due);
    if (pay > 0) { i.paidPrincipalKobo += pay; bucket(i.number).principal += pay; left -= pay; }
  };
  const payProportional = (i: WorkingInstallment) => {
    const remaining = installmentRemaining(i); if (remaining <= 0) return;
    const pay = Math.min(left, remaining);
    const intDue = i.interestKobo - i.paidInterestKobo;
    const intPay = Math.min(intDue, Math.round((pay * intDue) / remaining));
    const prinPay = pay - intPay;
    i.paidInterestKobo += intPay; i.paidPrincipalKobo += prinPay;
    bucket(i.number).interest += intPay; bucket(i.number).principal += prinPay; left -= pay;
  };
  const payInstallment = (i: WorkingInstallment) => {
    if (rules.withinInstallment === 'principal_first') { payPrincipal(i); payInterest(i); }
    else if (rules.withinInstallment === 'proportional') payProportional(i);
    else { payInterest(i); payPrincipal(i); }
  };

  const ordered = [...installments].sort((a, b) => a.number - b.number);
  // A payment marked for a specific installment ("mark this month paid") settles that one first; any excess then follows the normal order.
  const targeted = target === undefined ? undefined : ordered.find((i) => i.number === target);
  if (targeted && left > 0) payInstallment(targeted);
  if (rules.allocationOrder === 'interest_first_overall') {
    for (const i of ordered) if (left > 0) payInterest(i);
    for (const i of ordered) if (left > 0) payPrincipal(i);
  } else {
    for (const i of ordered) if (left > 0) payInstallment(i);
  }
  return { allocations: [...byNumber.values()].sort((a, b) => a.number - b.number), applied: amountKobo - left, unapplied: left };
}
