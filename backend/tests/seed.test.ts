import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setupDb, teardownDb } from './helpers.js';
import { seedDemoData } from '../src/scripts/seedDemo.js';
import { Loan } from '../src/models/Loan.js';
import { Transaction } from '../src/models/Transaction.js';
import { TopUp } from '../src/models/TopUp.js';
import { Customer } from '../src/models/Customer.js';

beforeAll(async () => { await setupDb(); expect((await seedDemoData()).skipped).toBe(false); });
afterAll(teardownDb);

describe('demo seed data (built through the real services)', () => {
  it('contains the required scenarios', async () => {
    const by = (s: string) => Loan.countDocuments({ status: s });
    expect(await Customer.countDocuments()).toBe(6);
    expect(await by('overdue')).toBeGreaterThanOrEqual(1);
    expect(await by('completed')).toBeGreaterThanOrEqual(1);
    expect(await by('pending')).toBe(1);
    expect(await by('active')).toBeGreaterThanOrEqual(2);
    expect(await TopUp.countDocuments({ status: 'approved' })).toBe(1);
    expect(await Customer.countDocuments({ isDemoData: true })).toBe(6);
  });
  it('the seeded top-up consolidates the old loan into a new one without overwriting it', async () => {
    const t = (await TopUp.findOne())!;
    const oldLoan = (await Loan.findById(t.loan))!; const newLoan = (await Loan.findById(t.resultingLoan))!;
    expect(oldLoan.status).toBe('completed');
    expect(String(oldLoan.settledByTopUp)).toBe(String(t._id));
    expect(oldLoan.amount).toBe(500_000); // original untouched
    expect(newLoan.carriedBalance).toBeGreaterThan(0);
    expect(newLoan.principal).toBeCloseTo(newLoan.carriedBalance + 150_000, 2);
    expect(newLoan.status).toBe('active');
  });
  it('every loan balance equals what the ledger implies (no duplicated sources of truth)', async () => {
    for (const l of await Loan.find({ status: { $in: ['active', 'overdue', 'completed'] } })) {
      const paid = (await Transaction.aggregate([{ $match: { loan: l._id, affectsLoanBalance: true, reversedAt: { $exists: false } } }, { $group: { _id: null, s: { $sum: '$amount' } } }]))[0]?.s ?? 0;
      expect(l.amountPaid).toBeCloseTo(paid, 2);
      expect(l.outstandingBalance).toBeCloseTo(l.totalRepayment - paid, 2);
    }
  });
  it('seeding twice does nothing', async () => { expect((await seedDemoData()).skipped).toBe(true); });
});
