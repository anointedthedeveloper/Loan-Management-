import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken, customerPayload } from './helpers.js';
import { Loan } from '../src/models/Loan.js';
import { Transaction } from '../src/models/Transaction.js';
import { Customer } from '../src/models/Customer.js';
import { dateInHeader } from '../src/services/openingBalance.service.js';

let ceo = ''; let acct = '';
const api = (m: 'get' | 'post', url: string, t = ceo) => (request(app) as any)[m](url).set(as(t));
const send = (path: string, buf: Buffer, t = ceo) => request(app).post(`/api/monthly-uploads${path}`).set(as(t)).set('Content-Type', 'application/octet-stream').send(buf);
beforeAll(async () => {
  await setupDb(); ceo = await ceoToken(); acct = await accountantToken();
  await api('post', '/api/loan-products').send({ name: 'Std', code: 'STD', interestRate: 5, allowedFrequencies: ['monthly'], defaultFrequency: 'monthly', maxDuration: 12 });
});
afterAll(teardownDb);
const mk = async (ippis: string) => (await api('post', '/api/customers').send(customerPayload({ employment: { sector: 'government', ippisNumber: ippis, ministry: 'OSGF' } }))).body.data.customer as { id: string; customerId: string; fullName: string };
const sheet = async (rows: unknown[][], head = 'Balance as at 30 Sep, 2026') => { const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Sheet1'); ws.addRow(['S/N', 'Client ID', 'Clients Name', 'IPPIS NO', 'AAA MINISTRY2', head]); rows.forEach((r, i) => ws.addRow([i + 1, ...r])); return Buffer.from(await wb.xlsx.writeBuffer()); };

describe('opening balances', () => {
  it('reads the date from the header', () => {
    expect(dateInHeader('Balanceas at 30 Sep, 2026')?.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(dateInHeader('Balance')).toBeNull();
  });

  it('records each balance as a no-cash opening loan, matches IPPIS first, adds unknown people, skips zero and open-loan customers; top-up then liquidates it', async () => {
    const a = await mk('720001'); const b = await mk('720002'); const c = await mk('720003');
    await api('post', '/api/loans').send({ customerId: c.id, productId: (await api('get', '/api/loan-products')).body.data.products[0].id, amount: 100000, duration: { value: 3, unit: 'months' }, startDate: new Date().toISOString().slice(0, 10) });
    const buf = await sheet([
      [null, 'whoever', 720001, 'OSGF', 192000],                 // IPPIS only
      [Number(b.customerId.replace(/\D/g, '')), b.fullName, null, 'OSGF', 523666.67], // client number only
      [null, 'BRAND NEW PERSON', 999001, 'YOUTH', 133333.34],     // not in the portal
      [null, 'ZERO BALANCE', 999002, 'PSC', 0],
      [null, c.fullName, 720003, 'OSGF', 50000],                  // already has an open loan
    ]);
    const pv = (await send('/balances/preview', buf)).body.data.plan;
    expect(pv.asAt.slice(0, 10)).toBe('2026-09-30');
    expect(pv.counts).toMatchObject({ balances: 3, newCustomers: 1, skipped: 1, errors: 1, total: 192000 + 523666.67 + 133333.34 });
    expect(await Loan.countDocuments({ openingBalance: true })).toBe(0); // preview saves nothing

    const r = (await send('/balances?filename=bal.xlsx', buf)).body.data.result;
    expect(r).toMatchObject({ created: 3, skipped: 1, needsApproval: false });
    const la = (await Loan.findOne({ customer: a.id }))!;
    expect(la).toMatchObject({ loanType: 'opening', openingBalance: true, status: 'active', amount: 192000, principal: 192000, interestAmount: 0, totalRepayment: 192000, outstandingBalance: 192000, applicationFee: 0, numberOfInstallments: 1 });
    expect(la.startDate.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(la.dueDate.toISOString().slice(0, 10)).toBe('2026-10-30');
    const tx = await Transaction.find({ loan: la._id });
    expect(tx).toHaveLength(1); expect(tx[0]).toMatchObject({ type: 'opening_balance', isCash: false, amount: 192000 });
    const np = (await Customer.findOne({ fullName: 'Brand New Person' }))!;
    expect(np.customerId).toMatch(/^PTC-\d{6}$/); expect(np.employment).toMatchObject({ sector: 'government', ippisNumber: '999001', ministry: 'YOUTH' });
    expect(await Customer.exists({ fullName: 'Zero Balance' })).toBeFalsy();

    // the balance can be repaid, and re-uploading it is refused (they now have an open loan)
    expect((await api('post', '/api/repayments').send({ loanId: String(la._id), amount: 42000 })).body.data.loan.outstandingBalance).toBe(150000);
    expect((await send('/balances/preview', await sheet([[null, a.fullName, 720001, 'OSGF', 150000]]))).body.data.plan.rows[0].errors[0]).toMatch(/already has/);

    // a monthly-upload TOP UP row now finds an existing loan to liquidate
    const HEAD = ['S/N', 'Clients ID', 'Clients Name', 'IPPIS NO', 'MINISTRY', 'Tenor', 'Payment Date', 'Balance B/Fwd', 'Loan amount', 'Status'];
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('S'); ws.addRow(HEAD); ws.addRow([1, null, null, 720001, 'OSGF', 12, new Date('2026-10-05T00:00:00Z'), 150000, 100000, 'TOP UP']);
    const top = (await send('', Buffer.from(await wb.xlsx.writeBuffer()))).body.data.result;
    expect(top).toMatchObject({ created: 1, skipped: 0 });
    expect((await Loan.findById(la._id))!.status).toBe('completed'); // liquidated into the new loan
    const nl = (await Loan.findOne({ customer: a.id, loanType: 'topup' }))!;
    expect(nl).toMatchObject({ carriedBalance: 150000, principal: 250000, applicationFee: 4000 });
  });

  it('Client ID works with or without the PTC prefix (text or number, any zero padding)', async () => {
    const x = await mk('720020'); const n = Number(x.customerId.replace(/\D/g, ''));
    for (const id of [n, String(n), `PTC-${n}`, x.customerId, `ptc ${String(n).padStart(6, '0')}`]) {
      const row = (await send('/balances/preview', await sheet([[id, 'x', null, 'OSGF', 1000]]))).body.data.plan.rows[0];
      expect(row, String(id)).toMatchObject({ action: 'opening-balance', customerRef: x.customerId });
    }
  });

  it('an accountant\'s balances wait for the CEO to approve', async () => {
    const x = await mk('720010');
    const r = (await send('/balances', await sheet([[null, x.fullName, 720010, 'OSGF', 80000]]), acct)).body.data.result;
    expect(r).toMatchObject({ created: 1, needsApproval: true });
    const l = (await Loan.findOne({ customer: x.id }))!; expect(l.status).toBe('pending');
    expect((await api('post', `/api/loans/${l.id}/approve`)).body.data.loan.status).toBe('active');
    expect(await Transaction.countDocuments({ loan: l._id, type: 'opening_balance' })).toBe(1);
  });

  it('uses the Loan column as the loan, posts Repayment to date as a non-cash repayment, and a top-up carries what is still owed', async () => {
    const x = await mk('720030'); const y = await mk('720031'); const z = await mk('720032');
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('Sheet1');
    ws.addRow(['S/N', 'Client ID', 'Clients Name', 'IPPIS NO', 'AAA MINISTRY2', 'Loan', 'Repayment to date', 'Balance as at 30 Sep, 2026']);
    ws.addRow([1, null, x.fullName, 720030, 'OSGF', 1080000, 556333.33, { formula: 'F2-G2', result: 523666.67 }]);
    ws.addRow([2, null, y.fullName, 720031, 'OSGF', 320000, 332357.36, { formula: 'F3-G3', result: -12357.36 }]); // overpaid: nothing owed
    ws.addRow([3, null, z.fullName, 720032, 'OSGF', 1600000, 0, 1600000]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const pv = (await send('/balances/preview', buf)).body.data.plan;
    expect(pv.counts).toMatchObject({ balances: 2, skipped: 1, errors: 0, loans: 2680000, repaid: 556333.33 });
    expect(pv.rows[1].warnings.join(' ')).toMatch(/Repaid more than the loan/);
    expect((await send('/balances?filename=new.xlsx', buf)).body.data.result).toMatchObject({ created: 2, skipped: 0 });
    const l = (await Loan.findOne({ customer: x.id }))!;
    expect(l).toMatchObject({ status: 'active', loanType: 'opening', amount: 1080000, principal: 1080000, totalRepayment: 1080000, interestAmount: 0, amountPaid: 556333.33, outstandingBalance: 523666.67 });
    const txs = await Transaction.find({ loan: l._id }).sort({ createdAt: 1 });
    expect(txs.map((t) => [t.type, t.isCash, t.amount])).toEqual([['opening_balance', false, 1080000], ['repayment', false, 556333.33]]);
    expect(await Loan.countDocuments({ customer: y.id })).toBe(0);
    // top-up: the old loan is liquidated for what is still owed (+ the 5% liquidation fee) and carried into the new loan
    const pr = (await api('post', '/api/topups/preview').send({ loanId: String(l._id), amount: 200000, duration: { value: 6, unit: 'months' }, frequency: 'monthly', startDate: new Date().toISOString().slice(0, 10) })).body.data.calculation;
    expect(pr.liquidation).toMatchObject({ loanTaken: 1080000, revisedCost: 1080000, paidToDate: 556333.33, outstanding: 523666.67 });
    expect(pr.carriedBalance).toBeCloseTo(523666.67 * 1.05, 2);
  });

  it('can be recorded a few rows at a time (so long sheets never hit the time limit) into one upload record', async () => {
    const people = [await mk('720040'), await mk('720041'), await mk('720042')];
    const buf = await sheet(people.map((p, i) => [null, p.fullName, 720040 + i, 'OSGF', 1000 * (i + 1)]));
    let offset = 0; let uploadId = ''; let created = 0; let calls = 0;
    for (;;) {
      const r = (await send(`/balances?filename=chunk.xlsx&offset=${offset}&limit=2${uploadId ? `&uploadId=${uploadId}` : ''}`, buf)).body.data.result;
      uploadId = r.id; created += r.created; offset = r.nextOffset; calls++;
      if (r.done) break;
    }
    expect([calls, created]).toEqual([2, 3]);
    expect(await Loan.countDocuments({ customer: { $in: people.map((p) => p.id) } })).toBe(3);
    const rec = (await api('get', `/api/monthly-uploads/${uploadId}`)).body.data.upload;
    expect(rec).toMatchObject({ total: 3, created: 3 }); expect(rec.rows).toHaveLength(3);
  });
});
