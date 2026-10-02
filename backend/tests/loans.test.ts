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
/** Creates and activates a loan. */
async function activeLoan(over: Record<string, unknown> = {}) {
  const c = await api('post', '/api/loans').send(loanBody(over));
  expect(c.status).toBe(201);
  const a = await api('post', `/api/loans/${c.body.data.loan.id}/approve`);
  expect(a.status).toBe(200);
  return a.body.data.loan;
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

describe('loan creation and calculation (done by the backend)', () => {
  it('previews terms from the central engine', async () => {
    const r = await api('post', '/api/loans/preview').send(loanBody());
    expect(r.status).toBe(200);
    expect(r.body.data.terms).toMatchObject({ grossAmount: 1_000_000, interestAmount: 300_000, totalRepayment: 1_300_000, numberOfInstallments: 6 });
    expect(r.body.data.schedule).toHaveLength(6);
  });
  it('creates a pending loan with a schedule, and audits it', async () => {
    const r = await api('post', '/api/loans').send(loanBody());
    expect(r.status).toBe(201);
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
  it('requires permissions: accountants cannot create or approve', async () => {
    expect((await api('post', '/api/loans', acct).send(loanBody())).status).toBe(403);
    const c = await api('post', '/api/loans').send(loanBody());
    expect((await api('post', `/api/loans/${c.body.data.loan.id}/approve`, acct)).status).toBe(403);
    expect((await api('get', '/api/loans', acct)).status).toBe(200);
  });
  it('edits a pending loan (recomputing terms) but not an active one', async () => {
    const c = await api('post', '/api/loans').send(loanBody());
    const e = await api('patch', `/api/loans/${c.body.data.loan.id}`).send({ amount: 480000, duration: { value: 3, unit: 'months' } });
    expect(e.status).toBe(200);
    expect(e.body.data.loan).toMatchObject({ amount: 480000, principal: 500000, interestAmount: 75000, numberOfInstallments: 3 });
    expect(e.body.data.schedule).toHaveLength(3);
    expect(await AuditLog.countDocuments({ action: 'LOAN_UPDATED', entityId: c.body.data.loan.id })).toBe(1);
    const active = await activeLoan();
    expect((await api('patch', `/api/loans/${active.id}`).send({ amount: 100000 })).body.code).toBe('LOAN_NOT_EDITABLE');
  });
});

describe("loan-book conventions (first payment date, loan type)", () => {
  it('repayments can start on a chosen date, and edits keep it', async () => {
    const c = await newCustomer();
    const body = loanBody({ customerId: c, amount: 144000, duration: { value: 12, unit: 'months' }, startDate: '2025-12-04', firstPaymentDate: '2026-01-01' });
    const pv = await api('post', '/api/loans/preview').send(body);
    expect(pv.body.data.schedule[0].dueDate.slice(0, 10)).toBe('2026-01-01');
    expect(pv.body.data.schedule[11].dueDate.slice(0, 10)).toBe('2026-12-01');
    const made = await api('post', '/api/loans').send(body);
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
  it('approving activates the loan and writes the disbursement to the ledger', async () => {
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
    const a = (await api('post', '/api/loans').send(loanBody())).body.data.loan;
    expect((await api('post', `/api/loans/${a.id}/reject`).send({})).status).toBe(400);
    const rej = await api('post', `/api/loans/${a.id}/reject`).send({ reason: 'Insufficient income evidence' });
    expect(rej.body.data.loan.status).toBe('rejected');
    expect((await api('post', `/api/loans/${a.id}/approve`)).status).toBe(409);
    const b = (await api('post', '/api/loans').send(loanBody())).body.data.loan;
    expect((await api('post', `/api/loans/${b.id}/cancel`).send({ reason: 'Customer withdrew' })).body.data.loan.status).toBe('cancelled');
    expect(await Transaction.countDocuments({ loan: { $in: [a.id, b.id] } })).toBe(0);
  });
  it('can block self-approval through settings', async () => {
    await api('put', '/api/settings/loans').send({ requireApproval: true, preventSelfApproval: true, autoDisburseOnApproval: true, maxActiveLoansPerCustomer: '', allowBackdatedStart: true });
    const l = (await api('post', '/api/loans').send(loanBody())).body.data.loan;
    expect((await api('post', `/api/loans/${l.id}/approve`)).body.code).toBe('SELF_APPROVAL_BLOCKED');
    await api('put', '/api/settings/loans').send({ requireApproval: true, preventSelfApproval: false, autoDisburseOnApproval: true, maxActiveLoansPerCustomer: '', allowBackdatedStart: true });
  });
  it('supports approval without auto-disbursement (separate disburse step)', async () => {
    await api('put', '/api/settings/loans').send({ requireApproval: true, preventSelfApproval: false, autoDisburseOnApproval: false, maxActiveLoansPerCustomer: '', allowBackdatedStart: true });
    const l = (await api('post', '/api/loans').send(loanBody())).body.data.loan;
    const ap = await api('post', `/api/loans/${l.id}/approve`);
    expect(ap.body.data.loan.status).toBe('approved');
    expect((await api('post', `/api/loans/${l.id}/disburse`)).body.data.loan.status).toBe('active');
    await api('put', '/api/settings/loans').send({ requireApproval: true, preventSelfApproval: false, autoDisburseOnApproval: true, maxActiveLoansPerCustomer: '', allowBackdatedStart: true });
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
    const over = await pay(l.id, 130000.01);
    expect(over.status).toBe(400);
    expect(over.body.code).toBe('OVERPAYMENT');
    await api('put', '/api/settings/repayment').send({ allocationOrder: 'oldest_first', withinInstallment: 'interest_first', overpaymentPolicy: 'credit', allowFutureDatedPayments: false });
    const ok = await pay(l.id, 130500);
    expect(ok.body.data.loan).toMatchObject({ status: 'completed', creditBalance: 500 });
    await api('put', '/api/settings/repayment').send({ allocationOrder: 'oldest_first', withinInstallment: 'interest_first', overpaymentPolicy: 'reject', allowFutureDatedPayments: false });
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

describe('overdue detection and automation', () => {
  it('a loan past its due dates becomes overdue and shows days/amount overdue', async () => {
    const l = await activeLoan({ startDate: isoDate(addDays(addMonths(today, -3), -1)) }); // installments 1-3 are past due
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
