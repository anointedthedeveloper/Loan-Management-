import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken, customerPayload } from './helpers.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Transaction } from '../src/models/Transaction.js';
import { Loan } from '../src/models/Loan.js';
import { isoDate, todayLagos } from '../src/utils/dates.js';

let ceo = ''; let acct = ''; let product = '';
const api = (m: 'get' | 'post' | 'put', url: string, t = ceo) => (request(app) as any)[m](url).set(as(t));
const today = isoDate(todayLagos());
beforeAll(async () => {
  await setupDb(); ceo = await ceoToken(); acct = await accountantToken();
  product = (await api('post', '/api/loan-products').send({ name: 'SME', code: 'SME', interestRate: 5, rateBasis: 'per_month', bankDeductionRate: 0, allowedFrequencies: ['monthly'], defaultFrequency: 'monthly', maxDuration: 12 })).body.data.product.id;
});
afterAll(teardownDb);

/** The brief's example: ₦500,000 loan, ₦200,000 repaid, outstanding ₦300,000 at 0% interest so figures are easy to follow. */
async function exampleLoan(rate = 0) {
  const cust = (await api('post', '/api/customers').send(customerPayload())).body.data.customer.id;
  const p = await request(app).patch(`/api/loan-products/${product}`).set(as(ceo)).send({ interestRate: rate });
  expect(p.status).toBe(200);
  const loan = (await api('post', '/api/loans').send({ customerId: cust, productId: product, amount: 500000, duration: { value: 5, unit: 'months' }, startDate: today })).body.data.loan; // CEO: approved immediately
  const r = await api('post', '/api/repayments').send({ loanId: loan.id, amount: 200000 });
  if (rate === 0) expect(r.body.data.loan.outstandingBalance).toBe(300000);
  return { cust, loanId: loan.id as string };
}
const topBody = (loanId: string, over: Record<string, unknown> = {}) => ({ loanId, amount: 150000, duration: { value: 3, unit: 'months' }, frequency: 'monthly', startDate: today, ...over });
const setTopUp = (over: Record<string, unknown>) => api('put', '/api/settings/topup').send({ requireApproval: true, mode: 'consolidate', balanceBasis: 'outstanding_total', interestBasis: 'full_principal', minimumPercentRepaid: 0, ...over });

describe('top-up preview and request', () => {
  it('calculates from the configured rules without touching the original loan', async () => {
    const { loanId } = await exampleLoan(0);
    const pv = await api('post', '/api/topups/preview').send(topBody(loanId));
    expect(pv.status).toBe(200);
    expect(pv.body.data.calculation).toMatchObject({ mode: 'consolidate', carriedBalance: 300000, newFunds: 150000, percentRepaid: 40, existingOutstanding: 300000 });
    expect(pv.body.data.calculation.terms).toMatchObject({ principal: 450000, totalRepayment: 450000 });
    expect((await Loan.findById(loanId))!.outstandingBalance).toBe(300000);
  });

  it('records a request, blocks a second pending one, and is audited', async () => {
    const { loanId } = await exampleLoan(0);
    const r = await api('post', '/api/topups', acct).send(topBody(loanId, { notes: 'Needs stock' }));
    expect(r.body.message).toMatch(/submitted for approval/i);
    expect(r.status).toBe(201);
    expect(r.body.data.topUp).toMatchObject({ status: 'pending', requestedAmount: 150000 });
    expect(r.body.data.topUp.topUpId).toMatch(/^TUP-\d{6}$/);
    expect((await api('post', '/api/topups', acct).send(topBody(loanId))).body.code).toBe('TOPUP_PENDING_EXISTS');
    expect(await AuditLog.countDocuments({ action: 'TOPUP_REQUESTED', entityId: r.body.data.topUp.id })).toBe(1);
    expect((await api('post', '/api/topups').send(topBody('64b000000000000000000000'))).status).toBe(404);
  });

  it('is only available on live loans and respects repayment-history eligibility', async () => {
    const cust = (await api('post', '/api/customers').send(customerPayload())).body.data.customer.id;
    const pending = (await api('post', '/api/loans', acct).send({ customerId: cust, productId: product, amount: 100000, duration: { value: 3, unit: 'months' }, startDate: today })).body.data.loan;
    expect((await api('post', '/api/topups').send(topBody(pending.id))).body.code).toBe('TOPUP_NOT_ALLOWED');
    const { loanId } = await exampleLoan(0);
    await setTopUp({ minimumPercentRepaid: 50 }); // only 40% repaid
    const r = await api('post', '/api/topups').send(topBody(loanId));
    expect(r.body.code).toBe('TOPUP_NOT_ELIGIBLE');
    expect(r.body.message).toMatch(/50%/);
    await setTopUp({});
  });
});

describe('top-up by the CEO needs no approval', () => {
  it('is approved and issued immediately', async () => {
    const { loanId } = await exampleLoan(0);
    const r = await api('post', '/api/topups').send(topBody(loanId));
    expect(r.status).toBe(201);
    expect(r.body.message).toMatch(/created and approved/i);
    expect(r.body.data.topUp.status).toBe('approved');
    expect((await Loan.findById(loanId))!.status).toBe('completed'); // consolidated into the new loan
  });
});

describe('top-up approval', () => {
  it('consolidate: creates a NEW loan, settles the old one with a non-cash entry, keeps the ledger honest', async () => {
    const { cust, loanId } = await exampleLoan(0);
    const t = (await api('post', '/api/topups', acct).send(topBody(loanId))).body.data.topUp;
    expect((await api('post', `/api/topups/${t.id}/approve`, acct)).status).toBe(403); // accountants cannot approve
    const ap = await api('post', `/api/topups/${t.id}/approve`);
    expect(ap.status).toBe(200);
    const top = ap.body.data.topUp;
    expect(top.status).toBe('approved');
    expect(top.settlement).toMatchObject({ settled: 300000, carriedForward: 300000, waived: 0 });

    const oldLoan = (await Loan.findById(loanId))!;
    const newLoan = (await Loan.findById(top.resultingLoan.id))!;
    expect(oldLoan.amount).toBe(500000);                  // original terms untouched
    expect(oldLoan.status).toBe('completed');
    expect(oldLoan.outstandingBalance).toBe(0);
    expect(String(oldLoan.settledByTopUp)).toBe(t.id);
    expect(newLoan).toMatchObject({ status: 'active', principal: 450000, carriedBalance: 300000, amount: 150000, totalRepayment: 450000 });
    expect(String(newLoan.topUpOf)).toBe(loanId);
    expect(newLoan.loanType).toBe('topup');

    const newFunds = await Transaction.find({ loan: newLoan._id, type: 'topup' });
    expect(newFunds).toHaveLength(1);
    expect(newFunds[0]).toMatchObject({ amount: 150000, isCash: true, direction: 'out' });
    const settle = await Transaction.findOne({ loan: loanId, type: 'topup' });
    expect(settle).toMatchObject({ amount: 300000, isCash: false, affectsLoanBalance: true });

    // Customer figures count only real cash: ₦500k + ₦150k borrowed, ₦200k repaid (the settlement is not a collection).
    const sum = (await api('get', `/api/customers/${cust}/summary`)).body.data.metrics;
    expect(sum).toMatchObject({ totalBorrowed: 650000, totalRepaid: 200000, outstandingBalance: 450000, activeLoans: 1, completedLoans: 1 });
    expect(await AuditLog.countDocuments({ action: 'TOPUP_APPROVED', entityId: t.id })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'LOAN_CREATED', entityId: String(newLoan._id) })).toBe(1);
    expect((await api('post', `/api/topups/${t.id}/approve`)).body.code).toBe('INVALID_TOPUP_STATE');
  });

  it('re-prices at approval using the latest balance (payments made after the request count)', async () => {
    const { loanId } = await exampleLoan(0);
    const t = (await api('post', '/api/topups', acct).send(topBody(loanId))).body.data.topUp;
    await api('post', '/api/repayments').send({ loanId, amount: 100000 });
    const ap = await api('post', `/api/topups/${t.id}/approve`);
    expect(ap.body.data.topUp.calculation.carriedBalance).toBe(200000);
    expect((await Loan.findById(ap.body.data.topUp.resultingLoan.id))!.principal).toBe(350000);
  });

  it('rules change the result without code changes: principal-only carry and interest on new funds only', async () => {
    await api('put', '/api/settings/topup').send({ requireApproval: true, mode: 'consolidate', balanceBasis: 'outstanding_principal', interestBasis: 'new_funds_only', minimumPercentRepaid: 0 });
    const { loanId } = await exampleLoan(5); // 5% / month
    const pv = (await api('post', '/api/topups/preview').send(topBody(loanId))).body.data.calculation;
    const l = (await Loan.findById(loanId))!;
    expect(pv.carriedBalance).toBe(l.principalBalance);
    expect(pv.terms.interestAmount).toBe(Math.round(150000 * 0.05 * 3 * 100) / 100); // 22,500: interest only on the new funds
    expect(pv.waivedOnExistingLoan).toBeCloseTo(l.interestBalance, 2);
    await setTopUp({});
  });

  it('new_loan mode: leaves the original loan open and creates a separate loan for the new funds', async () => {
    await setTopUp({ mode: 'new_loan' });
    const { loanId } = await exampleLoan(0);
    const t = (await api('post', '/api/topups', acct).send(topBody(loanId))).body.data.topUp;
    const ap = await api('post', `/api/topups/${t.id}/approve`);
    expect(ap.body.data.topUp.settlement).toBeNull();
    expect((await Loan.findById(loanId))).toMatchObject({ status: 'active', outstandingBalance: 300000 });
    expect((await Loan.findById(ap.body.data.topUp.resultingLoan.id))).toMatchObject({ principal: 150000, carriedBalance: 0 });
    await setTopUp({});
  });

  it('rejection and cancellation leave everything unchanged', async () => {
    const { loanId } = await exampleLoan(0);
    const t = (await api('post', '/api/topups', acct).send(topBody(loanId))).body.data.topUp;
    expect((await api('post', `/api/topups/${t.id}/reject`).send({})).status).toBe(400);
    expect((await api('post', `/api/topups/${t.id}/reject`).send({ reason: 'Existing arrears' })).body.data.topUp.status).toBe('rejected');
    const t2 = (await api('post', '/api/topups', acct).send(topBody(loanId))).body.data.topUp;
    expect((await api('post', `/api/topups/${t2.id}/cancel`).send({})).body.data.topUp.status).toBe('cancelled');
    expect((await Loan.findById(loanId))!.outstandingBalance).toBe(300000);
    expect(await Loan.countDocuments({ topUpOf: loanId })).toBe(0);
  });

  it('lists top-ups with filters and enforces permissions', async () => {
    const all = await api('get', '/api/topups?status=approved');
    expect(all.body.data.every((t: any) => t.status === 'approved')).toBe(true);
    expect((await api('get', '/api/topups', acct)).status).toBe(200);
    expect((await api('get', '/api/topups?status=weird')).status).toBe(400);
  });
});
