import { describe, expect, it } from 'vitest';
import {
  calculateInstallment, calculateInterest, calculateLoan, calculateOutstandingBalance, calculatePrincipalBalance, calculateInterestBalance,
  calculateOverdueAmount, calculateTotalPayable, calculateTopUp, computeLoanState, generateSchedule, resolveStatus, allocatePayment,
  type RepaymentRules, type WorkingInstallment, type LoanTermsInput,
} from '../src/services/finance/index.js';
import { utcDate, addMonths } from '../src/utils/dates.js';
import { toKobo, splitEvenly } from '../src/utils/money.js';

const start = utcDate(2026, 0, 31);
const base: LoanTermsInput = { amount: 960_000, bankDeductionRate: 4, interestRate: 5, rateBasis: 'per_month', duration: { value: 6, unit: 'months' }, frequency: 'monthly', startDate: start };
const rules: RepaymentRules = { allocationOrder: 'oldest_first', withinInstallment: 'interest_first', overpaymentPolicy: 'reject' };
const plan = (t = calculateLoan(base), f: any = 'monthly') => generateSchedule(t, f).map((s) => ({ number: s.number, dueDate: s.dueDate, principalComponent: s.principalComponent, interestComponent: s.interestComponent }));

describe('flat interest calculation (matches the reference calculator)', () => {
  it('grosses up the bank deduction, then applies flat monthly interest', () => {
    const t = calculateLoan(base);
    expect(t.grossAmount).toBe(1_000_000); // 960,000 / 0.96
    expect(t.principal).toBe(1_000_000);
    expect(t.interestAmount).toBe(300_000); // 1,000,000 x 5% x 6
    expect(t.totalRepayment).toBe(1_300_000);
    expect(t.numberOfInstallments).toBe(6);
  });
  it('works without a bank deduction and with other rate bases', () => {
    expect(calculateLoan({ ...base, bankDeductionRate: 0, amount: 100_000, interestRate: 10, duration: { value: 3, unit: 'months' } }).interestAmount).toBe(30_000);
    expect(calculateLoan({ ...base, bankDeductionRate: 0, amount: 100_000, interestRate: 24, rateBasis: 'per_annum' }).interestAmount).toBe(12_000); // 24% p.a. x 6/12
    expect(calculateLoan({ ...base, bankDeductionRate: 0, amount: 100_000, interestRate: 12, rateBasis: 'per_loan' }).interestAmount).toBe(12_000);
  });
  it('exposes the individual calculation steps', () => {
    expect(calculateInterest(toKobo(1_000_000), 5, 'per_month', 6)).toBe(toKobo(300_000));
    expect(calculateTotalPayable(10, 5)).toBe(15);
  });
  it('rejects invalid inputs', () => {
    expect(() => calculateLoan({ ...base, amount: 0 })).toThrow();
    expect(() => calculateLoan({ ...base, bankDeductionRate: 100 })).toThrow();
  });
});

describe('installments and rounding', () => {
  it('splits evenly and puts the kobo remainder on the last installment', () => {
    const t = calculateLoan(base);
    expect(t.installmentAmount).toBe(216_666.67); // 1,300,000 / 6 rounded to the nearest kobo
    expect(t.finalInstallmentAmount).toBe(216_666.65); // absorbs the difference so the total is exact
    expect(calculateInstallment(130_000_000, 6)).toEqual({ regular: 21_666_667, last: 21_666_665 });
    expect(splitEvenly(10, 3)).toEqual([3, 3, 4]);
  });
  it('schedule components sum exactly to principal, interest and total', () => {
    const t = calculateLoan(base);
    const s = generateSchedule(t, 'monthly');
    const sum = (k: 'principalComponent' | 'interestComponent' | 'expectedAmount') => Math.round(s.reduce((a, i) => a + i[k] * 100, 0)) / 100;
    expect([sum('principalComponent'), sum('interestComponent'), sum('expectedAmount')]).toEqual([1_000_000, 300_000, 1_300_000]);
  });
});

describe('quoted installment equals the schedule', () => {
  it('every installment but the last equals installmentAmount; the last equals finalInstallmentAmount', () => {
    for (const [amount, months, rate] of [[960_000, 6, 5], [50_000, 7, 10], [333_333.33, 5, 3.7], [1_234_567.89, 9, 4.25]] as const) {
      const t = calculateLoan({ ...base, amount, bankDeductionRate: 0, interestRate: rate, duration: { value: months, unit: 'months' } });
      const s = generateSchedule(t, 'monthly');
      expect(s.slice(0, -1).every((i) => i.expectedAmount === t.installmentAmount)).toBe(true);
      expect(s[s.length - 1]!.expectedAmount).toBe(t.finalInstallmentAmount);
      const cents = (xs: number[]) => Math.round(xs.reduce((a, b) => a + b, 0) * 100);
      expect(cents(s.map((i) => i.expectedAmount))).toBe(Math.round(t.totalRepayment * 100));
      expect(cents(s.map((i) => i.principalComponent))).toBe(Math.round(t.principal * 100));
      expect(cents(s.map((i) => i.interestComponent))).toBe(Math.round(t.interestAmount * 100));
    }
  });
});

describe('repayment schedule generation', () => {
  it('monthly: clamps month ends and numbers installments', () => {
    const s = generateSchedule(calculateLoan(base), 'monthly');
    expect(s.map((i) => i.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(s[0]!.dueDate.toISOString().slice(0, 10)).toBe('2026-02-28'); // 31 Jan + 1 month
    expect(s[5]!.dueDate.toISOString().slice(0, 10)).toBe('2026-07-31');
    expect(addMonths(utcDate(2024, 0, 31), 1).toISOString().slice(0, 10)).toBe('2024-02-29'); // leap year
  });
  it('weekly, bi-weekly, daily and custom frequencies derive counts and dates', () => {
    const w = calculateLoan({ ...base, frequency: 'weekly', duration: { value: 8, unit: 'weeks' } });
    expect(w.numberOfInstallments).toBe(8);
    expect(generateSchedule(w, 'weekly')[1]!.dueDate.toISOString().slice(0, 10)).toBe('2026-02-14');
    expect(calculateLoan({ ...base, frequency: 'biweekly', duration: { value: 8, unit: 'weeks' } }).numberOfInstallments).toBe(4);
    expect(calculateLoan({ ...base, frequency: 'daily', duration: { value: 30, unit: 'days' } }).numberOfInstallments).toBe(30);
    const c = calculateLoan({ ...base, frequency: 'custom', customIntervalDays: 10, duration: { value: 30, unit: 'days' } });
    expect(c.numberOfInstallments).toBe(3);
    expect(() => calculateLoan({ ...base, frequency: 'custom', duration: { value: 30, unit: 'days' } })).toThrow();
  });
});

describe('balance engine: partial, full and over-payment', () => {
  const t = calculateLoan(base);
  const p = plan(t);
  const early = utcDate(2026, 0, 31); // nothing due yet
  const pay = (...naira: number[]) => naira.map((n, i) => ({ id: `p${i}`, amountKobo: toKobo(n) }));

  it('starts with the full obligation outstanding', () => {
    const s = computeLoanState(p, [], early, rules);
    expect(s.outstandingBalance).toBe(1_300_000);
    expect(s.principalBalance).toBe(1_000_000);
    expect(s.interestBalance).toBe(300_000);
    expect(s.amountPaid).toBe(0);
    expect(s.nextInstallmentNumber).toBe(1);
    expect(s.installments.every((i) => i.status === 'upcoming')).toBe(true);
  });

  it('partial payment: interest first, then principal, oldest installment first', () => {
    const s = computeLoanState(p, pay(100_000), early, rules);
    expect(s.amountPaid).toBe(100_000);
    expect(s.outstandingBalance).toBe(1_200_000);
    expect(s.installments[0]).toMatchObject({ paidInterest: 50_000, paidPrincipal: 50_000, status: 'partially_paid' });
    expect(s.installments[0]!.remaining).toBeCloseTo(116_666.67, 2);
    expect(s.nextInstallmentNumber).toBe(1);
    expect(s.nextInstallmentAmount).toBeCloseTo(116_666.67, 2);
  });

  it('a payment that spans installments settles the first and part of the second', () => {
    const s = computeLoanState(p, pay(300_000), early, rules);
    expect(s.installments[0]!.status).toBe('paid');
    expect(s.installments[1]!.status).toBe('partially_paid');
    expect(s.nextInstallmentNumber).toBe(2);
  });

  it('full repayment clears every balance and marks the loan completed', () => {
    const s = computeLoanState(p, pay(1_300_000), early, rules);
    expect(s.outstandingBalance).toBe(0);
    expect(s.fullyPaid).toBe(true);
    expect(s.nextInstallmentNumber).toBeNull();
    expect(resolveStatus('active', s)).toBe('completed');
  });

  it('over-payment is reported as unapplied credit, not silently absorbed', () => {
    const s = computeLoanState(p, pay(1_350_000), early, rules);
    expect(s.outstandingBalance).toBe(0);
    expect(s.creditBalance).toBe(50_000);
  });

  it('allocation order is configurable', () => {
    const principalFirst = computeLoanState(p, pay(100_000), early, { ...rules, withinInstallment: 'principal_first' });
    expect(principalFirst.installments[0]).toMatchObject({ paidPrincipal: 100_000, paidInterest: 0 });
    const overall = computeLoanState(p, pay(400_000), early, { ...rules, allocationOrder: 'interest_first_overall' });
    expect(overall.interestPaid).toBe(300_000);
    expect(overall.principalPaid).toBe(100_000);
    const prop = computeLoanState(p, pay(130_000), early, { ...rules, withinInstallment: 'proportional' });
    expect(prop.interestPaid).toBeCloseTo(30_000, 0);
  });

  it('replaying without a payment (reversal) restores the original balances', () => {
    const withPayment = computeLoanState(p, pay(500_000, 100_000), early, rules);
    const reversed = computeLoanState(p, pay(500_000), early, rules);
    expect(withPayment.outstandingBalance - reversed.outstandingBalance).toBe(-100_000);
    expect(reversed.amountPaid).toBe(500_000);
  });
});

describe('overdue and completed loans', () => {
  const t = calculateLoan(base);
  const p = plan(t);
  it('flags installments past their due date as overdue and totals the overdue amount', () => {
    const today = utcDate(2026, 3, 15); // after installments 1 & 2 (28 Feb, 31 Mar)
    const s = computeLoanState(p, [], today, rules);
    expect(s.installments.slice(0, 2).every((i) => i.status === 'overdue')).toBe(true);
    expect(s.installments[2]!.status).toBe('upcoming');
    expect(s.overdueAmount).toBeCloseTo(433_333.34, 2);
    expect(s.daysOverdue).toBe(46); // since 28 Feb
    expect(resolveStatus('active', s)).toBe('overdue');
  });
  it('paying the overdue amount returns the loan to active', () => {
    const today = utcDate(2026, 3, 15);
    const s = computeLoanState(p, [{ id: 'a', amountKobo: toKobo(433_333.34) }], today, rules);
    expect(s.overdueAmount).toBe(0);
    expect(resolveStatus('overdue', s)).toBe('active');
  });
  it('grace days delay overdue, and the due date itself is "due" not overdue', () => {
    expect(computeLoanState(p, [], utcDate(2026, 1, 28), rules).installments[0]!.status).toBe('due');
    expect(computeLoanState(p, [], utcDate(2026, 2, 3), rules, 5).installments[0]!.status).toBe('due');
    expect(computeLoanState(p, [], utcDate(2026, 2, 3), rules, 0).installments[0]!.status).toBe('overdue');
  });
  it('workflow statuses are never overridden; default can be configured', () => {
    const s = computeLoanState(p, [], utcDate(2026, 6, 1), rules);
    expect(resolveStatus('pending', s)).toBe('pending');
    expect(resolveStatus('cancelled', s)).toBe('cancelled');
    expect(resolveStatus('overdue', s, { defaultAfterDays: 30 })).toBe('defaulted');
    expect(resolveStatus('defaulted', s)).toBe('defaulted');
  });
  it('exposes the standalone balance helpers', () => {
    const w: WorkingInstallment[] = [{ number: 1, dueDate: utcDate(2026, 0, 1), principalKobo: 1000, interestKobo: 200, paidPrincipalKobo: 400, paidInterestKobo: 200 }];
    expect(calculatePrincipalBalance(w)).toBe(600);
    expect(calculateInterestBalance(w)).toBe(0);
    expect(calculateOutstandingBalance(w)).toBe(600);
    expect(calculateOverdueAmount(w, utcDate(2026, 0, 10))).toBe(600);
    expect(calculateOverdueAmount(w, utcDate(2026, 0, 10), 30)).toBe(0);
  });
  it('allocatePayment reports what could not be applied', () => {
    const w: WorkingInstallment[] = [{ number: 1, dueDate: start, principalKobo: 100, interestKobo: 50, paidPrincipalKobo: 0, paidInterestKobo: 0 }];
    const r = allocatePayment(w, 200, rules);
    expect([r.applied, r.unapplied]).toEqual([150, 50]);
  });
});

describe('top-up calculation (configurable, not a fixed formula)', () => {
  const existing = { outstandingBalance: 300_000, principalBalance: 230_000, totalRepayment: 500_000, amountPaid: 200_000 };
  const pricing = { bankDeductionRate: 0, interestRate: 5, rateBasis: 'per_month' as const, duration: { value: 4, unit: 'months' as const }, frequency: 'monthly' as const, startDate: start };
  const rule = { mode: 'consolidate' as const, balanceBasis: 'outstanding_total' as const, interestBasis: 'full_principal' as const, minimumPercentRepaid: 0 };

  it('consolidate: carries the outstanding balance into a new principal (calculator B/Fwd)', () => {
    const r = calculateTopUp(existing, 150_000, pricing, rule);
    expect(r.carriedBalance).toBe(300_000);
    expect(r.terms.principal).toBe(450_000);
    expect(r.terms.interestAmount).toBe(90_000); // 450,000 x 5% x 4
    expect(r.terms.totalRepayment).toBe(540_000);
    expect(r.percentRepaid).toBe(40);
  });
  it('rules change the outcome without code changes', () => {
    expect(calculateTopUp(existing, 150_000, pricing, { ...rule, balanceBasis: 'outstanding_principal' }).terms.principal).toBe(380_000);
    expect(calculateTopUp(existing, 150_000, pricing, { ...rule, interestBasis: 'new_funds_only' }).terms.interestAmount).toBe(30_000);
    const sep = calculateTopUp(existing, 150_000, pricing, { ...rule, mode: 'new_loan' });
    expect([sep.carriedBalance, sep.terms.principal]).toEqual([0, 150_000]);
  });
  it('uses previous repayment history for eligibility', () => {
    const r = calculateTopUp(existing, 150_000, pricing, { ...rule, minimumPercentRepaid: 50 });
    expect(r.eligible).toBe(false);
    expect(r.ineligibleReason).toMatch(/50%/);
  });
});

/**
 * Real rows from Protech's "complete loan book" spreadsheet (5% per month flat, 4% bank deduction, 12 months).
 * Every calculated column of the sheet must be reproduced exactly by the engine.
 */
describe("matches Protech's loan book", () => {
  const sheet = [
    { client: 'OMOLORO (top-up)', bf: 165_375, bank: 144_000, gross: 150_000, principal: 315_375, interest: 189_225, loan: 504_600, emi: 42_050 },
    { client: 'RAFIU (top-up)', bf: 218_754.9, bank: 268_000, gross: 279_166.67, principal: 497_921.57, interest: 298_752.94, loan: 796_674.51, emi: 66_389.54 },
    { client: 'INYANG (renewal)', bf: 0, bank: 192_000, gross: 200_000, principal: 200_000, interest: 120_000, loan: 320_000, emi: 26_666.67 },
  ];
  for (const r of sheet) {
    it(`${r.client}: gross payment, principal, interest, gross loan and EMI`, () => {
      const t = calculateLoan({ ...base, amount: r.bank, carriedBalance: r.bf, duration: { value: 12, unit: 'months' }, startDate: utcDate(2026, 0, 1) });
      expect(t.grossAmount).toBe(r.gross);
      expect(t.principal).toBe(r.principal);
      expect(t.interestAmount).toBe(r.interest);
      expect(t.totalRepayment).toBe(r.loan);
      expect(t.installmentAmount).toBe(r.emi);
      expect(t.numberOfInstallments).toBe(12);
      // the schedule repays the loan exactly, with the sheet's EMI on every installment but the last
      const s = generateSchedule(t, 'monthly');
      expect(Math.round(s.reduce((a, i) => a + i.expectedAmount * 100, 0))).toBe(Math.round(r.loan * 100));
      expect(s.slice(0, 11).every((i) => i.expectedAmount === r.emi)).toBe(true);
    });
  }
  it('repayments begin on a chosen first-payment date (sheet: payout 4 Dec 2025, first repayment 1 Jan 2026)', () => {
    const t = calculateLoan({ ...base, amount: 144_000, duration: { value: 12, unit: 'months' }, startDate: utcDate(2025, 11, 4), firstPaymentDate: utcDate(2026, 0, 1) });
    const s = generateSchedule(t, 'monthly');
    expect(s[0]!.dueDate.toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(s[11]!.dueDate.toISOString().slice(0, 10)).toBe('2026-12-01');
    expect(t.dueDate.toISOString().slice(0, 10)).toBe('2026-12-01');
  });
  it('month-end first payments keep their anchor day instead of drifting', () => {
    const t = calculateLoan({ ...base, duration: { value: 4, unit: 'months' }, startDate: utcDate(2026, 0, 1), firstPaymentDate: utcDate(2026, 0, 31) });
    expect(generateSchedule(t, 'monthly').map((i) => i.dueDate.toISOString().slice(0, 10))).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
  });
});

describe('marking one installment paid, and waived interest', () => {
  const t = calculateLoan(base);
  const p = plan(t);
  const early = utcDate(2026, 0, 31);

  it('a payment marked for installment 3 settles installment 3 and leaves 1 and 2 untouched', () => {
    const s = computeLoanState(p, [{ id: 'a', amountKobo: toKobo(216_666.67), target: 3 }], early, rules);
    expect(s.installments[2]).toMatchObject({ status: 'paid', remaining: 0 });
    expect(s.installments[0]!.amountPaid).toBe(0);
    expect(s.installments[1]!.amountPaid).toBe(0);
    expect(s.outstandingBalance).toBeCloseTo(1_300_000 - 216_666.67, 2);
    expect(s.nextInstallmentNumber).toBe(1);
  });
  it('any excess over the targeted installment follows the normal order', () => {
    const s = computeLoanState(p, [{ id: 'a', amountKobo: toKobo(300_000), target: 3 }], early, rules);
    expect(s.installments[2]!.status).toBe('paid');
    expect(s.installments[0]!.amountPaid).toBeCloseTo(300_000 - 216_666.67, 2);
  });
  it('fixed write-offs (waived interest) reduce the obligation exactly, outside the allocation rules', () => {
    const waiver = { id: 'w', amountKobo: toKobo(150_000), fixed: [4, 5, 6].map((n) => ({ number: n, principal: 0, interest: toKobo(50_000) })) };
    const s = computeLoanState(p, [waiver], early, rules);
    expect(s.interestBalance).toBe(150_000);
    expect(s.principalBalance).toBe(1_000_000);
    expect(s.installments[0]!.amountPaid).toBe(0);
    expect(s.installments[3]).toMatchObject({ paidInterest: 50_000, paidPrincipal: 0 });
    // paying what is left after the waiver completes the loan
    const full = computeLoanState(p, [waiver, { id: 'r', amountKobo: toKobo(1_150_000) }], early, rules);
    expect(full.fullyPaid).toBe(true);
    expect(full.creditBalance).toBe(0);
  });
});

describe("the calculator site's worked example (OKOH ABBA EMMANUEL)", () => {
  it('Gross Payment 100,000.00 -> Principal 136,012.38 -> Interest 81,607.43 -> Gross Loan 217,619.81 -> EMI 18,134.98', () => {
    const t = calculateLoan({ ...base, amount: 96_000, carriedBalance: 36_012.38, duration: { value: 12, unit: 'months' } });
    expect(t.grossAmount).toBe(100_000);
    expect(t.principal).toBe(136_012.38);
    expect(t.monthlyInterest).toBe(6_800.62); // principal x 5%
    expect(t.interestAmount).toBe(81_607.43); // principal x 5% x 12, rounded once (interest is on the ORIGINAL principal, never a reducing balance)
    expect(t.totalRepayment).toBe(217_619.81);
    expect(t.installmentAmount).toBe(18_134.98);
  });
  it('interest is one fixed charge set at the start: repaying early does not change what was charged', () => {
    const t = calculateLoan(base);
    const s = generateSchedule(t, 'monthly');
    expect(Math.round(s.reduce((a, i) => a + i.interestComponent * 100, 0))).toBe(Math.round(t.interestAmount * 100));
    expect(t.interestAmount).toBe(t.monthlyInterest * 6);
  });
});
