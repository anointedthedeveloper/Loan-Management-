import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken } from './helpers.js';
import { seedDemoData } from '../src/scripts/seedDemo.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Loan } from '../src/models/Loan.js';
import { Customer } from '../src/models/Customer.js';
import { User } from '../src/models/User.js';
import { Transaction } from '../src/models/Transaction.js';

let ceo = ''; let acct = '';
const api = (m: 'get' | 'post' | 'put' | 'patch', url: string, t = ceo) => (request(app) as any)[m](url).set(as(t));
beforeAll(async () => { await setupDb(); await seedDemoData(); ceo = await ceoToken(); acct = await accountantToken(); });
afterAll(teardownDb);

describe('settings', () => {
  it('restricts the full settings to settings.manage; any signed-in user gets public branding only', async () => {
    expect((await api('get', '/api/settings', acct)).status).toBe(403);
    expect((await api('put', '/api/settings/company', acct).send({})).status).toBe(403);
    const pub = await api('get', '/api/settings/public', acct);
    expect(pub.body.data.company.name).toBe('Protech');
    expect(JSON.stringify(pub.body)).not.toContain('allocationOrder');
    expect((await request(app).get('/api/settings/public')).status).toBe(401);
    const all = await api('get', '/api/settings');
    expect(Object.keys(all.body.data.settings)).toEqual(expect.arrayContaining(['company', 'loans', 'repayment', 'latePayment', 'topup', 'transactions', 'preferences']));
  });
  it('validates values, saves, falls back to defaults and audits changes', async () => {
    const bad = await api('put', '/api/settings/repayment').send({ allocationOrder: 'random' });
    expect(bad.status).toBe(400);
    expect((await api('put', '/api/settings/nope').send({})).status).toBe(404);
    expect((await api('put', '/api/settings/latePayment').send({ graceDays: -1, penalty: { type: 'none' }, defaultAfterDays: '' })).status).toBe(400);
    const r = await api('put', '/api/settings/company').send({ name: 'Protech Finance', address: 'Lagos', phone: '', email: 'info@protech.ng', rcNumber: 'RC123', currency: 'NGN' });
    expect(r.body.data.company.name).toBe('Protech Finance');
    const log = await AuditLog.findOne({ action: 'SETTINGS_CHANGED', entityId: 'company' });
    expect(log?.before).toMatchObject({ name: 'Protech' });
    expect(log?.after).toMatchObject({ name: 'Protech Finance' });
    await api('put', '/api/settings/company').send({ name: 'Protech', address: '', phone: '', email: '', rcNumber: '', currency: 'NGN' });
  });
});

describe('reports', () => {
  it('lists the catalogue and runs every report with totals', async () => {
    const cat = (await api('get', '/api/reports')).body.data.reports.map((r: any) => r.key);
    expect(cat).toEqual(expect.arrayContaining(['loans', 'repayments', 'outstanding', 'overdue', 'customers', 'collections-daily', 'collections-weekly', 'collections-monthly', 'disbursements', 'topups', 'transactions']));
    for (const key of cat) {
      const r = await api('get', `/api/reports/${key}`);
      expect(r.status, key).toBe(200);
      expect(r.body.data.columns.length).toBeGreaterThan(0);
    }
    const loans = (await api('get', '/api/reports/loans')).body.data;
    expect(loans.rows.length).toBe(await Loan.countDocuments({ status: { $in: ['active', 'overdue', 'defaulted'] } })); // current loans only
    const sumOut = loans.rows.reduce((s: number, r: any) => s + r.outstandingBalance, 0);
    expect(loans.totals.outstandingBalance).toBeCloseTo(sumOut, 2);
    expect((await api('get', '/api/reports/nope')).status).toBe(404);
  });
  it('filters by date range and keeps cash-only figures honest', async () => {
    expect((await api('get', '/api/reports/repayments?from=2000-01-01&to=2000-01-31')).body.data.rows).toEqual([]);
    const rep = (await api('get', '/api/reports/repayments')).body.data;
    const ledger = (await Transaction.aggregate([{ $match: { type: 'repayment', reversedAt: { $exists: false } } }, { $group: { _id: null, s: { $sum: '$amount' } } }]))[0].s;
    expect(rep.totals.amount).toBeCloseTo(ledger, 2);
    const monthly = (await api('get', '/api/reports/collections-monthly')).body.data;
    expect(monthly.totals.amount).toBeCloseTo(ledger, 2); // settlements are non-cash and excluded everywhere
    expect((await api('get', '/api/reports/loans?from=bad')).status).toBe(400);
  });
  it('the overdue report lists only loans with overdue amounts', async () => {
    const rows = (await api('get', '/api/reports/overdue')).body.data.rows;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows.every((r: any) => r.overdueAmount > 0)).toBe(true);
  });
  it('exports CSV, Excel and PDF, audits the export, and requires reports.export', async () => {
    const csv = await api('get', '/api/reports/loans?format=csv');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.headers['content-disposition']).toMatch(/protech-loans-\d{4}-\d{2}-\d{2}\.csv/);
    expect(csv.text.split('\r\n')[0]).toContain('Loan');
    expect(csv.text).toContain('LN-000001');
    const xlsx = await api('get', '/api/reports/loans?format=xlsx').buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(xlsx.body.subarray(0, 2).toString()).toBe('PK');
    const pdf = await api('get', '/api/reports/loans?format=pdf').buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.body.subarray(0, 4).toString()).toBe('%PDF');
    expect(await AuditLog.countDocuments({ action: 'REPORT_EXPORTED' })).toBe(3);
    // an accountant with only reports.view can read reports but not export them (the CEO can grant reports.export)
    await User.updateOne({ username: 'accountant' }, { permissions: ['reports.view'] });
    expect((await api('get', '/api/reports/loans', acct)).status).toBe(200);
    expect((await api('get', '/api/reports/loans?format=csv', acct)).status).toBe(403);
    await User.updateOne({ username: 'accountant' }, { permissions: [] });
    expect((await api('get', '/api/reports/loans?format=csv', acct)).status).toBe(200); // default accountants may export
  });
  it('neutralises spreadsheet formula injection in CSV', async () => {
    const open = (await Loan.findOne({ status: { $in: ['active', 'overdue', 'defaulted'] } }).populate('customer'))!; // the loan report lists current loans
    const cid = (open.customer as any).customerId as string; const original = (open.customer as any).fullName as string;
    await Customer.updateOne({ customerId: cid }, { fullName: '=HYPERLINK("http://evil","x")' });
    const csv = (await api('get', '/api/reports/loans?format=csv')).text;
    expect(csv).not.toMatch(/,=HYPERLINK/);
    expect(csv).toContain("'=HYPERLINK");
    await Customer.updateOne({ customerId: cid }, { fullName: original });
  });
});

describe('dashboard (real data only)', () => {
  it('CEO sees financial metrics that match the database', async () => {
    const d = (await api('get', '/api/dashboard/overview')).body.data;
    expect(d.customers.total).toBe(6);
    expect(d.financial.activeLoans).toBe(await Loan.countDocuments({ status: { $in: ['active', 'overdue', 'defaulted'] } }));
    expect(d.financial.overdueLoans).toBe(await Loan.countDocuments({ status: 'overdue' }));
    const ledger = await Transaction.aggregate([{ $match: { reversedAt: { $exists: false }, isCash: true } }, { $group: { _id: '$type', s: { $sum: '$amount' } } }]);
    const get = (t: string) => ledger.find((x) => x._id === t)?.s ?? 0;
    expect(d.financial.totalCollected).toBeCloseTo(get('repayment'), 2);
    expect(d.financial.totalDisbursed).toBeCloseTo(get('disbursement') + get('topup'), 2);
    expect(d.financial.loanStatusBreakdown.reduce((s: number, x: any) => s + x.count, 0)).toBe(await Loan.countDocuments());
    expect(d.financial.monthly).toHaveLength(12);
    expect(d.staff.total).toBeGreaterThan(0);
    expect(d.recentLoans.length).toBeGreaterThan(0);
    expect(d.overdueAccounts.length).toBeGreaterThan(0);
  });
  it('accountants only receive what their permissions allow', async () => {
    const d = (await api('get', '/api/dashboard/overview', acct)).body.data;
    expect(d.staff).toBeUndefined();
    expect(d.recentActivity).toBeUndefined();
    expect(d.financial).toBeDefined();
    expect(d.todayRepayments).toBeDefined();
    await User.updateOne({ username: 'accountant' }, { permissions: ['dashboard.view', 'customers.read'] });
    const limited = (await api('get', '/api/dashboard/overview', acct)).body.data;
    expect(limited.financial).toBeUndefined();
    expect(limited.customers.total).toBe(6);
    await User.updateOne({ username: 'accountant' }, { permissions: [] });
  });
});

describe('audit log API', () => {
  it('is CEO-only, filterable and paginated', async () => {
    expect((await api('get', '/api/audit-logs', acct)).status).toBe(403);
    const r = await api('get', '/api/audit-logs?limit=5');
    expect(r.body.pagination).toMatchObject({ page: 1, limit: 5 });
    expect(r.body.data).toHaveLength(5);
    const created = await api('get', '/api/audit-logs?action=LOAN_CREATED,TOPUP_APPROVED&limit=100');
    expect(created.body.data.every((a: any) => ['LOAN_CREATED', 'TOPUP_APPROVED'].includes(a.action))).toBe(true);
    expect((await api('get', '/api/audit-logs?entity=Loan&q=LN-000001')).body.data.every((a: any) => a.entity === 'Loan')).toBe(true);
    const future = await api('get', '/api/audit-logs?from=2999-01-01');
    expect(future.body.data).toEqual([]);
    const meta = await api('get', '/api/audit-logs/meta');
    expect(meta.body.data.actions).toContain('REPAYMENT_RECORDED');
    expect(JSON.stringify(created.body)).not.toMatch(/passwordHash/);
  });
});

describe('security hardening', () => {
  it('rejects NoSQL operator injection in login and bodies', async () => {
    expect((await request(app).post('/api/auth/login').send({ identifier: { $ne: null }, password: { $ne: null } })).status).toBe(400);
    const bad = await api('post', '/api/customers').send({ firstName: { $gt: '' }, lastName: 'X', phone: '08031230000', address: 'Somewhere' });
    expect(bad.status).toBe(400);
  });
  it('never interprets operator syntax in query strings, and handles bad ids safely', async () => {
    const plain = (await api('get', '/api/loans')).body.pagination.total;
    const injected = await api('get', '/api/loans?status[$ne]=active');
    expect(injected.body.pagination.total).toBe(plain); // treated as an unknown, ignored parameter: no filter applied
    const cust = await api('get', '/api/customers?q[$regex]=.*');
    expect(cust.body.pagination.total).toBe((await api('get', '/api/customers')).body.pagination.total);
    expect((await api('get', '/api/loans/not-an-id')).status).toBe(404);
  });
  it('requires authentication on every business endpoint', async () => {
    for (const p of ['/api/loans', '/api/loan-products', '/api/repayments', '/api/transactions', '/api/topups', '/api/reports', '/api/audit-logs', '/api/settings', '/api/dashboard/overview', '/api/customers'])
      expect((await request(app).get(p)).status, p).toBe(401);
  });
  it('sets secure headers and never leaks stack traces', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    const e = await api('get', '/api/loans?page=abc');
    expect(JSON.stringify(e.body)).not.toMatch(/at .*\.(ts|js):\d+/);
  });
});

describe('first-run bootstrap', () => {
  it('is protected, validated, and works only while no users exist', async () => {
    const { User } = await import('../src/models/User.js');
    const body = { name: 'First Admin', email: 'first@protech.ng', username: 'firstceo', password: 'Strongpass123' };
    const auth = { Authorization: 'Bearer cron-secret-cron-secret-123' };
    expect((await request(app).post('/api/jobs/bootstrap').send(body)).status).toBe(403);
    expect((await request(app).post('/api/jobs/bootstrap').set(auth).send(body)).body.code).toBe('ALREADY_INITIALISED'); // seeded users exist
    await User.deleteMany({});
    expect((await request(app).post('/api/jobs/bootstrap').set(auth).send({ ...body, password: 'weak' })).status).toBe(400);
    const ok = await request(app).post('/api/jobs/bootstrap').set(auth).send(body);
    expect(ok.status).toBe(201);
    expect(ok.body.data.user).toMatchObject({ role: 'ceo', username: 'firstceo' });
    expect(JSON.stringify(ok.body)).not.toContain('passwordHash');
    expect((await request(app).post('/api/auth/login').send({ identifier: 'firstceo', password: 'Strongpass123' })).status).toBe(200);
    expect((await request(app).post('/api/jobs/bootstrap').set(auth).send({ ...body, username: 'second' })).status).toBe(409);
  });
});
