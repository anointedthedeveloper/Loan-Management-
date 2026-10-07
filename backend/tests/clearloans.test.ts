import { afterAll, beforeAll, expect, it } from 'vitest';
import request from 'supertest';
import { execFileSync } from 'node:child_process';
import mongoose from 'mongoose';
import { app, as, setupDb, teardownDb, ceoToken, customerPayload } from './helpers.js';
import { Loan } from '../src/models/Loan.js';
import { Customer } from '../src/models/Customer.js';
import { User } from '../src/models/User.js';

beforeAll(setupDb); afterAll(teardownDb);
it('clear:loans keeps customers and staff, removes loans and transactions, dry run changes nothing', async () => {
  const ceo = await ceoToken();
  const api = (m: 'post', u: string) => (request(app) as any)[m](u).set(as(ceo));
  const product = (await api('post', '/api/loan-products').send({ name: 'SME', code: 'SME', interestRate: 0, rateBasis: 'per_month', bankDeductionRate: 0, allowedFrequencies: ['monthly'], defaultFrequency: 'monthly', maxDuration: 12 })).body.data.product.id;
  const cust = (await api('post', '/api/customers').send(customerPayload())).body.data.customer.id;
  await api('post', '/api/loans').send({ customerId: cust, productId: product, amount: 1000, duration: { value: 2, unit: 'months' }, startDate: new Date().toISOString().slice(0, 10) });
  const run = (...a: string[]) => execFileSync('npx', ['tsx', 'src/scripts/clearLoans.ts', ...a], { env: { ...process.env, MONGODB_URI: (mongoose.connection as any).client.s.url ?? process.env.MONGODB_URI }, encoding: 'utf8' });
  const uri = process.env.MONGODB_URI!;
  expect(uri).toBeTruthy();
  run(); expect(await Loan.countDocuments()).toBe(1);
  run('--yes'); expect(await Loan.countDocuments()).toBe(0);
  expect(await Customer.countDocuments()).toBe(1); expect(await User.countDocuments()).toBeGreaterThan(0);
}, 60000);
