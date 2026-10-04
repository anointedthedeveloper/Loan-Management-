import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken, customerPayload } from './helpers.js';
import { Transaction } from '../src/models/Transaction.js';
import { isoDate, todayLagos } from '../src/utils/dates.js';

let ceo = ''; let acct = ''; let salary = '';
const api = (m: 'get' | 'post' | 'patch' | 'put' | 'delete', url: string, t = ceo) => (request(app) as any)[m](url).set(as(t));
beforeAll(async () => {
  await setupDb(); ceo = await ceoToken(); acct = await accountantToken();
  salary = (await api('post', '/api/loan-products').send({ name: 'Salary Advance', code: 'SAL', interestRate: 5, rateBasis: 'per_month', bankDeductionRate: 4, minAmount: 10000, maxAmount: 5_000_000, minDuration: 1, maxDuration: 12, durationUnit: 'months', allowedFrequencies: ['monthly'], defaultFrequency: 'monthly' })).body.data.product.id;
});
afterAll(teardownDb);

async function activeLoan() {
  const customerId = (await api('post', '/api/customers').send(customerPayload())).body.data.customer.id;
  const c = await api('post', '/api/loans').send({ customerId, productId: salary, amount: 960000, duration: { value: 6, unit: 'months' }, startDate: isoDate(todayLagos()) });
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
