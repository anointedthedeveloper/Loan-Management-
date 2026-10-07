import { Customer } from '../models/Customer.js';
import { Loan } from '../models/Loan.js';
import { LoanProduct } from '../models/LoanProduct.js';
import { Transaction } from '../models/Transaction.js';
import { TopUp } from '../models/TopUp.js';
import { User } from '../models/User.js';
import { addDays, addMonths, todayLagos } from '../utils/dates.js';
import { createCustomer } from '../services/customer.service.js';
import { createProduct } from '../services/product.service.js';
import { approveLoan, createLoan } from '../services/loan.service.js';
import { recordRepayment } from '../services/repayment.service.js';
import { approveTopUp, requestTopUp } from '../services/topup.service.js';
import { recalculateLoan } from '../services/loanLedger.service.js';
import { registerCustomerFinancials } from '../services/customerFinancials.impl.js';
import type { Actor } from '../types/index.js';

/**
 * DEVELOPMENT / DEMO DATA ONLY. Built through the real services so the ledger, schedules and
 * audit trail are exactly what production code produces. Rates below are illustrative, not Protech policy.
 */
export async function seedDemoData() {
  if (await Loan.exists({})) return { skipped: true };
  registerCustomerFinancials();
  const ceo = await User.findOne({ role: 'ceo' });
  if (!ceo) throw new Error('Seed users first');
  const actor: Actor = { id: String(ceo._id), name: ceo.name };
  const today = todayLagos();

  const prod = async (name: string, code: string, o: Record<string, unknown>) => createProduct({ name, code, interestRate: 5, rateBasis: 'per_month', applicationFeeRate: 4, minAmount: 10_000, minDuration: 1, durationUnit: 'months', allowedFrequencies: ['monthly'], defaultFrequency: 'monthly', isActive: true, ...o }, actor);
  const salary = await prod('Salary Advance (demo)', 'SAL', { interestRate: 5, maxAmount: 5_000_000, maxDuration: 12, description: 'Demo product: flat 5% a month on the principal, plus a separate 4% application fee.' });
  const sme = await prod('SME Business Loan (demo)', 'SME', { interestRate: 4, maxAmount: 10_000_000, maxDuration: 24, allowedFrequencies: ['monthly', 'weekly'] });
  const daily = await prod('Daily Trader (demo)', 'DLY', { interestRate: 10, rateBasis: 'per_loan', applicationFeeRate: 0, minDuration: 30, maxDuration: 90, durationUnit: 'days', allowedFrequencies: ['daily'], defaultFrequency: 'daily', minAmount: 5_000 });

  const people = [
    ['Adebayo', 'Ogunleye', '08031000001', 'Lagos', 'Civil servant', 'Lagos State Ministry of Works'],
    ['Ngozi', 'Eze', '08031000002', 'Anambra', 'Trader', 'Eze Provisions'],
    ['Ibrahim', 'Musa', '08031000003', 'Kano', 'Teacher', 'Kano State Education Board'],
    ['Folake', 'Adeyemi', '08031000004', 'Oyo', 'Nurse', 'UCH Ibadan'],
    ['Emeka', 'Nwankwo', '08031000005', 'Enugu', 'Business owner', 'Nwankwo Auto Parts'],
    ['Zainab', 'Bello', '08031000006', 'Kaduna', 'Market trader', 'Bello Fabrics'],
  ] as const;
  const cs: string[] = [];
  for (const [i, [f, l, ph, state, occ, emp]] of people.entries()) {
    const c = await createCustomer({ firstName: f, lastName: l, phone: ph, email: `${f.toLowerCase()}.${l.toLowerCase()}@example.com`, address: `${10 + i} Demo Street`, state, nin: `7000000000${i}`, bvn: `2200000000${i}`, employment: { occupation: occ, employerName: emp, sector: 'government', employmentType: 'employed', ippisNumber: `43760${i}`, ministry: ['OSGF', 'Salaries', 'Education', 'Health', 'Works', 'Trade'][i] }, emergencyContact: { name: 'Next of kin', relationship: 'Sibling', phone: '08099990000' } } as any, actor);
    cs.push(c.id);
  }

  const startOf = (monthsAgo: number) => addMonths(today, -monthsAgo);
  const open = async (customerId: string, product: any, amount: number, months: number, start: Date, extra: Record<string, unknown> = {}) => {
    const created = await createLoan({ customerId, productId: String(product.id), amount, duration: { value: months, unit: 'months' }, startDate: start, ...extra } as any, actor);
    const approved = await approveLoan(created.loan.id, actor);
    await Transaction.updateOne({ loan: approved.loan.id, type: 'disbursement' }, { date: start }); // back-date the payout to the start date
    return approved.loan.id as string;
  };
  const pay = (loanId: string, amount: number, date: Date, n: number) => recordRepayment({ loanId, amount, date, method: 'bank_transfer', reference: `DEMO-${loanId.slice(-4)}-${n}` }, actor);

  // 1. Active, paying on time: ₦960,000 net (the calculator's worked example), 6 months, 3 elapsed.
  const l1 = await open(cs[0]!, salary, 960_000, 6, startOf(3));
  const sched1 = (await Loan.findById(l1))!;
  for (let k = 1; k <= 2; k++) await pay(l1, sched1.installmentAmount, addMonths(startOf(3), k), k);

  // 2. Overdue: ₦500,000 over 4 months, only the first installment paid.
  const l2 = await open(cs[1]!, sme, 500_000, 4, addDays(startOf(3), -10));
  await pay(l2, (await Loan.findById(l2))!.installmentAmount, addDays(addMonths(startOf(3), 1), -10), 1);

  // 3. Completed: ₦200,000 over 3 months, fully repaid.
  const l3 = await open(cs[2]!, salary, 200_000, 3, startOf(4));
  const loan3 = (await Loan.findById(l3))!;
  for (let k = 1; k <= 3; k++) await pay(l3, k < 3 ? loan3.installmentAmount : loan3.totalRepayment - loan3.installmentAmount * 2, addMonths(startOf(4), k), k);

  // 4. Pending approval.
  await createLoan({ customerId: cs[3]!, productId: String(sme.id), amount: 300_000, duration: { value: 6, unit: 'months' }, startDate: today } as any, actor);

  // 5. Top-up example: ₦500,000 loan, ~₦200,000 repaid, customer takes a further ₦150,000.
  const l5 = await open(cs[4]!, sme, 500_000, 6, startOf(3));
  const loan5 = (await Loan.findById(l5))!;
  await pay(l5, 200_000, addMonths(startOf(3), 2), 1);
  void loan5;
  const topup = await requestTopUp({ loanId: l5, amount: 150_000, duration: { value: 6, unit: 'months' }, frequency: 'monthly', startDate: today, notes: 'Demo top-up: consolidates the outstanding balance with new funds.' }, actor);
  await approveTopUp(topup.id, actor);

  // 6. Daily trader loan with a few daily payments.
  const l6 = await open(cs[5]!, daily, 50_000, 1, addDays(today, -12), { duration: { value: 30, unit: 'days' }, frequency: 'daily' });
  const loan6 = (await Loan.findById(l6))!;
  for (let k = 1; k <= 6; k++) await pay(l6, loan6.installmentAmount, addDays(today, -12 + k), k);

  for (const l of await Loan.find({})) await recalculateLoan(l._id);
  const flag = { $set: { isDemoData: true } };
  await Promise.all([Customer.updateMany({}, flag), Loan.updateMany({}, flag), LoanProduct.updateMany({}, flag), Transaction.updateMany({}, flag), TopUp.updateMany({}, flag)]);
  return { skipped: false };
}
