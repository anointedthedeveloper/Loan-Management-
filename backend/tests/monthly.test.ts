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
    expect(pv).toMatchObject({ counts: { newLoans: 3, errors: 2 }, needsApproval: false });
    expect(pv.rows[3].errors[0]).toMatch(/No customer/);
    expect(pv.rows[4].errors[0]).toMatch(/belongs to|already belongs/);
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

describe('blank columns are calculated (the sheet formulas)', () => {
  it('a row without EMI is priced with Interest = Principal x Rate x Tenor and EMI = Gross Loan / Tenor; the register carries the formulas', async () => {
    const x = await mkCustomer('800001');
    const buf = await sheet([[num(x), x.fullName, 800001, 'OSGF', 12, D('2026-10-01'), null, 96000, null, null, null, null, null, D('2026-11-01'), null, 'NEW']]);
    const pv = (await send('/preview', buf)).body.data.plan.rows[0];
    expect(pv).toMatchObject({ action: 'new-loan', principal: 100000, interest: 60000, total: 160000, emi: 13333.33 }); // 100,000 x 5% x 12
    expect(pv.warnings.join(' ')).toMatch(/EMI left blank/);
    await send('?filename=blank.xlsx', buf);
    const xl = await api('get', '/api/reports/customer-register?format=xlsx&limit=500').buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(xl.body) as any);
    const ws = wb.worksheets[0]!; let head = 0; ws.eachRow((row, n) => { if (!head && (row.values as any[]).includes('Clients Name')) head = n; });
    const labels = ws.getRow(head).values as any[]; const col = (l: string) => labels.indexOf(l);
    let found = false;
    ws.eachRow((row, n) => { if (n > head && String(row.getCell(col('Clients Name')).value) === x.fullName) { found = true; const f = (l: string) => String((row.getCell(col(l)).value as any)?.formula ?? ''); expect(f('Gross Payment')).toMatch(/^ROUND\([A-Z]+\d+\/0\.96,2\)$/); expect(f('Interest')).toMatch(/%\*[A-Z]+\d+,2\)$/); expect(f('EMI')).toMatch(/^ROUND\(/); } });
    expect(found).toBe(true);
  });
});


describe('the downloaded register can be edited and uploaded back', () => {
  const download = async () => {
    const xl = await api('get', '/api/reports/customer-register?format=xlsx&limit=500').buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(xl.body) as any); return wb;
  };
  const headerRow = (ws: ExcelJS.Worksheet) => { let h = 0; ws.eachRow((row, n) => { if (!h && (row.values as any[]).includes('Clients Name')) h = n; }); return h; };
  const colOf = (ws: ExcelJS.Worksheet, h: number, label: string) => (ws.getRow(h).values as any[]).indexOf(label);
  const save = async (wb: ExcelJS.Workbook) => Buffer.from(await wb.xlsx.writeBuffer());

  it('re-uploading the register untouched changes nothing', async () => {
    const wb = await download(); const buf = await save(wb);
    const plan = (await send('/preview', buf)).body.data.plan;
    expect(plan.counts).toMatchObject({ newLoans: 0, loanUpdates: 0, errors: 0 });
    const r = (await send('?filename=register.xlsx', buf)).body.data.result;
    expect(r).toMatchObject({ created: 0, updated: 0, skipped: 0 });
  });

  it('edits to customer details and loan figures are applied; the accountant can only change what she may', async () => {
    const x = await mkCustomer('900001');
    const loan = (await api('post', '/api/loans').send({ customerId: x.id, productId: product, amount: 96000, duration: { value: 6, unit: 'months' }, startDate: isoDate(todayLagos()) })).body.data.loan;
    const wb = await download(); const ws = wb.worksheets[0]!; const h = headerRow(ws);
    let target = 0; ws.eachRow((row, n) => { if (n > h && String(row.getCell(colOf(ws, h, 'Loan ID')).value) === loan.loanId) target = n; });
    expect(target).toBeGreaterThan(0);
    const set = (label: string, v: unknown) => { ws.getCell(target, colOf(ws, h, label)).value = v as any; };
    set('phone no', '0803 999 0001'); set('Address', '7 New Street'); set('NIN', '99988877766'); set('MINISTRY', 'CCB');
    set('Tenor', 12); // loan change
    set('EMI', 15000); // 12 x 15,000 = 180,000 on a 100,000 principal
    const buf = await save(wb);
    const pv = (await send('/preview', buf)).body.data.plan.rows.find((r: any) => r.loanRef === loan.loanId);
    expect(pv.action).toBe('update-loan');
    expect(pv.customerChanges.join(' ')).toMatch(/Phone/); expect(pv.loanChanges.join(' ')).toMatch(/Tenor: 6 → 12/);
    // an accountant (no loans.edit / editActive) cannot change the running loan, but the customer details do go through
    const { User } = await import('../src/models/User.js'); await User.updateOne({ username: 'accountant' }, { permissions: ['loans.view', 'loans.create', 'customers.update'] });
    const ra = (await send('?filename=edit.xlsx', buf, acct)).body.data.result.rows.find((r: any) => r.name === x.fullName);
    expect(ra.status).toBe('updated');
    expect((await Loan.findById(loan.id))!.numberOfInstallments).toBe(6);
    const c1 = (await Customer.findById(x.id))!; expect([c1.phone, c1.address, c1.nin, c1.employment?.ministry]).toEqual(['08039990001', '7 New Street', '99988877766', 'CCB']);
    // the CEO's upload changes the loan
    const rc = (await send('?filename=edit2.xlsx', buf)).body.data.result.rows.find((r: any) => r.name === x.fullName);
    expect(rc.messages.join(' ')).toMatch(/Loan .* updated/);
    const l2 = (await Loan.findById(loan.id))!;
    expect(l2.numberOfInstallments).toBe(12); expect(l2.totalRepayment).toBeCloseTo(180000, 0); expect(l2.installmentAmount).toBeCloseTo(15000, 1);
  });

  it('a Loan ID that is not the customer\'s current loan is refused; blank cells never erase details', async () => {
    const x = await mkCustomer('900002');
    const wb = await download(); const ws = wb.worksheets[0]!; const h = headerRow(ws);
    let target = 0; ws.eachRow((row, n) => { if (n > h && row.getCell(colOf(ws, h, 'IPPIS NO')).value?.toString() === '900002') target = n; });
    ws.getCell(target, colOf(ws, h, 'Loan ID')).value = 'LN-999999'; ws.getCell(target, colOf(ws, h, 'Bank payment')).value = 50000; ws.getCell(target, colOf(ws, h, 'Tenor')).value = 6; ws.getCell(target, colOf(ws, h, 'Payment Date')).value = new Date('2026-10-01T00:00:00Z');
    const row = (await send('/preview', await save(wb))).body.data.plan.rows.find((r: any) => r.customerRef === x.customerId);
    expect(row.action).toBe('error'); expect(row.errors[0]).toMatch(/not .* current loan/);
    const before = (await Customer.findById(x.id))!.phone;
    ws.getCell(target, colOf(ws, h, 'Loan ID')).value = null; ws.getCell(target, colOf(ws, h, 'Bank payment')).value = null; ws.getCell(target, colOf(ws, h, 'phone no')).value = null;
    await send('?filename=blank.xlsx', await save(wb));
    expect((await Customer.findById(x.id))!.phone).toBe(before);
  });

  it('a one-time-interest loan survives a round trip untouched, and keeps its rule when the tenor is changed', async () => {
    const flat = (await api('post', '/api/loan-products').send({ name: 'Flat', code: 'FLT', interestRate: 5, bankDeductionRate: 0, minAmount: 1000, maxAmount: 5_000_000, minDuration: 1, maxDuration: 24, durationUnit: 'months', allowedFrequencies: ['monthly'], defaultFrequency: 'monthly' })).body.data.product.id;
    const x = await mkCustomer('900003');
    const loan = (await api('post', '/api/loans').send({ customerId: x.id, productId: flat, amount: 1_000_000, duration: { value: 6, unit: 'months' }, startDate: isoDate(todayLagos()) })).body.data.loan;
    expect(loan.installmentAmount).toBe(175000);
    const wb = await download(); const ws = wb.worksheets[0]!; const h = headerRow(ws);
    const plan = (await send('/preview', await save(wb))).body.data.plan;
    expect(plan.rows.find((r: any) => r.loanRef === loan.loanId)?.action ?? 'unchanged').toBe('unchanged'); // nothing drifts
    let target = 0; ws.eachRow((row, n) => { if (n > h && String(row.getCell(colOf(ws, h, 'Loan ID')).value) === loan.loanId) target = n; });
    ws.getCell(target, colOf(ws, h, 'Tenor')).value = 12; ws.getCell(target, colOf(ws, h, 'EMI')).value = 87500; // what the sheet's one-time formula gives for 12 months
    await send('?filename=tenor.xlsx', await save(wb));
    const after = (await Loan.findById(loan.id))!;
    expect(after.numberOfInstallments).toBe(12); expect(after.totalRepayment).toBe(1_050_000); expect(after.rateBasis).toBe('per_loan'); expect(after.interestRate).toBe(5);
  });

  it('Clients ID carries the PTC prefix, the loan figures come first, and an incomplete profile (and the customer status) can be completed from the sheet', async () => {
    const x = await mkCustomer('900004');
    const doc = (await Customer.findById(x.id))!; doc.email = undefined as any; doc.state = undefined as any; doc.gender = undefined as any; doc.set('emergencyContact.name', undefined); await doc.save();
    expect((await Customer.findById(x.id))!.profileMissing).toEqual(expect.arrayContaining(['Email', 'State', 'Gender', 'Next of kin name']));
    const wb = await download(); const ws = wb.worksheets[0]!; const h = headerRow(ws);
    const labels = ws.getRow(h).values as string[];
    expect(labels.indexOf('EMI')).toBeLessThan(labels.indexOf('BVN')); expect(labels.indexOf('Principal')).toBeLessThan(labels.indexOf('NIN')); expect(labels.indexOf('Gross Payment')).toBeLessThan(labels.indexOf('Customer status'));
    let target = 0; ws.eachRow((row, n) => { if (n > h && String(row.getCell(colOf(ws, h, 'IPPIS NO')).value) === '900004') target = n; });
    expect(String(ws.getCell(target, colOf(ws, h, 'Clients ID')).value)).toBe(x.customerId); // PTC-000###
    expect(String(ws.getCell(target, colOf(ws, h, 'Profile (missing details)')).value)).toMatch(/Missing: .*Email/);
    const set = (label: string, v: unknown) => { ws.getCell(target, colOf(ws, h, label)).value = v as any; };
    set('Email', 'filled@example.com'); set('State', 'Kano'); set('Gender', 'Female'); set('NEXT OF KIN NAME', 'Ada Okafor'); set('Customer status', 'Inactive');
    const r = (await send('?filename=complete.xlsx', await save(wb))).body.data.result.rows.find((q: any) => q.name === x.fullName);
    expect(r.status).toBe('updated');
    const after = (await Customer.findById(x.id))!;
    expect([after.email, after.state, after.gender, after.emergencyContact?.name, after.status]).toEqual(['filled@example.com', 'Kano', 'female', 'Ada Okafor', 'inactive']);
    expect(after.profileMissing).toEqual([]);
  });

  it('the empty template works as it is downloaded (footer note ignored) and the book\'s formulas give the exact total', async () => {
    const x = await mkCustomer('900005');
    const t = await api('get', '/api/monthly-uploads/template').buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(t.body) as any); const ws = wb.worksheets[0]!; const h = headerRow(ws);
    for (const n of [h + 1, h + 2]) for (let c = 1; c <= 31; c++) ws.getCell(n, c).value = null; // remove the two examples
    const set = (c: string, v: unknown) => { ws.getCell(h + 1, colOf(ws, h, c)).value = v as any; };
    set('S/N', 1); set('Clients ID', x.customerId); set('Clients Name', x.fullName); set('IPPIS NO', 900005); set('MINISTRY', 'OSGF'); set('Tenor', 12); set('Payment Date', new Date('2026-10-05T00:00:00Z')); set('Bank payment', 96000); set('Start Date', new Date('2026-11-01T00:00:00Z')); set('Status', 'NEW');
    ws.getCell(h + 1, colOf(ws, h, 'EMI')).value = { formula: `ROUND(M${h + 1}/F${h + 1},2)`, result: 13333.33 } as any; // as Excel would have saved it
    const plan = (await send('/preview', await save(wb))).body.data.plan;
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]).toMatchObject({ action: 'new-loan', principal: 100000, interest: 60000, total: 160000, emi: 13333.33 });
  });
});
