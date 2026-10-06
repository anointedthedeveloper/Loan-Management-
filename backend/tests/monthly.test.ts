import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken, customerPayload } from './helpers.js';
import { Loan } from '../src/models/Loan.js';
import { Customer } from '../src/models/Customer.js';
import { TopUp } from '../src/models/TopUp.js';
import { isoDate, todayLagos } from '../src/utils/dates.js';

let ceo = ''; let acct = ''; let product = '';
const api = (m: 'get' | 'post' | 'patch', url: string, t = ceo) => (request(app) as any)[m](url).set(as(t));
beforeAll(async () => {
  await setupDb(); ceo = await ceoToken(); acct = await accountantToken();
  product = (await api('post', '/api/loan-products').send({ name: 'Salary Advance', code: 'SAL', interestRate: 5, bankDeductionRate: 4, minAmount: 10000, maxAmount: 5_000_000, minDuration: 1, maxDuration: 12, durationUnit: 'months', allowedFrequencies: ['monthly'], defaultFrequency: 'monthly' })).body.data.product.id;
});
afterAll(teardownDb);

const HEAD = ['S/N', 'Clients ID', 'Clients Name', 'IPPIS NO', 'MINISTRY', 'Tenor', 'Payment Date', 'Balance B/Fwd', 'Bank payment', 'Gross Payment (Column I/.96)', 'Principal (H+J)', 'Interest', 'Gross Loan (K+L)', 'EMI', 'Start Date', 'End date', 'Status'];
async function sheet(rows: unknown[][]) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Sheet1'); ws.addRow(HEAD); rows.forEach((r, i) => ws.addRow([i + 1, ...r]));
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const send = (path: string, buf: Buffer, t = ceo) => request(app).post(`/api/monthly-uploads${path}`).set(as(t)).set('Content-Type', 'application/octet-stream').send(buf);
const mkCustomer = async (ippis: string) => { const c = (await api('post', '/api/customers').send(customerPayload({ employment: { sector: 'government', ippisNumber: ippis, ministry: 'OSGF' } }))).body.data.customer; return c as { id: string; customerId: string; fullName: string }; };
const num = (c: { customerId: string }) => Number(c.customerId.replace(/\D/g, ''));
const D = (s: string) => new Date(`${s}T00:00:00Z`);

describe('monthly loans-taken upload', () => {
  it('matches clients by client number and IPPIS, honours the sheet EMI, liquidates on TOP UP, and reports problems per row', async () => {
    const a = await mkCustomer('434590'); const b = await mkCustomer('480210'); const c = await mkCustomer('15193');
    // an existing running loan for A (to be topped up)
    const old = (await api('post', '/api/loans').send({ customerId: a.id, productId: product, amount: 96000, duration: { value: 12, unit: 'months' }, startDate: '2026-03-04' })).body.data.loan;
    const buf = await sheet([
      [num(a), a.fullName, 434590, 'OSGF', 12, D('2026-08-04'), 36012.38, 96000, null, null, null, null, 18134.98, D('2026-09-01'), D('2027-08-31'), 'TOP UP'],
      [num(b), b.fullName, 480210, 'LABOUR', 12, D('2026-08-05'), null, 240000, null, null, null, null, 33333.33, D('2026-09-01'), D('2027-08-31'), 'NEW'],
      [num(c), c.fullName, 99999, 'CCB', 12, D('2026-08-05'), null, 144000, null, null, null, null, 30000, D('2026-09-01'), D('2027-08-31'), 'NEW'], // client number says C, IPPIS says nobody -> matched by number only
      [9999, 'NOBODY KNOWN', 111, 'CCB', 6, D('2026-08-05'), null, 50000, null, null, null, null, 10000, null, null, 'NEW'],
      [num(a), a.fullName, 480210, 'OSGF', 6, D('2026-08-05'), null, 50000, null, null, null, null, 10000, null, null, 'NEW'],  // client A but IPPIS of B
    ]);
    const pv = (await send('/preview', buf)).body.data.plan;
    expect(pv).toMatchObject({ willCreate: 3, errors: 2, needsApproval: false });
    expect(pv.rows[3].errors[0]).toMatch(/No customer/);
    expect(pv.rows[4].errors[0]).toMatch(/IPPIS 480210 belongs to/);
    expect(await Loan.countDocuments({ customer: b.id })).toBe(0); // preview saves nothing

    const r = (await send('?filename=oct.xlsx', buf)).body.data.result;
    expect(r).toMatchObject({ total: 5, created: 3, skipped: 2, needsApproval: false });
    // OKOH-style top-up row: B/Fwd 36,012.38 + 96,000/0.96 = principal 136,012.38; total = EMI x 12
    const top = (await Loan.findOne({ customer: a.id, loanType: 'topup' }))!;
    expect({ status: top.status, bf: top.carriedBalance, gross: top.grossAmount, principal: top.principal, n: top.numberOfInstallments }).toEqual({ status: expect.stringMatching(/active|overdue/), bf: 36012.38, gross: 100000, principal: 136012.38, n: 12 });
    expect(top.totalRepayment).toBeCloseTo(18134.98 * 12, 1);
    expect(top.installmentAmount).toBeCloseTo(18134.98, 1);
    expect(top.firstPaymentDate!.toISOString().slice(0, 10)).toBe('2026-09-01');
    const oldAfter = (await Loan.findById(old.id))!;
    expect(oldAfter.status).toBe('completed'); expect(oldAfter.settledByTopUp).toBeTruthy(); // liquidated by the top-up
    expect((await TopUp.findOne({ loan: old.id }))!.status).toBe('approved');
    const nb = (await Loan.findOne({ customer: b.id }))!;
    expect(nb.principal).toBe(250000); expect(nb.installmentAmount).toBeCloseTo(33333.33, 1); expect(nb.loanType).toBe('new');
    const hist = (await api('get', '/api/monthly-uploads')).body.data.uploads;
    expect(hist[0]).toMatchObject({ filename: 'oct.xlsx', created: 3, skipped: 2 });
  });

  it('an accountant\'s upload creates pending loans; the CEO edits one, approves, and a top-up only liquidates on approval', async () => {
    const a = await mkCustomer('700001'); const b = await mkCustomer('700002');
    const old = (await api('post', '/api/loans').send({ customerId: a.id, productId: product, amount: 96000, duration: { value: 6, unit: 'months' }, startDate: isoDate(todayLagos()) })).body.data.loan;
    const buf = await sheet([
      [num(a), a.fullName, 700001, 'OSGF', 12, D('2026-10-01'), 20000, 96000, null, null, null, null, 15000, D('2026-11-01'), null, 'TOP UP'],
      [num(b), b.fullName, 700002, 'OSGF', 6, D('2026-10-01'), null, 96000, null, null, null, null, 20000, D('2026-11-01'), null, 'NEW'],
    ]);
    const r = (await send('?filename=acct.xlsx', buf, acct)).body.data.result;
    expect(r).toMatchObject({ created: 2, needsApproval: true });
    const lb = (await Loan.findOne({ customer: b.id }))!; const la = (await Loan.findOne({ customer: a.id, loanType: 'topup' }))!;
    expect([lb.status, la.status]).toEqual(['pending', 'pending']);
    expect((await Loan.findById(old.id))!.status).not.toBe('completed'); // old loan untouched until approval
    expect((await api('post', `/api/loans/${lb.id}/approve`, acct)).status).toBe(403);
    // the CEO edits the pending loan he is asked to approve (a smaller amount), then approves
    const ed = await api('patch', `/api/loans/${lb.id}`).send({ amount: 48000 });
    expect(ed.status).toBe(200); expect(ed.body.data.loan).toMatchObject({ amount: 48000, principal: 50000 });
    expect((await api('post', `/api/loans/${lb.id}/approve`)).body.data.loan.status).toBe('active');
    expect((await api('post', `/api/loans/${la.id}/approve`)).body.data.loan.status).toBe('active');
    expect((await Loan.findById(old.id))!.status).toBe('completed'); // liquidated by the approved top-up
    expect((await TopUp.findOne({ loan: old.id }))!.status).toBe('approved');
  });

  it('serves the template, refuses people who cannot create loans, and rejects bad files', async () => {
    const t = await api('get', '/api/monthly-uploads/template').buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(t.status).toBe(200); expect(Buffer.from(t.body).subarray(0, 2).toString()).toBe('PK');
    const { User } = await import('../src/models/User.js');
    await User.updateOne({ username: 'accountant' }, { permissions: ['loans.view'] });
    expect((await send('/preview', Buffer.from('x'), acct)).status).toBe(403);
    await User.updateOne({ username: 'accountant' }, { permissions: ['loans.view', 'loans.create'] });
    expect((await send('/preview', Buffer.from('not excel'))).body.code).toBe('UPLOAD_BAD_FILE');
  });

  it('the customer register lists every customer once with status, client id, IPPIS and current loan', async () => {
    const rep = (await api('get', '/api/reports/customer-register?limit=500')).body.data;
    expect(rep.columns.map((c: any) => c.label)).toEqual(expect.arrayContaining(['Clients ID', 'IPPIS NO', 'Customer status', 'Loan status', 'EMI', 'Status']));
    const total = await Customer.countDocuments({ isArchived: false });
    expect(rep.rows).toHaveLength(total);
    const withLoan = rep.rows.filter((r: any) => r.loanId);
    expect(withLoan.length).toBeGreaterThan(0);
    expect(new Set(rep.rows.map((r: any) => r.clientName)).size).toBe(rep.rows.length); // each customer once
    const xl = await api('get', '/api/reports/customer-register?format=xlsx').buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(Buffer.from(xl.body).subarray(0, 2).toString()).toBe('PK');
  });
});
