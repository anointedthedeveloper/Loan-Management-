import { addDays, addMonths, diffDays, monthDay } from '../../utils/dates.js';
import { fromKobo, round2, splitEvenly, toKobo } from '../../utils/money.js';
import type { LoanTerms, LoanTermsInput, RateBasis, ScheduleInstallment, WorkingInstallment } from './types.js';
import { REPAYMENT_CYCLE, type Frequency } from '../../config/loanOptions.js';

/**
 * Protech accounting model (single source of truth):
 *   principal        = the requested amount (+ any balance carried into a top-up)
 *   application fee  = requested amount x 4%  (standalone: never in principal, interest, gross loan, EMI or any balance)
 *   monthly interest = principal x 5%         (flat, on the original principal)
 *   total interest   = monthly interest x tenor
 *   gross loan       = principal + total interest   (what the customer repays)
 *   EMI              = gross loan / tenor
 * Every rule that Protech may change (rate basis, month length, rounding, installment count)
 * is isolated in the small functions below.
 */
export const APPLICATION_FEE_RATE = 4; // % of the requested amount
export const DAYS_PER_MONTH = 30; // convention used to express days/weeks as months

export function durationInMonths(d: LoanTermsInput['duration']): number {
  if (d.unit === 'months') return d.value;
  return (d.unit === 'weeks' ? d.value * 7 : d.value) / DAYS_PER_MONTH;
}

/** Interest in kobo for a principal (kobo). Rounded to the nearest kobo. */
export function calculateInterest(principalKobo: number, ratePercent: number, basis: RateBasis, months: number): number {
  const factor = basis === 'per_month' ? months : basis === 'per_annum' ? months / 12 : 1;
  return Math.round((principalKobo * ratePercent * factor) / 100);
}

export const calculateTotalPayable = (principalKobo: number, interestKobo: number) => principalKobo + interestKobo;

/**
 * Equal installments rounded to the nearest kobo (as in Protech's loan book: 320,000 / 12 = 26,666.67).
 * The final installment absorbs the difference so the total is repaid exactly, never over or under.
 */
export function calculateInstallment(totalKobo: number, n: number): { regular: number; last: number } {
  let regular = Math.round(totalKobo / n);
  let last = totalKobo - regular * (n - 1);
  if (last < 0) { regular = Math.floor(totalKobo / n); last = totalKobo - regular * (n - 1); } // tiny totals only
  return { regular, last };
}

export const stepDays = (f: Frequency, custom?: number) => ({ daily: 1, weekly: 7, biweekly: 14, monthly: 0, custom: custom ?? 0 })[f];

export function loanEndDate(start: Date, d: LoanTermsInput['duration']): Date {
  return d.unit === 'months' ? addMonths(start, d.value) : addDays(start, d.unit === 'weeks' ? d.value * 7 : d.value);
}

export function deriveInstallmentCount(input: LoanTermsInput): number {
  if (input.numberOfInstallments) return input.numberOfInstallments;
  const days = Math.max(1, diffDays(loanEndDate(input.startDate, input.duration), input.startDate));
  if (input.frequency === 'monthly') return Math.max(1, input.duration.unit === 'months' ? input.duration.value : Math.round(days / DAYS_PER_MONTH));
  const step = stepDays(input.frequency, input.customIntervalDays);
  if (!step) throw new Error('A custom interval (days) is required for custom frequency');
  return Math.max(1, Math.floor(days / step));
}

/**
 * Due date of installment k. Monthly loans follow Protech's cycle: the first installment is due in the month after
 * the loan starts (whatever day it started) on the 30th, or the last day of February, and so on each month.
 * `firstPaymentDate` overrides that (as in the loan book, where repayments begin on a set date).
 */
export function installmentDueDate(start: Date, frequency: Frequency, k: number, customDays?: number, firstPaymentDate?: Date): Date {
  if (firstPaymentDate) return frequency === 'monthly' ? addMonths(firstPaymentDate, k - 1) : addDays(firstPaymentDate, (k - 1) * stepDays(frequency, customDays));
  return frequency === 'monthly' ? monthDay(start, k, REPAYMENT_CYCLE.dueDay) : addDays(start, k * stepDays(frequency, customDays));
}

/** The application fee for a requested amount, in naira (kobo-exact). */
export const calculateApplicationFee = (amount: number, ratePercent: number = APPLICATION_FEE_RATE) => fromKobo(Math.round((toKobo(amount) * ratePercent) / 100));

/**
 * The plain accounting figures for a flat monthly-interest loan. The frontend shows what the backend returns here.
 * Example: 500,000 at 5% for 12 months -> fee 20,000, monthly interest 25,000, interest 300,000, gross 800,000, EMI 66,666.67.
 */
export function calculateLoanFigures(i: { principal: number; interestRate: number; tenor: number; applicationFeeRate?: number }) {
  if (!(i.principal > 0)) throw new Error('Loan amount must be greater than zero');
  if (!(i.tenor > 0)) throw new Error('Tenor must be at least one month');
  const principalKobo = toKobo(i.principal);
  const monthlyKobo = Math.round((principalKobo * i.interestRate) / 100);
  const interestKobo = monthlyKobo * i.tenor;
  const grossKobo = principalKobo + interestKobo;
  return {
    principal: fromKobo(principalKobo), applicationFee: calculateApplicationFee(i.principal, i.applicationFeeRate), monthlyInterest: fromKobo(monthlyKobo),
    totalInterest: fromKobo(interestKobo), grossLoan: fromKobo(grossKobo), emi: round2(fromKobo(grossKobo) / i.tenor), tenor: i.tenor, interestRate: i.interestRate,
  };
}

export function calculateLoan(input: LoanTermsInput): LoanTerms {
  const fee = input.applicationFeeRate ?? APPLICATION_FEE_RATE;
  if (!(input.amount > 0)) throw new Error('Loan amount must be greater than zero');
  if (fee < 0 || fee >= 100) throw new Error('Application fee must be between 0 and 100%');
  const amountKobo = toKobo(input.amount);
  const carriedKobo = toKobo(input.carriedBalance ?? 0);
  const principalKobo = carriedKobo + amountKobo; // the requested amount IS the principal; the application fee is never added to it
  const baseKobo = input.interestBasis === 'new_funds_only' ? amountKobo : principalKobo;
  // Monthly repayments: the number of installments IS the tenor, so a stated installment count always drives the interest.
  const months = input.frequency === 'monthly' && input.numberOfInstallments ? input.numberOfInstallments : durationInMonths(input.duration);
  const interestKobo = calculateInterest(baseKobo, input.interestRate, input.rateBasis, months);
  const totalKobo = calculateTotalPayable(principalKobo, interestKobo);
  const n = deriveInstallmentCount(input);
  const inst = calculateInstallment(totalKobo, n);
  return {
    amount: round2(input.amount), carriedBalance: fromKobo(carriedKobo), applicationFeeRate: fee, applicationFee: calculateApplicationFee(input.amount, fee),
    principal: fromKobo(principalKobo), interestBase: fromKobo(baseKobo),
    interestAmount: fromKobo(interestKobo), monthlyInterest: fromKobo(input.rateBasis === 'per_month' ? Math.round((baseKobo * input.interestRate) / 100) : months > 0 ? Math.round(interestKobo / months) : interestKobo), totalRepayment: fromKobo(totalKobo), numberOfInstallments: n,
    installmentAmount: fromKobo(inst.regular), finalInstallmentAmount: fromKobo(inst.last), durationMonths: months,
    startDate: input.startDate,
    firstPaymentDate: input.firstPaymentDate,
    firstDueDate: installmentDueDate(input.startDate, input.frequency, 1, input.customIntervalDays, input.firstPaymentDate),
    dueDate: installmentDueDate(input.startDate, input.frequency, n, input.customIntervalDays, input.firstPaymentDate),
  };
}

/**
 * Builds the repayment schedule. Each installment equals total / tenor (the calculator's EMI), with the
 * kobo remainder on the last one, so the quoted installment always matches the schedule exactly.
 * The interest slice is split evenly and principal is the remainder of each installment.
 */
export function generateSchedule(terms: LoanTerms, frequency: Frequency, customIntervalDays?: number): ScheduleInstallment[] {
  const n = terms.numberOfInstallments;
  const inst = calculateInstallment(toKobo(terms.totalRepayment), n);
  const expected = Array.from({ length: n }, (_, i) => (i === n - 1 ? inst.last : inst.regular));
  const interest = splitEvenly(toKobo(terms.interestAmount), n);
  return Array.from({ length: n }, (_, i) => ({
    number: i + 1,
    dueDate: installmentDueDate(terms.startDate, frequency, i + 1, customIntervalDays, terms.firstPaymentDate),
    principalComponent: fromKobo(expected[i]! - interest[i]!),
    interestComponent: fromKobo(interest[i]!),
    expectedAmount: fromKobo(expected[i]!),
  }));
}

/* ---- balance helpers over a replayed schedule (kobo in, kobo out) ---- */
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const calculatePrincipalBalance = (s: WorkingInstallment[]) => sum(s.map((i) => i.principalKobo - i.paidPrincipalKobo));
export const calculateInterestBalance = (s: WorkingInstallment[]) => sum(s.map((i) => i.interestKobo - i.paidInterestKobo));
export const calculateOutstandingBalance = (s: WorkingInstallment[]) => calculatePrincipalBalance(s) + calculateInterestBalance(s);
export const installmentRemaining = (i: WorkingInstallment) => i.principalKobo + i.interestKobo - i.paidPrincipalKobo - i.paidInterestKobo;
/** Sum still owed on installments whose due date (plus grace) is already behind `today`. */
export function calculateOverdueAmount(s: WorkingInstallment[], today: Date, graceDays = 0): number {
  return sum(s.filter((i) => diffDays(today, i.dueDate) > graceDays).map(installmentRemaining));
}
