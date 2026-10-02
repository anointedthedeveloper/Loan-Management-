import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken, customerPayload } from './helpers.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { Customer } from '../src/models/Customer.js';
import { User } from '../src/models/User.js';
import { setCustomerFinancialProvider, emptyProvider } from '../src/services/customerFinancials.service.js';

let ceo = ''; let acct = '';
beforeAll(async () => { await setupDb(); ceo = await ceoToken(); acct = await accountantToken(); });
afterAll(async () => { setCustomerFinancialProvider(emptyProvider); await teardownDb(); });

const create = (body = customerPayload(), t = ceo) => request(app).post('/api/customers').set(as(t)).send(body);

describe('customer creation', () => {
  it('creates a customer with a sequential human-readable ID and audits it', async () => {
    const a = await create();
    expect(a.status).toBe(201);
    expect(a.body.data.customer.customerId).toMatch(/^PTC-\d{6}$/);
    expect(a.body.data.customer.fullName).toBe(a.body.data.customer.firstName + ' Emeka ' + a.body.data.customer.lastName);
    expect(a.body.data.customer.status).toBe('active');
    expect(a.body.data.customer.phone).toMatch(/^0803/);
    const b = await create();
    const n = (r: any) => Number(r.body.data.customer.customerId.slice(4));
    expect(n(b)).toBe(n(a) + 1);
    expect(await AuditLog.countDocuments({ action: 'CUSTOMER_CREATED', entityLabel: a.body.data.customer.customerId })).toBe(1);
  });

  it('never produces duplicate IDs under concurrent creation', async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => create()));
    const ids = rs.map((r) => r.body.data.customer.customerId);
    expect(rs.every((r) => r.status === 201)).toBe(true);
    expect(new Set(ids).size).toBe(10);
  });

  it('normalises phone numbers and validates input', async () => {
    const ok = await create(customerPayload({ phone: '+234 803 555 0101' }));
    expect(ok.body.data.customer.phone).toBe('08035550101');
    const bad = await create(customerPayload({ phone: '12345', email: 'nope', firstName: '' }));
    expect(bad.status).toBe(400);
    expect(bad.body.code).toBe('VALIDATION_ERROR');
    expect(Object.keys(bad.body.errors)).toEqual(expect.arrayContaining(['phone', 'email', 'firstName']));
    const idOnly = await create(customerPayload({ idType: 'nin', idNumber: '' }));
    expect(idOnly.body.errors.idNumber).toBeTruthy();
  });

  it('requires the essential details (identity, contact, ID, IPPIS, emergency contact)', async () => {
    const r = await create({ firstName: 'Minimal', lastName: 'Person', phone: '07011112222', address: '1 Short St' } as any);
    expect(r.status).toBe(400);
    expect(Object.keys(r.body.errors)).toEqual(expect.arrayContaining(['email', 'state', 'dateOfBirth', 'gender', 'idType', 'idNumber', 'employment', 'emergencyContact']));
    const blanks = await create(customerPayload({ employment: { ippisNumber: '', ministry: '' }, emergencyContact: { name: '', phone: '' }, email: '' }));
    expect(Object.keys(blanks.body.errors)).toEqual(expect.arrayContaining(['employment.ippisNumber', 'employment.ministry', 'emergencyContact.name', 'emergencyContact.phone', 'email']));
  });

  it('allows the genuinely optional fields to be omitted', async () => {
    const p: any = customerPayload();
    for (const k of ['middleName', 'altPhone', 'lga', 'notes', 'legacyId']) delete p[k];
    p.employment = { ippisNumber: p.employment.ippisNumber, ministry: p.employment.ministry };
    p.emergencyContact = { name: p.emergencyContact.name, phone: p.emergencyContact.phone };
    expect((await create(p)).status).toBe(201);
  });

  it('accepts only male or female, and validates NIN/BVN as 11 digits', async () => {
    expect((await create(customerPayload({ gender: 'other' }))).body.errors.gender).toBeTruthy();
    expect((await create(customerPayload({ gender: 'female' }))).status).toBe(201);
    expect((await create(customerPayload({ idType: 'nin', idNumber: '12345' }))).body.errors.idNumber).toMatch(/11 digits/);
    expect((await create(customerPayload({ idType: 'bvn', idNumber: '1234567890A' }))).body.errors.idNumber).toBeTruthy();
    expect((await create(customerPayload({ idType: 'drivers_license', idNumber: 'ABC12345678' }))).status).toBe(201);
  });

  it('rejects duplicates by phone, email and identification (server-side)', async () => {
    const base = customerPayload();
    expect((await create(base)).status).toBe(201);
    const byPhone = await create(customerPayload({ phone: base.phone }));
    expect(byPhone.status).toBe(409);
    expect(byPhone.body.code).toBe('DUPLICATE_CUSTOMER');
    expect(byPhone.body.errors.phone).toBeTruthy();
    expect((await create(customerPayload({ email: base.email }))).body.errors.email).toBeTruthy();
    expect((await create(customerPayload({ idNumber: base.idNumber }))).body.errors.idNumber).toBeTruthy();
  });

  it('ignores a client-supplied customerId', async () => {
    const r = await create(customerPayload({ customerId: 'HACK-1' }));
    expect(r.body.data.customer.customerId).toMatch(/^PTC-/);
  });
});

describe('payroll details from the loan book', () => {
  it('stores IPPIS number, ministry and the legacy client number', async () => {
    const r = await create(customerPayload({ legacyId: '473', employment: { ippisNumber: '437602', ministry: 'OSGF', occupation: 'Clerk' } }));
    expect(r.status).toBe(201);
    expect(r.body.data.customer.employment).toMatchObject({ ippisNumber: '437602', ministry: 'OSGF' });
    expect(r.body.data.customer.legacyId).toBe('473');
  });
});

describe('customer retrieval and update', () => {
  it('gets a customer and 404s for unknown/invalid ids', async () => {
    const c = (await create()).body.data.customer;
    const got = await request(app).get(`/api/customers/${c.id}`).set(as(ceo));
    expect(got.status).toBe(200);
    expect(got.body.data.customer.customerId).toBe(c.customerId);
    expect(got.body.data.customer.createdBy.name).toMatch(/CEO/);
    expect((await request(app).get('/api/customers/64b000000000000000000000').set(as(ceo))).status).toBe(404);
    expect((await request(app).get('/api/customers/not-an-id').set(as(ceo))).status).toBe(404);
  });

  it('updates fields, audits changes with before/after, and tracks status separately', async () => {
    const c = (await create()).body.data.customer;
    const r = await request(app).patch(`/api/customers/${c.id}`).set(as(ceo)).send({ address: '99 New Road', status: 'suspended' });
    expect(r.status).toBe(200);
    expect(r.body.data.customer.address).toBe('99 New Road');
    expect(r.body.data.customer.status).toBe('suspended');
    const upd = await AuditLog.findOne({ action: 'CUSTOMER_UPDATED', entityId: c.id });
    expect(upd?.before).toMatchObject({ address: '12 Allen Avenue, Ikeja' });
    expect(upd?.after).toMatchObject({ address: '99 New Road' });
    const st = await AuditLog.findOne({ action: 'CUSTOMER_STATUS_CHANGED', entityId: c.id });
    expect(st?.before).toEqual({ status: 'active' });
    expect(st?.after).toEqual({ status: 'suspended' });
  });

  it('recomputes full name and blocks updating into a duplicate', async () => {
    const a = (await create()).body.data.customer;
    const b = (await create()).body.data.customer;
    const renamed = await request(app).patch(`/api/customers/${a.id}`).set(as(ceo)).send({ lastName: 'Renamed' });
    expect(renamed.body.data.customer.fullName).toBe('Chinedu Emeka Renamed');
    const dup = await request(app).patch(`/api/customers/${b.id}`).set(as(ceo)).send({ phone: a.phone });
    expect(dup.status).toBe(409);
    const rejected = await request(app).patch(`/api/customers/${b.id}`).set(as(ceo)).send({ status: 'weird' });
    expect(rejected.status).toBe(400);
  });
});

describe('clearing optional fields', () => {
  it('unsets a field when the form sends a blank value', async () => {
    const c = (await create()).body.data.customer;
    const r = await request(app).patch(`/api/customers/${c.id}`).set(as(ceo)).send({ altPhone: '', employment: { occupation: '' } });
    expect(r.status).toBe(200);
    expect(r.body.data.customer.altPhone).toBeUndefined();
    expect(r.body.data.customer.employment?.occupation).toBeUndefined();
    expect(r.body.data.customer.employment?.ippisNumber).toBe(c.employment.ippisNumber); // untouched sibling kept
    const blank = await request(app).patch(`/api/customers/${c.id}`).set(as(ceo)).send({ email: '' });
    expect(blank.status).toBe(400); // required fields cannot be blanked
    expect(blank.body.errors.email).toBeTruthy();
  });
});

describe('search, filter, sort and pagination', () => {
  beforeAll(async () => {
    await Customer.deleteMany({});
    const people = [
      ['Amaka', 'Nwosu', '08031110001', 'amaka@acme.ng', '2026-01-10', 'active'],
      ['Bola', 'Adeyemi', '08031110002', 'bola@acme.ng', '2026-02-10', 'active'],
      ['Chidi', 'Eze', '08031110003', 'chidi@other.ng', '2026-03-10', 'inactive'],
      ['Dayo', 'Balogun', '08031110004', 'dayo@other.ng', '2026-04-10', 'blacklisted'],
      ['Efe', 'Ogbe', '08031110005', 'efe@other.ng', '2026-05-10', 'active'],
    ];
    for (const [f, l, ph, em, d, st] of people)
      await create(customerPayload({ firstName: f, middleName: '', lastName: l, phone: ph, email: em, registrationDate: d, status: st }));
  });
  const list = (qs: string) => request(app).get(`/api/customers?${qs}`).set(as(ceo));

  it('returns pagination metadata', async () => {
    const r = await list('page=2&limit=2');
    expect(r.body.pagination).toEqual({ page: 2, limit: 2, total: 5, pages: 3 });
    expect(r.body.data).toHaveLength(2);
    expect((await list('page=3&limit=2')).body.data).toHaveLength(1);
    expect((await list('limit=1000')).status).toBe(400);
  });
  it('searches by name, phone, email and customer ID', async () => {
    expect((await list('q=amaka')).body.data[0].lastName).toBe('Nwosu');
    expect((await list('q=Adeyemi')).body.pagination.total).toBe(1);
    expect((await list('q=08031110003')).body.data[0].lastName).toBe('Eze');
    expect((await list('q=%2B2348031110004')).body.data[0].lastName).toBe('Balogun');
    expect((await list('q=other.ng')).body.pagination.total).toBe(3);
    const id = (await list('q=Ogbe')).body.data[0].customerId;
    expect((await list(`q=${id}`)).body.data[0].lastName).toBe('Ogbe');
    expect((await list('q=zzzz')).body.data).toEqual([]);
  });
  it('treats search text literally (no regex injection)', async () => {
    const r = await list('q=.*');
    expect(r.status).toBe(200);
    expect(r.body.pagination.total).toBe(0);
  });
  it('filters by status (single and multiple) and registration date', async () => {
    expect((await list('status=inactive')).body.pagination.total).toBe(1);
    expect((await list('status=inactive,blacklisted')).body.pagination.total).toBe(2);
    expect((await list('status=bogus')).status).toBe(400);
    expect((await list('from=2026-02-01&to=2026-04-30')).body.pagination.total).toBe(3);
  });
  it('sorts', async () => {
    const asc = (await list('sort=fullName&order=asc')).body.data.map((c: any) => c.lastName);
    expect(asc[0]).toBe('Nwosu'); // "Amaka Nwosu" is first by full name
    const byDate = (await list('sort=registrationDate&order=desc')).body.data;
    expect(byDate[0].lastName).toBe('Ogbe');
  });
});

describe('authorization', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/customers')).status).toBe(401);
    expect((await request(app).post('/api/customers').send(customerPayload())).status).toBe(401);
  });
  it('accountant defaults: can read/create, cannot update or delete', async () => {
    const c = (await create(customerPayload(), acct));
    expect(c.status).toBe(201);
    expect((await request(app).get('/api/customers').set(as(acct))).status).toBe(200);
    expect((await request(app).patch(`/api/customers/${c.body.data.customer.id}`).set(as(acct)).send({ notes: 'x' })).status).toBe(403);
    expect((await request(app).delete(`/api/customers/${c.body.data.customer.id}`).set(as(acct))).status).toBe(403);
  });
  it('honours permissions assigned by the CEO (and revokes immediately)', async () => {
    await User.updateOne({ username: 'accountant' }, { permissions: ['customers.read'] });
    expect((await create(customerPayload(), acct)).status).toBe(403);
    expect((await request(app).get('/api/customers').set(as(acct))).status).toBe(200);
    expect((await request(app).get('/api/customers/x/summary').set(as(acct))).status).toBe(403);
    expect((await request(app).get('/api/customers/x/activity').set(as(acct))).status).toBe(403);
    await User.updateOne({ username: 'accountant' }, { permissions: [] }); // empty -> role defaults
  });
});

describe('financial endpoints and deletion', () => {
  it('returns honest empty data until finance modules exist', async () => {
    const c = (await create()).body.data.customer;
    const s = await request(app).get(`/api/customers/${c.id}/summary`).set(as(ceo));
    expect(s.body.data).toMatchObject({ available: false, metrics: null });
    for (const kind of ['loans', 'repayments', 'transactions']) {
      const r = await request(app).get(`/api/customers/${c.id}/${kind}`).set(as(ceo));
      expect(r.body).toMatchObject({ success: true, data: [], pagination: { total: 0, pages: 0 } });
    }
    const act = await request(app).get(`/api/customers/${c.id}/activity`).set(as(ceo));
    expect(act.body.data[0].action).toBe('CUSTOMER_CREATED');
  });

  it('archives a customer with no history (soft delete) and frees the unique fields', async () => {
    const payload = customerPayload();
    const c = (await create(payload)).body.data.customer;
    const del = await request(app).delete(`/api/customers/${c.id}`).set(as(ceo));
    expect(del.status).toBe(200);
    expect((await request(app).get(`/api/customers/${c.id}`).set(as(ceo))).status).toBe(404);
    expect(await Customer.countDocuments({ _id: c.id, isArchived: true })).toBe(1); // still in the database
    expect(await AuditLog.countDocuments({ action: 'CUSTOMER_DELETED', entityId: c.id })).toBe(1);
    expect((await create(payload)).status).toBe(201);
  });

  it('refuses to delete a customer that has financial history', async () => {
    const c = (await create()).body.data.customer;
    setCustomerFinancialProvider({ ...emptyProvider, hasFinancialHistory: async () => true });
    const del = await request(app).delete(`/api/customers/${c.id}`).set(as(ceo));
    setCustomerFinancialProvider(emptyProvider);
    expect(del.status).toBe(409);
    expect(del.body.code).toBe('CUSTOMER_HAS_FINANCIAL_HISTORY');
    expect(del.body.message).toMatch(/auditable/);
    expect((await request(app).get(`/api/customers/${c.id}`).set(as(ceo))).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'CUSTOMER_DELETED', entityId: c.id })).toBe(0);
  });
});
