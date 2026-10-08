import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken, customerPayload } from './helpers.js';
import { Transaction } from '../src/models/Transaction.js';
import { isoDate, todayLagos } from '../src/utils/dates.js';

let ceo = ''; let acct = ''; let salary = '';
const api = (m: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, t = ceo) => (request(app) as any)[m](url).set(as(t));
beforeAll(async () => {
  await setupDb(); ceo = await ceoToken(); acct = await accountantToken();
  salary = (await api('post', '/api/loan-products').send({ name: 'Salary Advance', code: 'SAL', interestRate: 5, rateBasis: 'per_month', applicationFeeRate: 4, minAmount: 10000, maxAmount: 5_000_000, minDuration: 1, maxDuration: 12, durationUnit: 'months', allowedFrequencies: ['monthly'], defaultFrequency: 'monthly' })).body.data.product.id;
});
afterAll(teardownDb);

async function activeLoan() {
  const customerId = (await api('post', '/api/customers').send(customerPayload())).body.data.customer.id;
  const c = await api('post', '/api/loans').send({ customerId, productId: salary, amount: 1000000, duration: { value: 6, unit: 'months' }, startDate: isoDate(todayLagos()) });
  return c.body.data.loan;
}
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const upload = (name: string, type: string, body: Buffer, t = ceo, qs = '') => request(app).post(`/api/attachments?filename=${encodeURIComponent(name)}${qs}`).set(as(t)).set('Content-Type', type).send(body);

describe('proof of payment uploads', () => {
  it('stores a file with the repayment, lists it, and serves it back', async () => {
    const l = await activeLoan();
    const up = await upload('credit-alert.png', 'image/png', PNG);
    expect(up.status).toBe(201);
    const pay = await api('post', '/api/repayments').send({ loanId: l.id, amount: 100000, method: 'bank_transfer', reference: 'NIP-1', attachmentIds: [up.body.data.attachment.id] });
    expect(pay.status).toBe(201);
    expect(pay.body.data.transaction.attachments).toHaveLength(1);
    const list = await api('get', `/api/loans/${l.id}/transactions`);
    const row = list.body.data.find((t: any) => t.type === 'repayment');
    expect(row.attachments[0]).toMatchObject({ filename: 'credit-alert.png', size: PNG.length });
    const file = await api('get', `/api/attachments/${up.body.data.attachment.id}`);
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toMatch(/image\/png/);
    expect(Buffer.from(file.body).length).toBe(PNG.length);
    // proof linked to the ledger cannot be deleted
    expect((await api('delete', `/api/attachments/${up.body.data.attachment.id}`)).body.code).toBe('ATTACHMENT_LOCKED');
  });
  it('can add a file to an existing payment, accepts pdf/docx, and rejects other types', async () => {
    const l = await activeLoan();
    const p = (await api('post', '/api/repayments').send({ loanId: l.id, amount: 50000 })).body.data.transaction;
    expect((await upload('alert.pdf', 'application/pdf', Buffer.from('%PDF-1.4'), ceo, `&transactionId=${p.id}`)).status).toBe(201);
    expect((await upload('alert.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('PK'), ceo, `&transactionId=${p.id}`)).status).toBe(201);
    const bad = await upload('virus.exe', 'application/octet-stream', Buffer.from('MZ'));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('ATTACHMENT_TYPE');
    expect((await upload('fake.png', 'application/pdf', PNG)).status).toBe(400);
    expect((await api('get', `/api/transactions/${p.id}`)).body.data.transaction.attachments).toHaveLength(2);
  });
  it('rejects someone else\'s unlinked upload and unauthenticated access', async () => {
    const l = await activeLoan();
    const up = await upload('a.png', 'image/png', PNG, ceo);
    const r = await api('post', '/api/repayments', acct).send({ loanId: l.id, amount: 1000, attachmentIds: [up.body.data.attachment.id] });
    expect([400, 403]).toContain(r.status);
    expect((await request(app).get(`/api/attachments/${up.body.data.attachment.id}`)).status).toBe(401);
  });
});

describe('editing amounts', () => {
  it('"mark as paid" defaults to what is owed but the amount can be edited', async () => {
    const l = await activeLoan();
    const r = await api('post', `/api/loans/${l.id}/installments/1/pay`).send({ amount: 100000 });
    expect(r.status).toBe(201);
    expect(r.body.data.transaction.amount).toBe(100000);
    const g = await api('get', `/api/loans/${l.id}`);
    expect(g.body.data.schedule[0].status).toBe('partially_paid');
    expect(g.body.data.schedule[0].amountPaid).toBe(100000);
  });
  it('a recorded repayment can be corrected: original reversed, replacement linked, balance right, audited', async () => {
    const l = await activeLoan();
    const up = await upload('slip.png', 'image/png', PNG);
    const p = (await api('post', '/api/repayments').send({ loanId: l.id, amount: 100000, method: 'bank_transfer', reference: 'REF-9', attachmentIds: [up.body.data.attachment.id] })).body.data.transaction;
    expect((await api('post', `/api/repayments/${p.id}/edit`, acct).send({ amount: 90000, reason: 'Typo' })).status).toBe(403);
    expect((await api('post', `/api/repayments/${p.id}/edit`).send({ amount: 90000 })).status).toBe(400); // reason required
    const e = await api('post', `/api/repayments/${p.id}/edit`).send({ amount: 90000, reason: 'Amount typed wrongly' });
    expect(e.status).toBe(200);
    expect(e.body.data.transaction).toMatchObject({ amount: 90000, reference: 'REF-9', method: 'bank_transfer', editedFrom: p.id });
    expect(e.body.data.transaction.attachments).toHaveLength(1); // proof follows the corrected entry
    expect(e.body.data.loan.outstandingBalance).toBeCloseTo(l.totalRepayment - 90000, 2);
    const old = await Transaction.findById(p.id);
    expect(old!.reversedAt).toBeTruthy();
    expect(String(old!.supersededBy)).toBe(e.body.data.transaction.id);
    expect((await api('post', `/api/repayments/${p.id}/edit`).send({ amount: 1000, reason: 'again' })).body.code).toBe('ALREADY_REVERSED');
    const audit = await api('get', '/api/audit-logs?action=REPAYMENT_EDITED');
    expect(audit.body.data.length).toBeGreaterThanOrEqual(1);
  });
});

describe('repayment schedule download', () => {
  it('downloads as PDF, Excel and CSV, with the 25th/30th cycle', async () => {
    const l = await activeLoan();
    const bin = (r: any) => Buffer.from(r.body);
    const pdf = await api('get', `/api/loans/${l.id}/schedule/export?format=pdf`).buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(pdf.status).toBe(200);
    expect(bin(pdf).subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.headers['content-disposition']).toMatch(/protech-schedule-LN-\d+\.pdf/);
    const xlsx = await api('get', `/api/loans/${l.id}/schedule/export?format=xlsx`).buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    expect(bin(xlsx).subarray(0, 2).toString()).toBe('PK');
    const csv = await api('get', `/api/loans/${l.id}/schedule/export?format=csv`);
    expect(csv.text).toContain('Payment window opens');
    const lines = csv.text.split('\r\n').filter((x: string) => /^\d+,/.test(x));
    expect(lines).toHaveLength(6);
    expect(lines[0]!.split(',')[2]!.endsWith('-25')).toBe(true); // window opens on the 25th
    expect((await api('get', `/api/loans/${l.id}/schedule/export?format=csv`, acct)).status).toBe(200);
  });
});

describe('completed loans live on their own list', () => {
  it('are hidden from the default loan list and shown under scope=completed', async () => {
    const l = await activeLoan();
    await api('post', '/api/repayments').send({ loanId: l.id, amount: l.totalRepayment });
    expect((await api('get', `/api/loans/${l.id}`)).body.data.loan.status).toBe('completed');
    const ids = (r: any) => r.body.data.map((x: any) => x.id);
    expect(ids(await api('get', '/api/loans?limit=100'))).not.toContain(l.id);
    expect(ids(await api('get', '/api/loans?limit=100&scope=completed'))).toContain(l.id);
    expect(ids(await api('get', '/api/loans?limit=100&scope=all'))).toContain(l.id);
    expect(ids(await api('get', '/api/loans?limit=100&status=completed'))).toContain(l.id);
    // the customer's own page still shows the full history
    const cust = (await api('get', `/api/loans/${l.id}`)).body.data.loan.customer.id;
    expect((await api('get', `/api/customers/${cust}/loans`)).body.data.map((x: any) => x.id)).toContain(l.id);
  });
});

describe('accountant creates loans, the CEO approves them', () => {
  it('an older accountant account gets loans.create once; the loan waits for approval; the CEO approves and can edit it', async () => {
    const { User } = await import('../src/models/User.js');
    await User.updateOne({ username: 'accountant' }, { permissions: ['loans.view', 'customers.read'], $unset: { grantsVersion: 1 } }); // as stored before the grant existed
    const customerId = (await api('post', '/api/customers').send(customerPayload())).body.data.customer.id;
    const mk = () => api('post', '/api/loans', acct).send({ customerId, productId: salary, amount: 500000, duration: { value: 6, unit: 'months' }, startDate: isoDate(todayLagos()) });
    const r = await mk();
    expect(r.status).toBe(201);
    expect(r.body.data.loan.status).toBe('pending'); // needs the CEO's approval
    expect((await api('post', `/api/loans/${r.body.data.loan.id}/approve`, acct)).status).toBe(403);
    const edited = await api('patch', `/api/loans/${r.body.data.loan.id}`).send({ amount: 600000 });
    expect(edited.body.data.loan.amount).toBe(600000);
    const ok = await api('post', `/api/loans/${r.body.data.loan.id}/approve`);
    expect(ok.body.data.loan.status).toBe('active');
    // once granted, the CEO can take it away again and it stays away
    await User.updateOne({ username: 'accountant' }, { permissions: ['loans.view'] });
    expect((await mk()).status).toBe(403);
  });
});

describe('one-time flat interest and current-loan-only documents', () => {
  it('5% a month, flat on the principal: ₦500,000 over 12 months is ₦300,000 interest, ₦800,000 gross loan, EMI ₦66,666.67; the 4% fee stands alone', async () => {
    const p = (await api('post', '/api/loan-products').send({ name: 'Flat', code: 'FLAT', interestRate: 5, minAmount: 10000, maxAmount: 5_000_000, minDuration: 1, maxDuration: 12, durationUnit: 'months', allowedFrequencies: ['monthly'], defaultFrequency: 'monthly' })).body.data.product;
    expect(p.rateBasis).toBe('per_month'); // the default
    expect(p.applicationFeeRate).toBe(4); // the default
    const customerId = (await api('post', '/api/customers').send(customerPayload())).body.data.customer.id;
    const l = (await api('post', '/api/loans').send({ customerId, productId: p.id, amount: 500_000, duration: { value: 12, unit: 'months' }, startDate: isoDate(todayLagos()) })).body.data.loan;
    expect(l).toMatchObject({ amount: 500_000, principal: 500_000, applicationFee: 20_000, monthlyInterest: 25_000, interestAmount: 300_000, totalRepayment: 800_000, outstandingBalance: 800_000, principalBalance: 500_000, interestBalance: 300_000, numberOfInstallments: 12 });
    expect(l.installmentAmount).toBeCloseTo(66_666.67, 2);
  });
  it('the loan book lists each customer once, with their current loan only', async () => {
    const customerId = (await api('post', '/api/customers').send(customerPayload())).body.data.customer.id;
    const flat = (await api('post', '/api/loan-products').send({ name: 'Flat 2', code: 'FLAT2', interestRate: 5, applicationFeeRate: 4, minAmount: 10000, maxAmount: 5_000_000, minDuration: 1, maxDuration: 12, durationUnit: 'months', allowedFrequencies: ['monthly'], defaultFrequency: 'monthly' })).body.data.product.id;
    const mk = () => api('post', '/api/loans').send({ customerId, productId: flat, amount: 100000, duration: { value: 3, unit: 'months' }, startDate: isoDate(todayLagos()) });
    const first = (await mk()).body.data.loan;
    await api('post', '/api/repayments').send({ loanId: first.id, amount: first.totalRepayment }); // completed
    const second = (await mk()).body.data.loan;
    const book = (await api('get', '/api/reports/loan-book')).body.data.rows.filter((r: any) => r.loanId === first.loanId || r.loanId === second.loanId);
    expect(book.map((r: any) => r.loanId)).toEqual([second.loanId]);
    const stmt = (await api('get', `/api/customers/${customerId}/statement`)).body.data.statement;
    expect(stmt.loans).toHaveLength(1);
    expect(stmt.loans[0].loan.loanId).toBe(second.loanId);
    // the Excel book writes the flat monthly formula (principal x rate x tenor)
    const xl = await api('get', '/api/reports/loan-book?format=xlsx').buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const ExcelJS = (await import('exceljs')).default; const wb = new ExcelJS.Workbook(); await wb.xlsx.load(Buffer.from(xl.body) as any);
    const ws = wb.worksheets[0]!; let head = 0; ws.eachRow((row, n) => { if (!head && (row.values as any[]).includes('Clients Name')) head = n; });
    const col = (ws.getRow(head).values as any[]).indexOf('Interest');
    const formulas: string[] = []; ws.eachRow((row, n) => { if (n > head) { const v = row.getCell(col).value as any; if (v?.formula) formulas.push(String(v.formula)); } });
    expect(formulas.length).toBeGreaterThan(0);
    expect(formulas.some((f) => /^ROUND\([A-Z]+\d+\*5%\*[A-Z]+\d+,2\)$/.test(f))).toBe(true);
    const all = (await api('get', `/api/customers/${customerId}/statement?scope=all`)).body.data.statement;
    expect(all.loans).toHaveLength(2);
  });
});

describe('statement with uploaded proofs (PDF only)', () => {
  it('appends image and PDF proofs as pages; Excel/CSV refuse uploads', async () => {
    const { PDFDocument } = await import('pdf-lib');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const { StandardFonts } = await import('pdf-lib'); const sub = await PDFDocument.create(); sub.addPage([200, 100]).drawText('Credit alert NGN 20,000', { x: 10, y: 50, size: 10, font: await sub.embedFont(StandardFonts.Helvetica) }); const subPdf = Buffer.from(await sub.save());
    const l = await activeLoan();
    const p = (await api('post', '/api/repayments').send({ loanId: l.id, amount: 20000, method: 'bank_transfer', reference: 'PROOF-1' })).body.data.transaction;
    expect((await upload('alert.png', 'image/png', png, ceo, `&transactionId=${p.id}`)).status).toBe(201);
    expect((await upload('slip.pdf', 'application/pdf', subPdf, ceo, `&transactionId=${p.id}`)).status).toBe(201);
    expect((await upload('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', Buffer.from('PK'), ceo, `&transactionId=${p.id}`)).status).toBe(201);
    const get = (qs: string) => api('get', `/api/loans/${l.id}/statement?${qs}`).buffer(true).parse((res: any, cb: any) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    const plain = await PDFDocument.load(Buffer.from((await get('format=pdf')).body));
    const withProofs = await PDFDocument.load(Buffer.from((await get('format=pdf&includeUploads=true')).body));
    expect(withProofs.getPageCount()).toBe(plain.getPageCount() + 3); // image page + pdf page + "not shown" note for the .docx
    expect((await api('get', `/api/loans/${l.id}/statement?format=xlsx&includeUploads=true`)).body.code).toBe('UPLOADS_PDF_ONLY');
    expect((await api('get', `/api/loans/${l.id}/statement?format=csv&includeUploads=true`)).status).toBe(400);
  });
});

describe('premature termination (10% fee)', () => {
  it('quotes revised cost for the months used, writes off the unused interest, charges 10% of what is left as a separate fee, and completes the loan', async () => {
    const p = (await api('post', '/api/loan-products').send({ name: 'Term', code: 'TERM', interestRate: 5, minAmount: 10000, maxAmount: 5_000_000, minDuration: 1, maxDuration: 12, durationUnit: 'months', allowedFrequencies: ['monthly'], defaultFrequency: 'monthly' })).body.data.product;
    const customerId = (await api('post', '/api/customers').send(customerPayload())).body.data.customer.id;
    const loan = (await api('post', '/api/loans').send({ customerId, productId: p.id, amount: 500_000, duration: { value: 12, unit: 'months' }, startDate: isoDate(todayLagos()) })).body.data.loan;
    expect(loan.totalRepayment).toBe(800_000);
    await api('post', '/api/repayments').send({ loanId: loan.id, amount: 66_666.67 });
    // month 1 of 12: revised cost = 500,000 x (1 + 5% x 1) = 525,000; outstanding = 525,000 - 66,666.67 = 458,333.33; fee 10% = 45,833.33
    const q = (await api('get', `/api/loans/${loan.id}/termination-quote`)).body.data.quote;
    expect(q).toMatchObject({ monthsUsed: 1, feeRate: 10, totalOwed: 733_333.33, interestWaived: 275_000, outstanding: 458_333.33, fee: 45_833.33, amountToPay: 504_166.66 });
    expect((await api('post', `/api/loans/${loan.id}/terminate`, acct).send({})).status).toBe(403); // accountants ask the CEO instead
    const t = await api('post', `/api/loans/${loan.id}/terminate`).send({ method: 'bank_transfer', reference: 'TERM-1' });
    expect(t.status).toBe(200);
    expect(t.body.data.loan).toMatchObject({ status: 'completed', outstandingBalance: 0, principalBalance: 0, interestBalance: 0 });
    const tx = await Transaction.find({ loan: loan.id, reversedAt: { $exists: false } }).sort({ createdAt: 1 });
    expect(tx.map((x) => [x.type, x.amount, x.isCash, x.affectsLoanBalance])).toEqual([['disbursement', 500_000, true, false], ['repayment', 66_666.67, true, true], ['waiver', 275_000, false, true], ['repayment', 458_333.33, true, true], ['fee', 45_833.33, true, false]]);
  });

  it('an accountant requests it and the CEO approves; nothing changes before that', async () => {
    const p = (await api('get', '/api/loan-products')).body.data.products.find((x: any) => x.code === 'TERM');
    const customerId = (await api('post', '/api/customers').send(customerPayload())).body.data.customer.id;
    const loan = (await api('post', '/api/loans').send({ customerId, productId: p.id, amount: 100_000, duration: { value: 6, unit: 'months' }, startDate: isoDate(todayLagos()) })).body.data.loan;
    const r = await api('post', '/api/approvals', acct).send({ kind: 'loan_terminate', targetId: loan.id, reason: 'Customer wants out' });
    expect(r.status).toBe(201); expect(r.body.data.request.summary).toMatch(/Terminate .* early/);
    expect((await api('get', `/api/loans/${loan.id}`)).body.data.loan.status).toBe('active');
    expect((await api('post', `/api/approvals/${r.body.data.request.id}/approve`)).status).toBe(200);
    expect((await api('get', `/api/loans/${loan.id}`)).body.data.loan.status).toBe('completed');
  });
});
