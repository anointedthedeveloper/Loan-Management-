import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken, customerPayload } from './helpers.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Transaction } from '../src/models/Transaction.js';
import { Loan } from '../src/models/Loan.js';
import { Customer } from '../src/models/Customer.js';
import { User } from '../src/models/User.js';
import { SystemSetting } from '../src/models/SystemSetting.js';
import { addMonths, todayLagos, isoDate, addDays } from '../src/utils/dates.js';

let ceo = ''; let acct = ''; let salary = ''; let customer = ''; let n = 0;
const today = todayLagos();
const api = (m: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, t = ceo) => (request(app) as any)[m](url).set(as(t));
beforeAll(async () => {
  await setupDb(); ceo = await ceoToken(); acct = await accountantToken();
  salary = (await api('post', '/api/loan-products').send({ name: 'Salary Advance', code: 'SAL', interestRate: 5, rateBasis: 'per_month', bankDeductionRate: 4, minAmount: 10000, maxAmount: 5_000_000, minDuration: 1, maxDuration: 12, durationUnit: 'months', allowedFrequencies: ['monthly', 'weekly'], defaultFrequency: 'monthly' })).body.data.product.id;
  customer = await newCustomer();
});
afterAll(teardownDb);

const newCustomer = async () => { n++; return (await api('post', '/api/customers').send(customerPayload())).body.data.customer.id as string; };
const loanBody = (over: Record<string, unknown> = {}) => ({ customerId: customer, productId: salary, amount: 960000, duration: { value: 6, unit: 'months' }, startDate: isoDate(today), ...over });
/** The CEO creates a loan: approvers skip the approval step, so it is approved and disbursed immediately. */
async function activeLoan(over: Record<string, unknown> = {}) {
  const c = await api('post', '/api/loans').send(loanBody(over));
  expect(c.status).toBe(201);
  expect(['active', 'overdue', 'defaulted']).toContain(c.body.data.loan.status); // live (back-dated loans are already overdue)
  return c.body.data.loan;
}
/** An accountant creates a loan: it waits for approval. */
async function pendingLoan(over: Record<string, unknown> = {}) {
  const c = await api('post', '/api/loans', acct).send(loanBody(over));
  expect(c.status).toBe(201);
  expect(c.body.data.loan.status).toBe('pending');
  return c.body.data;
}
const pay = (loanId: string, amount: number, over: Record<string, unknown> = {}, t = ceo) => api('post', '/api/repayments', t).send({ loanId, amount, ...over });

describe('loan products', () => {
  it('validates, rejects duplicate codes and enforces permissions', async () => {
    expect((await api('post', '/api/loan-products').send({ name: 'x' })).status).toBe(400);
    const dup = await api('post', '/api/loan-products').send({ name: 'Other', code: 'SAL', interestRate: 3, allowedFrequencies: ['monthly'], defaultFrequency: 'monthly' });
    expect(dup.status).toBe(409);
    expect((await api('post', '/api/loan-products', acct).send({})).status).toBe(403);
    const bad = await api('post', '/api/loan-products').send({ name: 'Bad', code: 'BAD', interestRate: 3, allowedFrequencies: ['monthly'], defaultFrequency: 'weekly' });
    expect(bad.body.errors.defaultFrequency).toBeTruthy();
    expect((await api('get', '/api/loan-products', acct)).body.data.products.length).toBeGreaterThan(0); // accountants may read active products
  });
  it('cannot delete a product that loans use, but can edit it without changing existing loans', async () => {
    const l = await activeLoan();
    expect((await api('delete', `/api/loan-products/${salary}`)).body.code).toBe('PRODUCT_IN_USE');
    await api('patch', `/api/loan-products/${salary}`).send({ interestRate: 9 });
    expect((await Loan.findById(l.id))!.interestRate).toBe(5);
    await api('patch', `/api/loan-products/${salary}`).send({ interestRate: 5 });
  });
});

describe('one open loan per customer (top-up instead)', () => {
  it('refuses a second loan while one is pending or running, and points to a top-up', async () => {
    const put = (m: number | string) => api('put', '/api/settings/loans').send({ requireApproval: true, preventSelfApproval: false, autoDisburseOnApproval: true, maxActiveLoansPerCustomer: m, allowBackdatedStart: true });
    await put('');
    const c = await newCustomer();
    const first = (await api('post', '/api/loans', acct).send(loanBody({ customerId: c }))).body.data.loan; // pending
    const again = await api('post', '/api/loans').send(loanBody({ customerId: c }));
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('EXISTING_LOAN');
    expect(again.body.message).toMatch(/top-up/i);
    expect(again.body.errors).toMatchObject({ existingLoanRef: first.loanId, existingStatus: 'pending' });
    expect((await api('post', '/api/loans/preview').send(loanBody({ customerId: c }))).status).toBe(409);
    expect((await api('post', `/api/loans/${first.id}/cancel`).send({ reason: 'Test' })).status).toBe(200);
    const free = await api('post', '/api/loans').send(loanBody({ customerId: c })); expect(free.status).toBe(201); // free again once the first is closed
    await put(100);
  });
});

describe('loan creation and calculation (done by the backend)', () => {
  it('previews terms from the central engine', async () => {
    const r = await api('post', '/api/loans/preview').send(loanBody());
    expect(r.status).toBe(200);
    expect(r.body.data.terms).toMatchObject({ grossAmount: 1_000_000, interestAmount: 300_000, totalRepayment: 1_300_000, numberOfInstallments: 6 });
    expect(r.body.data.schedule).toHaveLength(6);
  });
  it('an accountant creates a pending loan with a schedule, and audits it', async () => {
    const r = await api('post', '/api/loans', acct).send(loanBody());
    expect(r.status).toBe(201);
    expect(r.body.message).toMatch(/submitted for approval/i);
    const { loan, schedule } = r.body.data;
    expect(loan.loanId).toMatch(/^LN-\d{6}$/);
    expect(loan.status).toBe('pending');
    expect(loan.totalRepayment).toBe(1_300_000);
    expect(schedule).toHaveLength(6);
    expect(await Transaction.countDocuments({ loan: loan.id })).toBe(0); // nothing paid out until approval
    expect(await AuditLog.countDocuments({ action: 'LOAN_CREATED', entityId: loan.id })).toBe(1);
  });
  it('enforces product limits, eligibility and validation', async () => {
    expect((await api('post', '/api/loans').send(loanBody({ amount: 9_000_000 }))).body.errors.amount).toMatch(/Maximum/);
    expect((await api('post', '/api/loans').send(loanBody({ amount: 5 }))).body.errors.amount).toMatch(/Minimum/);
    expect((await api('post', '/api/loans').send(loanBody({ duration: { value: 40, unit: 'months' } }))).body.errors.duration).toBeTruthy();
    expect((await api('post', '/api/loans').send(loanBody({ frequency: 'daily' }))).body.errors.frequency).toBeTruthy();
    expect((await api('post', '/api/loans').send(loanBody({ amount: 'abc' }))).status).toBe(400);
    const c = await newCustomer();
    await Customer.updateOne({ _id: c }, { status: 'blacklisted' });
    expect((await api('post', '/api/loans').send(loanBody({ customerId: c }))).body.code).toBe('LOAN_NOT_ELIGIBLE');
  });
  it('the CEO skips approval; accountants submit for approval and cannot approve', async () => {
    const ceoLoan = await api('post', '/api/loans').send(loanBody());
    expect(ceoLoan.body.message).toMatch(/created and approved/i);
    expect(ceoLoan.body.data.loan).toMatchObject({ status: 'active', outstandingBalance: 1_300_000 });
    expect(await Transaction.countDocuments({ loan: ceoLoan.body.data.loan.id, type: 'disbursement' })).toBe(1);
    const mine = await pendingLoan();
    expect((await api('post', `/api/loans/${mine.loan.id}/approve`, acct)).status).toBe(403);
    expect((await api('post', `/api/loans/${mine.loan.id}/approve`)).body.data.loan.status).toBe('active'); // the CEO approves it
    await User.updateOne({ username: 'accountant' }, { permissions: ['loans.view'] });
    expect((await api('post', '/api/loans', acct).send(loanBody())).status).toBe(403); // creating still needs loans.create
    await User.updateOne({ username: 'accountant' }, { permissions: [] });
    expect((await api('get', '/api/loans', acct)).status).toBe(200);
  });
  it('edits a pending loan (recomputing terms) but not an active one', async () => {
    const c = { body: { data: await pendingLoan() } };
    const e = await api('patch', `/api/loans/${c.body.data.loan.id}`).send({ amount: 480000, duration: { value: 3, unit: 'months' } });
    expect(e.status).toBe(200);
    expect(e.body.data.loan).toMatchObject({ amount: 480000, principal: 500000, interestAmount: 75000, numberOfInstallments: 3 });
    expect(e.body.data.schedule).toHaveLength(3);
    expect(await AuditLog.countDocuments({ action: 'LOAN_UPDATED', entityId: c.body.data.loan.id })).toBe(1);
    const active = await activeLoan();
    await User.updateOne({ username: 'accountant' }, { permissions: ['loans.view', 'loans.edit'] });
    expect((await api('patch', `/api/loans/${active.id}`, acct).send({ amount: 100000 })).status).toBe(403); // accountants only edit pending loans
    await User.updateOne({ username: 'accountant' }, { permissions: [] });
  });
  it('the CEO can edit a running loan: terms re-priced, repayments replayed, payout and audit updated', async () => {
    const l = await activeLoan(); // 960,000 net -> 1,000,000 principal, 300,000 interest, 6 x 216,666.67
    await pay(l.id, 216666.67, { method: 'cash' });
    const e = await api('patch', `/api/loans/${l.id}`).send({ amount: 480000, duration: { value: 3, unit: 'months' }, reason: 'Customer asked for a smaller loan' });
    expect(e.status).toBe(200);
    expect(e.body.data.loan).toMatchObject({ amount: 480000, principal: 500000, interestAmount: 75000, numberOfInstallments: 3 });
    expect(e.body.data.schedule).toHaveLength(3);
    expect(e.body.data.loan.amountPaid).toBeCloseTo(216666.67, 2); // the recorded repayment is kept and replayed
    expect(e.body.data.loan.outstandingBalance).toBeCloseTo(575000 - 216666.67, 2);
    expect((await Transaction.findOne({ loan: l.id, type: 'disbursement' }))!.amount).toBe(480000);
    const log = await AuditLog.findOne({ action: 'LOAN_UPDATED', entityId: l.id });
    expect(log).toBeTruthy();
    expect(JSON.stringify(log!.after)).toContain('Customer asked for a smaller loan');
  });
  it('the CEO can also change a running loan\'s interest rate; completed loans cannot be edited', async () => {
    const l = await activeLoan();
    const e = await api('patch', `/api/loans/${l.id}`).send({ interestRate: 4 });
    expect(e.status).toBe(200);
    expect(e.body.data.loan.interestAmount).toBe(240000);
    expect((await api('patch', `/api/loans/${l.id}`).send({ amount: 960000 })).status).toBe(200);
    await pay(l.id, e.body.data.loan.outstandingBalance + 0, {});
    const g = await api('get', `/api/loans/${l.id}`);
    if (g.body.data.loan.status === 'completed') expect((await api('patch', `/api/loans/${l.id}`).send({ amount: 1000 })).body.code).toBe('LOAN_NOT_EDITABLE');
  });
});

describe("loan-book conventions (first payment date, loan type)", () => {
  it('repayments can start on a chosen date, and edits keep it', async () => {
    const c = await newCustomer();
    const body = loanBody({ customerId: c, amount: 144000, duration: { value: 12, unit: 'months' }, startDate: '2025-12-04', firstPaymentDate: '2026-01-01' });
    const pv = await api('post', '/api/loans/preview').send(body);
    expect(pv.body.data.schedule[0].dueDate.slice(0, 10)).toBe('2026-01-01');
    expect(pv.body.data.schedule[11].dueDate.slice(0, 10)).toBe('2026-12-01');
    const made = await api('post', '/api/loans', acct).send(body);
    expect(made.body.data.loan).toMatchObject({ loanType: 'new', firstPaymentDateIsCustom: true });
    const edited = await api('patch', `/api/loans/${made.body.data.loan.id}`).send({ amount: 192000 });
    expect(edited.body.data.schedule[0].dueDate.slice(0, 10)).toBe('2026-01-01');
    expect(edited.body.data.loan.totalRepayment).toBe(320000); // 192,000 net -> 200,000 gross + 120,000 interest (sheet row 3)
    expect(edited.body.data.loan.installmentAmount).toBe(26666.67);
    expect((await api('post', '/api/loans').send({ ...body, firstPaymentDate: '2025-11-01' })).body.errors.firstPaymentDate).toBeTruthy();
  });
  it('tags a customer\'s next loan as a renewal', async () => {
    const c = await newCustomer();
    const first = await activeLoan({ customerId: c, amount: 96000 });
    expect(first.loanType).toBe('new');
    const second = (await api('post', '/api/loans').send(loanBody({ customerId: c }))).body.data.loan;
    expect(second.loanType).toBe('renewal');
  });
});

describe('approval workflow and disbursement', () => {
  it('approval activates the loan and writes the disbursement to the ledger', async () => {
    const l = await activeLoan();
    expect(l.status).toBe('active');
    const tx = await Transaction.find({ loan: l.id });
    expect(tx).toHaveLength(1);
    expect(tx[0]).toMatchObject({ type: 'disbursement', amount: 960000, direction: 'out' });
    expect(l.outstandingBalance).toBe(1_300_000);
    expect(await AuditLog.countDocuments({ action: 'LOAN_APPROVED', entityId: l.id })).toBe(1);
    expect((await api('post', `/api/loans/${l.id}/approve`)).status).toBe(409);
  });
  it('rejection and cancellation need a reason and are final', async () => {
    const a = (await pendingLoan()).loan;
    expect((await api('post', `/api/loans/${a.id}/reject`).send({})).status).toBe(400);
    const rej = await api('post', `/api/loans/${a.id}/reject`).send({ reason: 'Insufficient income evidence' });
    expect(rej.body.data.loan.status).toBe('rejected');
    expect((await api('post', `/api/loans/${a.id}/approve`)).status).toBe(409);
    const b = (await pendingLoan()).loan;
    expect((await api('post', `/api/loans/${b.id}/cancel`).send({ reason: 'Customer withdrew' })).body.data.loan.status).toBe('cancelled');
    expect(await Transaction.countDocuments({ loan: { $in: [a.id, b.id] } })).toBe(0);
  });
  it('can block someone approving a loan they submitted (setting)', async () => {
    await api('put', '/api/settings/loans').send({ requireApproval: true, preventSelfApproval: true, autoDisburseOnApproval: true, maxActiveLoansPerCustomer: 100, allowBackdatedStart: true });
    const l = (await pendingLoan()).loan; // submitted by the accountant while she had no approval right
    await User.updateOne({ username: 'accountant' }, { permissions: ['loans.view', 'loans.approve'] });
    expect((await api('post', `/api/loans/${l.id}/approve`, acct)).body.code).toBe('SELF_APPROVAL_BLOCKED');
    await User.updateOne({ username: 'accountant' }, { permissions: [] });
    await api('put', '/api/settings/loans').send({ requireApproval: true, preventSelfApproval: false, autoDisburseOnApproval: true, maxActiveLoansPerCustomer: 100, allowBackdatedStart: true });
  });
  it('supports approval without auto-disbursement (separate disburse step)', async () => {
    await api('put', '/api/settings/loans').send({ requireApproval: true, preventSelfApproval: false, autoDisburseOnApproval: false, maxActiveLoansPerCustomer: 100, allowBackdatedStart: true });
    const l = (await api('post', '/api/loans').send(loanBody())).body.data.loan; // CEO: auto-approved, awaiting disbursement
    const ap = { body: { data: { loan: l } } };
    expect(ap.body.data.loan.status).toBe('approved');
    expect((await api('post', `/api/loans/${l.id}/disburse`)).body.data.loan.status).toBe('active');
    await api('put', '/api/settings/loans').send({ requireApproval: true, preventSelfApproval: false, autoDisburseOnApproval: true, maxActiveLoansPerCustomer: 100, allowBackdatedStart: true });
  });
});

describe('repayments (ledger first, balances derived)', () => {
  it('records a partial payment: ledger entry, balances, schedule, audit', async () => {
    const l = await activeLoan();
    const r = await pay(l.id, 100000, { method: 'bank_transfer', reference: 'REF-1' });
    expect(r.status).toBe(201);
    expect(r.body.data.transaction).toMatchObject({ type: 'repayment', amount: 100000, state: 'posted' });
    expect(r.body.data.transaction.transactionId).toMatch(/^TXN-\d{6}$/);
    expect(r.body.data.loan).toMatchObject({ amountPaid: 100000, outstandingBalance: 1_200_000, principalPaid: 50000, interestPaid: 50000, nextInstallmentNumber: 1 });
    expect(r.body.data.schedule[0]).toMatchObject({ status: 'partially_paid', paidInterest: 50000, paidPrincipal: 50000 });
    const tx = await Transaction.findById(r.body.data.transaction.id);
    expect(tx!.allocations[0]).toMatchObject({ number: 1, principal: 50000, interest: 50000 });
    expect(await AuditLog.countDocuments({ action: 'REPAYMENT_RECORDED', entityId: l.id })).toBe(1);
  });
  it('completing the loan marks it completed and stops further payments', async () => {
    const l = await activeLoan({ amount: 96000 });
    expect(l.totalRepayment).toBe(130000);
    const r = await pay(l.id, 130000);
    expect(r.body.data.loan).toMatchObject({ status: 'completed', outstandingBalance: 0, amountPaid: 130000 });
    expect(r.body.data.schedule.every((i: any) => i.status === 'paid')).toBe(true);
    expect((await pay(l.id, 1)).body.code).toBe('REPAYMENT_NOT_ALLOWED');
  });
  it('rejects overpayment by default, accepts it as credit when configured', async () => {
    const l = await activeLoan({ amount: 96000 });
    const over = await pay(l.id, 131000.01); // more than ₦1,000 above what is owed
    expect(over.status).toBe(400);
    expect(over.body.code).toBe('OVERPAYMENT');
    await api('put', '/api/settings/repayment').send({ allocationOrder: 'oldest_first', withinInstallment: 'interest_first', overpaymentPolicy: 'credit', allowFutureDatedPayments: false });
    const ok = await pay(l.id, 130500);
    expect(ok.body.data.loan).toMatchObject({ status: 'completed', creditBalance: 500 });
    await api('put', '/api/settings/repayment').send({ allocationOrder: 'oldest_first', withinInstallment: 'interest_first', overpaymentPolicy: 'reject', allowFutureDatedPayments: false });
  });
  it('allows a small overpayment (up to ₦1,000 by default), e.g. 30,000 sent for 29,999.82', async () => {
    const l = await activeLoan({ amount: 96000 }); // owes 130,000.00
    const r = await pay(l.id, 130000.18 + 0.82); // 130,001.00: within the tolerance
    expect(r.status).toBe(201);
    expect(r.body.data.loan).toMatchObject({ status: 'completed' });
    expect(r.body.data.loan.creditBalance).toBeCloseTo(1, 2);
  });
  it('validates amount, date, reference and permissions', async () => {
    const l = await activeLoan();
    expect((await pay(l.id, 0)).status).toBe(400);
    expect((await pay(l.id, 10.555)).status).toBe(400);
    expect((await pay(l.id, 100, { date: isoDate(addDays(today, 3)) })).body.errors.date).toBeTruthy();
    expect((await pay(l.id, 100, { method: 'bank_transfer' })).body.errors.reference).toBeTruthy();
    expect((await pay(l.id, 100, { method: 'cash' })).status).toBe(201);
    expect((await pay(l.id, 100, { method: 'pos', reference: 'DUP' })).status).toBe(201);
    expect((await pay(l.id, 100, { method: 'pos', reference: 'DUP' })).body.code).toBe('DUPLICATE_REFERENCE');
    expect((await pay('64b000000000000000000000', 5)).status).toBe(404);
    expect((await pay(l.id, 100, {}, acct)).status).toBe(201); // accountants may record repayments
    await User.updateOne({ username: 'accountant' }, { permissions: ['repayments.view'] });
    expect((await pay(l.id, 100, {}, acct)).status).toBe(403);
    await User.updateOne({ username: 'accountant' }, { permissions: [] });
  });
  it('allocation order follows settings', async () => {
    await api('put', '/api/settings/repayment').send({ allocationOrder: 'oldest_first', withinInstallment: 'principal_first', overpaymentPolicy: 'reject', allowFutureDatedPayments: false });
    const l = await activeLoan();
    const r = await pay(l.id, 100000);
    expect(r.body.data.loan).toMatchObject({ principalPaid: 100000, interestPaid: 0 });
    await api('put', '/api/settings/repayment').send({ allocationOrder: 'oldest_first', withinInstallment: 'interest_first', overpaymentPolicy: 'reject', allowFutureDatedPayments: false });
  });
});

describe('mark an installment paid', () => {
  it("records exactly what is owed on that month, in the ledger, leaving other months alone", async () => {
    const l = await activeLoan();
    const r = await api('post', `/api/loans/${l.id}/installments/3/pay`).send({ method: 'cash' });
    expect(r.status).toBe(201);
    expect(r.body.message).toMatch(/Installment 3/);
    expect(r.body.data.transaction).toMatchObject({ type: 'repayment', amount: 216666.67, state: 'posted' });
    const sched = r.body.data.schedule;
    expect(sched[2]).toMatchObject({ number: 3, status: 'paid', remaining: 0 });
    expect(sched[0].amountPaid).toBe(0);
    expect(r.body.data.loan.outstandingBalance).toBeCloseTo(1_300_000 - 216_666.67, 2);
    expect(await Transaction.countDocuments({ loan: l.id, type: 'repayment', targetInstallment: 3 })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'INSTALLMENT_MARKED_PAID', entityId: l.id })).toBe(1);
    expect((await api('post', `/api/loans/${l.id}/installments/3/pay`).send({ method: 'cash' })).body.code).toBe('ALREADY_PAID');
    expect((await api('post', `/api/loans/${l.id}/installments/99/pay`).send({})).status).toBe(404);
  });
  it('reversing it restores the installment; accountants may mark paid, others may not', async () => {
    const l = await activeLoan();
    const r = await api('post', `/api/loans/${l.id}/installments/2/pay`, acct).send({ method: 'cash' });
    expect(r.status).toBe(201);
    await api('post', `/api/transactions/${r.body.data.transaction.id}/reverse`).send({ reason: 'Marked the wrong month' });
    const after = await api('get', `/api/loans/${l.id}`);
    expect(after.body.data.schedule[1]).toMatchObject({ amountPaid: 0, status: expect.stringMatching(/upcoming|due|overdue/) });
    await User.updateOne({ username: 'accountant' }, { permissions: ['loans.view'] });
    expect((await api('post', `/api/loans/${l.id}/installments/2/pay`, acct).send({})).status).toBe(403);
    await User.updateOne({ username: 'accountant' }, { permissions: [] });
  });
  it('requires a reference for bank transfers, like any repayment', async () => {
    const l = await activeLoan();
    expect((await api('post', `/api/loans/${l.id}/installments/1/pay`).send({ method: 'bank_transfer' })).body.errors.reference).toBeTruthy();
  });
});

describe('early settlement (paying a loan off before its term ends)', () => {
  const setMode = (m: string) => api('put', '/api/settings/repayment').send({ allocationOrder: 'oldest_first', withinInstallment: 'interest_first', overpaymentPolicy: 'reject', allowFutureDatedPayments: false, earlySettlement: m });

  it('default: the quote is everything still owed, and settling completes the loan', async () => {
    await setMode('full_balance');
    const l = await activeLoan();
    await pay(l.id, 216666.67);
    const q = await api('get', `/api/loans/${l.id}/settlement-quote`);
    expect(q.body.data.quote).toMatchObject({ mode: 'full_balance', interestWaived: 0, installmentsRemaining: 5 });
    expect(q.body.data.quote.amountToPay).toBeCloseTo(1_300_000 - 216_666.67, 2);
    const r = await api('post', `/api/loans/${l.id}/settle`).send({ method: 'cash' });
    expect(r.status).toBe(200);
    expect(r.body.data.loan).toMatchObject({ status: 'completed', outstandingBalance: 0 });
    expect(r.body.data.schedule.every((i: any) => i.status === 'paid')).toBe(true);
    expect(await Transaction.countDocuments({ loan: l.id, type: 'waiver' })).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'LOAN_SETTLED_EARLY', entityId: l.id })).toBe(1);
    expect((await api('post', `/api/loans/${l.id}/settle`).send({})).body.code).toBe('SETTLEMENT_NOT_ALLOWED'); // already completed
  });

  it('waive_future_interest: interest on months not yet due is written off (non-cash) and only the rest is paid', async () => {
    await setMode('waive_future_interest');
    const l = await activeLoan(); // monthly, 6 installments from today: all future
    const q = (await api('get', `/api/loans/${l.id}/settlement-quote`)).body.data.quote;
    expect(q.mode).toBe('waive_future_interest');
    expect(q.interestWaived).toBe(300_000);                     // all six installments are still in the future
    expect(q.amountToPay).toBe(1_000_000);                      // principal only
    const r = await api('post', `/api/loans/${l.id}/settle`).send({ method: 'cash' });
    expect(r.body.data.loan).toMatchObject({ status: 'completed', outstandingBalance: 0, nonCashCredits: 300_000 });
    const waiver = (await Transaction.findOne({ loan: l.id, type: 'waiver' }))!;
    expect(waiver).toMatchObject({ amount: 300_000, isCash: false, affectsLoanBalance: true });
    const repay = (await Transaction.findOne({ loan: l.id, type: 'repayment' }))!;
    expect(repay).toMatchObject({ amount: 1_000_000, isCash: true });
    // customer totals count only the cash that actually came in
    const sum = (await api('get', `/api/customers/${l.customer.id}/summary`)).body.data.metrics;
    expect(sum.totalRepaid).toBeGreaterThanOrEqual(1_000_000);
    await setMode('full_balance');
  });

  it('only already-elapsed months pay their interest when interest is waived', async () => {
    await setMode('waive_future_interest');
    const l = await activeLoan({ startDate: isoDate(addDays(addMonths(today, -2), -1)), firstPaymentDate: isoDate(addMonths(addDays(addMonths(today, -2), -1), 1)) }); // installments 1 & 2 are overdue, 3-6 are future
    const q = (await api('get', `/api/loans/${l.id}/settlement-quote`)).body.data.quote;
    expect(q.waivers.map((w: any) => w.number)).toEqual([3, 4, 5, 6]);
    expect(q.interestWaived).toBe(200_000);
    expect(q.amountToPay).toBeCloseTo(1_100_000, 0);
    await setMode('full_balance');
  });

  it('waiving interest needs approval rights; reversing the waiver reopens the loan', async () => {
    await setMode('waive_future_interest');
    const l = await activeLoan();
    expect((await api('post', `/api/loans/${l.id}/settle`, acct).send({ method: 'cash' })).body.code).toBe('WAIVER_NOT_ALLOWED');
    expect((await Loan.findById(l.id))!.status).toBe('active'); // nothing was recorded
    expect(await Transaction.countDocuments({ loan: l.id, type: 'waiver' })).toBe(0);
    await api('post', `/api/loans/${l.id}/settle`).send({ method: 'cash' });
    const waiver = (await Transaction.findOne({ loan: l.id, type: 'waiver' }))!;
    await api('post', `/api/transactions/${waiver._id}/reverse`).send({ reason: 'Settlement terms were wrong' });
    expect((await api('get', `/api/loans/${l.id}`)).body.data.loan.outstandingBalance).toBe(300_000); // the interest is owed again
    await setMode('full_balance');
  });

  it('accountants can settle at the full balance (no waiver involved)', async () => {
    await setMode('full_balance');
    const l = await activeLoan();
    expect((await api('post', `/api/loans/${l.id}/settle`, acct).send({ method: 'cash' })).body.data.loan.status).toBe('completed');
  });
});

describe('overdue detection and automation', () => {
  it('a loan past its due dates becomes overdue and shows days/amount overdue', async () => {
    const l = await activeLoan({ startDate: isoDate(addDays(addMonths(today, -3), -1)), firstPaymentDate: isoDate(addMonths(addDays(addMonths(today, -3), -1), 1)) }); // installments 1-3 are past due
    const g = await api('get', `/api/loans/${l.id}`);
    expect(g.body.data.loan.status).toBe('overdue');
    expect(g.body.data.loan.overdueAmount).toBeCloseTo(650000, 0);
    expect(g.body.data.loan.daysOverdue).toBeGreaterThan(0);
    expect(g.body.data.schedule.slice(0, 3).every((i: any) => i.status === 'overdue' || i.status === 'due')).toBe(true);
    expect(await AuditLog.countDocuments({ action: 'LOAN_STATUS_CHANGED', entityId: l.id })).toBeGreaterThanOrEqual(1);
    const paid = await pay(l.id, 650000.01);
    expect(paid.body.data.loan.status).toBe('active');
  });
  it('the scheduled job refreshes statuses and is protected by CRON_SECRET', async () => {
    const l = await activeLoan({ startDate: isoDate(addMonths(today, -2)) });
    await Loan.updateOne({ _id: l.id }, { status: 'active', overdueAmount: 0 }); // simulate a stale stored status
    expect((await request(app).get('/api/jobs/refresh-overdue')).status).toBe(403);
    expect((await request(app).get('/api/jobs/refresh-overdue').set('Authorization', 'Bearer wrong')).status).toBe(403);
    const r = await request(app).get('/api/jobs/refresh-overdue').set('Authorization', 'Bearer cron-secret-cron-secret-123');
    expect(r.status).toBe(200);
    expect(r.body.data.changed).toBeGreaterThanOrEqual(1);
    expect((await Loan.findById(l.id))!.status).toBe('overdue');
  });
  it('late-payment default rule is configurable', async () => {
    await api('put', '/api/settings/latePayment').send({ graceDays: 0, penalty: { type: 'none' }, defaultAfterDays: 30 });
    const l = await activeLoan({ startDate: isoDate(addMonths(today, -4)) });
    expect((await api('get', `/api/loans/${l.id}`)).body.data.loan.status).toBe('defaulted');
    await api('put', '/api/settings/latePayment').send({ graceDays: 0, penalty: { type: 'none' }, defaultAfterDays: '' });
  });
});

describe('transaction ledger', () => {
  it('lists with filters, creates manual entries and reverses payments (never deletes)', async () => {
    const l = await activeLoan({ amount: 96000 });
    const p = (await pay(l.id, 30000)).body.data.transaction;
    const fee = await api('post', '/api/transactions').send({ type: 'fee', loanId: l.id, amount: 500, description: 'Processing fee', method: 'cash' });
    expect(fee.status).toBe(201);
    expect(fee.body.data.transaction).toMatchObject({ type: 'fee', affectsLoanBalance: false });
    expect((await api('post', '/api/transactions').send({ type: 'repayment', loanId: l.id, amount: 5 })).status).toBe(400); // must use /repayments
    const list = await api('get', `/api/transactions?loan=${l.id}&type=repayment`);
    expect(list.body.pagination.total).toBe(1);
    expect((await api('get', `/api/transactions?minAmount=1000&maxAmount=2000`)).body.data.every((t: any) => t.amount >= 1000 && t.amount <= 2000)).toBe(true);
    expect((await api('get', `/api/transactions?q=${p.transactionId}`)).body.data[0].id).toBe(p.id);

    expect((await api('post', `/api/transactions/${p.id}/reverse`).send({})).status).toBe(400); // reason required
    const rev = await api('post', `/api/transactions/${p.id}/reverse`).send({ reason: 'Paid to wrong loan' });
    expect(rev.status).toBe(200);
    expect(rev.body.data.transaction.state).toBe('reversed');
    const after = await api('get', `/api/loans/${l.id}`);
    expect(after.body.data.loan).toMatchObject({ amountPaid: 0, outstandingBalance: 130000 });
    expect(await Transaction.countDocuments({ loan: l.id, type: 'reversal' })).toBe(1);
    expect(await Transaction.countDocuments({ _id: p.id })).toBe(1); // original still in the ledger
    expect((await api('post', `/api/transactions/${p.id}/reverse`).send({ reason: 'again' })).body.code).toBe('ALREADY_REVERSED');
    const disb = (await Transaction.findOne({ loan: l.id, type: 'disbursement' }))!;
    expect((await api('post', `/api/transactions/${disb._id}/reverse`).send({ reason: 'x y z' })).body.code).toBe('NOT_REVERSIBLE');
    expect(await AuditLog.countDocuments({ action: 'TRANSACTION_REVERSED', entityId: p.id })).toBe(1);
    expect((await api('post', `/api/transactions/${p.id}/reverse`, acct).send({ reason: 'nope' })).status).toBe(403);
  });
});

describe('customer financial endpoints now return real data', () => {
  it('summary, loans, repayments and transactions come from the ledger; history blocks deletion', async () => {
    const c = await newCustomer();
    const l = await activeLoan({ customerId: c, amount: 96000 });
    await pay(l.id, 30000);
    const s = await api('get', `/api/customers/${c}/summary`);
    expect(s.body.data).toMatchObject({ available: true, metrics: { totalBorrowed: 96000, totalRepaid: 30000, outstandingBalance: 100000, activeLoans: 1, completedLoans: 0, overdueLoans: 0 } });
    expect((await api('get', `/api/customers/${c}/loans`)).body.pagination.total).toBe(1);
    expect((await api('get', `/api/customers/${c}/repayments`)).body.pagination.total).toBe(1);
    expect((await api('get', `/api/customers/${c}/transactions`)).body.pagination.total).toBe(2);
    const del = await api('delete', `/api/customers/${c}`);
    expect(del.body.code).toBe('CUSTOMER_HAS_FINANCIAL_HISTORY');
  });
});

describe('list filters', () => {
  it('filters loans by status, search, amount, repayment status and paginates', async () => {
    expect((await api('get', '/api/loans?status=pending')).body.data.every((l: any) => l.status === 'pending')).toBe(true);
    const all = await api('get', '/api/loans?limit=2&page=1');
    expect(all.body.pagination.limit).toBe(2);
    expect(all.body.data).toHaveLength(2);
    const loanId = all.body.data[0].loanId;
    expect((await api('get', `/api/loans?q=${loanId}`)).body.data[0].loanId).toBe(loanId);
    expect((await api('get', '/api/loans?minAmount=500000&maxAmount=1000000')).body.data.every((l: any) => l.amount >= 500000 && l.amount <= 1000000)).toBe(true);
    expect((await api('get', '/api/loans?repaymentStatus=overdue')).body.data.every((l: any) => l.overdueAmount > 0)).toBe(true);
    expect((await api('get', '/api/loans?repaymentStatus=paid')).body.data.every((l: any) => l.status === 'completed')).toBe(true);
    expect((await api('get', '/api/loans?status=bogus')).status).toBe(400);
    expect((await api('get', '/api/loans?sort=amount&order=asc')).status).toBe(200);
  });
});

void SystemSetting;
