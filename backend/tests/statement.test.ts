import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken, customerPayload } from './helpers.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { User } from '../src/models/User.js';
import { Loan } from '../src/models/Loan.js';

let ceo = ''; let acct = ''; let product = ''; let cust = ''; let n = 0;
const api = (m: 'get' | 'post' | 'put', url: string, t = ceo) => (request(app) as any)[m](url).set(as(t));
const bin = (res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); };
beforeAll(async () => {
  await setupDb(); ceo = await ceoToken(); acct = await accountantToken();
  product = (await api('post', '/api/loan-products').send({ name: 'Salary Advance', code: 'SAL', category: 'Salary advance', interestRate: 5, rateBasis: 'per_month', applicationFeeRate: 4, allowedFrequencies: ['monthly'], defaultFrequency: 'monthly' })).body.data.product.id;
  const c = await api('post', '/api/customers').send(customerPayload({ firstName: 'Omoloro', middleName: '', lastName: 'Sylvia', employment: { sector: 'government', ippisNumber: '437602', ministry: 'OSGF', occupation: 'Clerk' } }));
  cust = c.body.data.customer.id;
});
afterAll(teardownDb);

/** Protech loan-book row 3: ₦192,000 taken -> ₦200,000 principal, ₦120,000 interest, ₦320,000 total, EMI ₦26,666.67. */
const newLoan = async () => (await api('post', '/api/loans').send({ customerId: cust, productId: product, amount: 200000, duration: { value: 12, unit: 'months' }, startDate: '2026-01-05', firstPaymentDate: '2026-02-01' })).body.data.loan;
const pay = (loanId: string, amount: number, date: string, reference?: string) => api('post', '/api/repayments').send({ loanId, amount, date, method: 'bank_transfer', reference: reference ?? `R-${loanId.slice(-3)}-${amount}-${date}` });
const stmt = async (path: string, qs = '') => (await api('get', `${path}/statement${qs}`)).body.data.statement;

describe('loan statement (DR / CR / balance from the ledger)', () => {
  it('shows client info, loan info and a running balance that always ends at the loan balance', async () => {
    const l = await newLoan();
    await pay(l.id, 26666.67, '2026-02-01'); await pay(l.id, 26666.67, '2026-03-01'); await pay(l.id, 10000, '2026-03-15');
    const s = await stmt(`/api/loans/${l.id}`);
    expect(s.client).toMatchObject({ name: 'Omoloro Sylvia', ippisNumber: '437602', ministry: 'OSGF' });
    const loan = s.loans[0].loan;
    expect(loan).toMatchObject({ applicationFee: 8000, principal: 200000, interest: 120000, totalLoan: 320000, emi: 26666.67, numberOfInstallments: 12 });
    expect(loan.paymentDate.slice(0, 10)).toBe('2026-01-05'); expect(loan.firstRepaymentDate.slice(0, 10)).toBe('2026-02-01');
    const rows = s.loans[0].rows;
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({ debit: 320000, credit: 0, balance: 320000 });
    expect(rows[1]).toMatchObject({ debit: 0, credit: 26666.67, balance: 293333.33 });
    expect(rows[2].balance).toBeCloseTo(266666.66, 2);
    expect(rows[3]).toMatchObject({ credit: 10000 });
    expect(rows.every((r: any) => r.reference && r.description)).toBe(true);
    const t = s.loans[0].totals;
    expect(t).toMatchObject({ debit: 320000 }); expect(t.credit).toBeCloseTo(63333.34, 2);
    expect(t.closingBalance).toBeCloseTo(320000 - 63333.34, 2);
    expect(t.closingBalance).toBeCloseTo(loan.currentOutstanding, 2); // statement and loan agree
  });

  it('shows a reversed payment as the payment plus an offsetting debit, and still balances', async () => {
    const l = await newLoan();
    const p = (await pay(l.id, 30000, '2026-02-01')).body.data.transaction;
    await api('post', `/api/transactions/${p.id}/reverse`).send({ reason: 'Bounced transfer' });
    const s = await stmt(`/api/loans/${l.id}`); const rows = s.loans[0].rows;
    expect(rows.map((r: any) => [r.debit, r.credit])).toEqual([[320000, 0], [0, 30000], [30000, 0]]);
    expect(rows[1].description).toMatch(/reversed/);
    expect(rows[2].description).toMatch(/Reversal/);
    expect(s.loans[0].totals.closingBalance).toBe(320000);
    expect(s.loans[0].totals.closingBalance).toBeCloseTo(s.loans[0].loan.currentOutstanding, 2);
  });

  it('lists waived interest as a credit after an early settlement', async () => {
    await api('put', '/api/settings/repayment').send({ allocationOrder: 'oldest_first', withinInstallment: 'interest_first', overpaymentPolicy: 'reject', allowFutureDatedPayments: false, earlySettlement: 'waive_future_interest' });
    const l = await newLoan();
    await api('post', `/api/loans/${l.id}/settle`).send({ method: 'cash' });
    const s = await stmt(`/api/loans/${l.id}`); const rows = s.loans[0].rows;
    expect(rows.some((r: any) => /Interest waived/.test(r.description) && r.credit > 0)).toBe(true);
    expect(s.loans[0].totals.closingBalance).toBe(0);
    await api('put', '/api/settings/repayment').send({ allocationOrder: 'oldest_first', withinInstallment: 'interest_first', overpaymentPolicy: 'reject', allowFutureDatedPayments: false, earlySettlement: 'full_balance' });
  });

  it('can be limited to a period, with the earlier balance brought forward', async () => {
    const l = await newLoan();
    await pay(l.id, 26666.67, '2026-02-01'); await pay(l.id, 26666.67, '2026-03-01'); await pay(l.id, 26666.67, '2026-04-01');
    const s = await stmt(`/api/loans/${l.id}`, '?from=2026-03-01&to=2026-03-31');
    const rows = s.loans[0].rows;
    expect(rows[0]).toMatchObject({ description: 'Balance brought forward' });
    expect(rows[0].balance).toBeCloseTo(293333.33, 2);
    expect(rows).toHaveLength(2);
    expect(s.loans[0].totals.closingBalance).toBeCloseTo(266666.66, 2);
  });

  it('a client statement shows the current loan once by default', async () => {
    const s = await stmt(`/api/customers/${cust}`);
    expect(s.loans).toHaveLength(1);
    const latestOpen = await Loan.findOne({ customer: cust, status: { $in: ['active', 'overdue', 'defaulted'] } }).sort({ startDate: -1, createdAt: -1 });
    if (latestOpen) expect(s.loans[0].loan.loanId).toBe(latestOpen.loanId);
  });

  it('a client statement combines every disbursed loan when asked for the full history', async () => {
    const s = await stmt(`/api/customers/${cust}`, '?scope=all');
    expect(s.loans.length).toBeGreaterThanOrEqual(4);
    const open = s.loans.reduce((a: number, l: any) => a + l.totals.closingBalance, 0);
    expect(s.summary.closingBalance).toBeCloseTo(open, 2);
    expect(s.client.customerId).toMatch(/^PTC-/);
  });

  it('refuses statements for loans that were never disbursed', async () => {
    const pending = (await api('post', '/api/loans', acct).send({ customerId: cust, productId: product, amount: 50000, duration: { value: 6, unit: 'months' }, startDate: '2026-01-05' })).body.data.loan;
    expect((await api('get', `/api/loans/${pending.id}/statement`)).body.code).toBe('NO_STATEMENT');
    expect((await api('get', '/api/loans/not-an-id/statement')).status).toBe(404);
  });
});

describe('statement downloads and access', () => {
  it('exports PDF, Excel and CSV with the right columns, and audits each generation', async () => {
    const l = await newLoan(); await pay(l.id, 26666.67, '2026-02-01');
    const csv = await api('get', `/api/loans/${l.id}/statement?format=csv`);
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text).toContain('Transaction Date,Reference Number,Description,Debit (DR),Credit (CR),Balance');
    expect(csv.text).toContain('IPPIS Number,437602'); expect(csv.text).toContain('Client Name,Omoloro Sylvia'); expect(csv.text).toContain('Ministry / Organization,OSGF');
    expect(csv.text).toContain('Application Fee'); expect(csv.text).toContain('EMI');
    const pdf = await api('get', `/api/loans/${l.id}/statement?format=pdf`).buffer(true).parse(bin);
    expect(pdf.headers['content-type']).toMatch(/pdf/); expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    const xlsx = await api('get', `/api/loans/${l.id}/statement?format=xlsx`).buffer(true).parse(bin);
    expect(xlsx.body.subarray(0, 2).toString()).toBe('PK');
    expect(await AuditLog.countDocuments({ action: 'STATEMENT_GENERATED', entityId: l.id })).toBe(3);
    const log = await AuditLog.findOne({ action: 'STATEMENT_GENERATED', entityId: l.id });
    expect(log).toMatchObject({ userRole: 'ceo' });
  });
  it('is available to accountants (loans.view) but not without permission or login', async () => {
    const l = await newLoan();
    expect((await api('get', `/api/loans/${l.id}/statement?format=pdf`, acct)).status).toBe(200);
    expect((await api('get', `/api/customers/${cust}/statement`, acct)).status).toBe(200); // default accountants may view financials
    await User.updateOne({ username: 'accountant' }, { permissions: ['customers.read'] });
    expect((await api('get', `/api/loans/${l.id}/statement`, acct)).status).toBe(403);
    expect((await api('get', `/api/customers/${cust}/statement`, acct)).status).toBe(403);
    await User.updateOne({ username: 'accountant' }, { permissions: [] });
    expect((await request(app).get(`/api/loans/${l.id}/statement`)).status).toBe(401);
    expect((await api('get', `/api/loans/${l.id}/statement?format=exe`)).status).toBe(400);
  });
  it('closing balance on the statement equals the loan balance for every loan', async () => {
    for (const l of await Loan.find({ status: { $in: ['active', 'overdue', 'completed'] } })) {
      const s = await stmt(`/api/loans/${l._id}`);
      expect(s.loans[0].totals.closingBalance).toBeCloseTo(l.outstandingBalance, 2);
    }
  });
});
