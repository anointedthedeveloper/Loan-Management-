import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken, customerPayload } from './helpers.js';
import { Transaction } from '../src/models/Transaction.js';
import { Customer } from '../src/models/Customer.js';
import { isoDate, todayLagos } from '../src/utils/dates.js';

let ceo = ''; let acct = ''; let product = '';
const api = (m: 'get' | 'post', url: string, t = ceo) => (request(app) as any)[m](url).set(as(t));
const today = isoDate(todayLagos());
beforeAll(async () => {
  await setupDb(); ceo = await ceoToken(); acct = await accountantToken();
  product = (await api('post', '/api/loan-products').send({ name: 'SME', code: 'SME', interestRate: 0, rateBasis: 'per_month', bankDeductionRate: 0, allowedFrequencies: ['monthly'], defaultFrequency: 'monthly', maxDuration: 12 })).body.data.product.id;
});
afterAll(teardownDb);

async function loanWithPayment() {
  const cust = (await api('post', '/api/customers').send(customerPayload())).body.data.customer.id;
  const loan = (await api('post', '/api/loans').send({ customerId: cust, productId: product, amount: 100000, duration: { value: 5, unit: 'months' }, startDate: today })).body.data.loan;
  const rep = await api('post', '/api/repayments').send({ loanId: loan.id, amount: 20000 });
  return { cust, loan, txId: rep.body.data.transaction?.id ?? (await Transaction.findOne({ type: 'repayment', reversedAt: null }).sort({ createdAt: -1 }))!.id as string };
}

describe('change requests', () => {
  it('accountant requests a payment correction; nothing changes until the CEO approves', async () => {
    const { loan, txId } = await loanWithPayment();
    const r = await api('post', '/api/approvals', acct).send({ kind: 'repayment_edit', targetId: txId, payload: { amount: 25000, reason: 'Typed wrong' } });
    expect(r.status).toBe(201);
    expect((await Transaction.findById(txId))!.amount).toBe(20000);
    expect((await api('post', '/api/approvals', acct).send({ kind: 'repayment_edit', targetId: txId, payload: { amount: 26000, reason: 'again' } })).status).toBe(409);
    expect((await api('post', `/api/approvals/${r.body.data.request.id}/approve`, acct)).status).toBe(403);
    const ok = await api('post', `/api/approvals/${r.body.data.request.id}/approve`);
    expect(ok.status).toBe(200);
    const live = await api('get', `/api/loans/${loan.id}`);
    expect(live.body.data.loan.amountPaid).toBe(25000);
  });
  it('rejecting leaves data alone; accountant sees only own requests', async () => {
    const { txId } = await loanWithPayment();
    const r = await api('post', '/api/approvals', acct).send({ kind: 'transaction_reverse', targetId: txId, reason: 'Duplicate entry' });
    expect(r.status).toBe(201);
    expect((await api('post', `/api/approvals/${r.body.data.request.id}/reject`).send({ reason: 'Not a duplicate' })).status).toBe(200);
    expect((await Transaction.findById(txId))!.reversedAt).toBeFalsy();
    const mine = await api('get', '/api/approvals', acct);
    expect(mine.status).toBe(200);
    expect(mine.body.data.items.every((i: any) => i.requestedByName)).toBe(true);
  });
  it('customer deletion needs approval', async () => {
    const cust = (await api('post', '/api/customers').send(customerPayload())).body.data.customer.id;
    expect((await api('post', '/api/customers/' + cust, acct).send({})).status).toBeGreaterThanOrEqual(400);
    const r = await api('post', '/api/approvals', acct).send({ kind: 'customer_delete', targetId: cust, reason: 'Duplicate' });
    expect(r.status).toBe(201);
    expect((await Customer.findById(cust))!.isArchived).toBe(false);
    expect((await api('post', `/api/approvals/${r.body.data.request.id}/approve`)).status).toBe(200);
    expect((await Customer.findById(cust))!.isArchived).toBe(true);
  });
  it('accountant can download reports', async () => {
    expect((await api('get', '/api/reports/loan-book?format=xlsx', acct)).status).toBe(200);
  });
});
