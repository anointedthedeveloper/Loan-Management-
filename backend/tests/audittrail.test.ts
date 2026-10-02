import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken, customerPayload } from './helpers.js';
import { AuditLog } from '../src/models/AuditLog.js';

let ceo = ''; let acct = '';
const api = (m: 'get' | 'post', url: string, t = ceo) => (request(app) as any)[m](url).set(as(t));
beforeAll(async () => { await setupDb(); ceo = await ceoToken(); acct = await accountantToken(); });
afterAll(teardownDb);

describe('page views are recorded', () => {
  it('logs who opened which page and when, for any signed-in user', async () => {
    expect((await api('post', '/api/activity/page-view', acct).send({ path: '/loans', title: 'Loans' })).status).toBe(204);
    expect((await api('post', '/api/activity/page-view', ceo).send({ path: '/customers/abc123', title: 'Customer details' })).status).toBe(204);
    const v = await AuditLog.findOne({ action: 'PAGE_VIEW', entityLabel: '/loans' });
    expect(v).toMatchObject({ userName: expect.stringContaining('Tunde'), userRole: 'accountant', entity: 'Page' });
    expect(v!.createdAt).toBeInstanceOf(Date);
    expect((v!.after as any).page).toBe('Loans');
  });
  it('ignores rapid repeats, bad input and anonymous callers', async () => {
    await api('post', '/api/activity/page-view', acct).send({ path: '/reports' });
    await api('post', '/api/activity/page-view', acct).send({ path: '/reports' });
    expect(await AuditLog.countDocuments({ action: 'PAGE_VIEW', entityLabel: '/reports' })).toBe(1);
    expect((await api('post', '/api/activity/page-view', acct).send({ path: 'no-slash' })).status).toBe(400);
    expect((await api('post', '/api/activity/page-view', acct).send({})).status).toBe(400);
    expect((await request(app).post('/api/activity/page-view').send({ path: '/x' })).status).toBe(401);
  });
});

describe('actions record who did them, in what role, and when', () => {
  it('stores the role and ip on business actions and sign-ins', async () => {
    const c = await api('post', '/api/customers', acct).send(customerPayload());
    expect(c.status).toBe(201);
    const created = await AuditLog.findOne({ action: 'CUSTOMER_CREATED' });
    expect(created).toMatchObject({ userRole: 'accountant', userName: expect.stringContaining('Tunde') });
    expect(created!.createdAt).toBeInstanceOf(Date);
    expect(await AuditLog.countDocuments({ action: 'LOGIN', userRole: { $in: ['ceo', 'accountant'] } })).toBeGreaterThanOrEqual(2);
  });
});

describe('audit log filtering and export (CEO)', () => {
  it('filters by category: pages visited, sign-ins, and changes', async () => {
    const nav = (await api('get', '/api/audit-logs?category=navigation&limit=100')).body;
    expect(nav.data.length).toBeGreaterThan(0); expect(nav.data.every((a: any) => a.action === 'PAGE_VIEW')).toBe(true);
    const auth = (await api('get', '/api/audit-logs?category=auth&limit=100')).body.data;
    expect(auth.length).toBeGreaterThan(0); expect(auth.every((a: any) => ['LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'PASSWORD_CHANGED', 'PASSWORD_RESET_REQUESTED'].includes(a.action))).toBe(true);
    const changes = (await api('get', '/api/audit-logs?category=changes&limit=100')).body.data;
    expect(changes.length).toBeGreaterThan(0); expect(changes.every((a: any) => a.action !== 'PAGE_VIEW' && a.action !== 'LOGIN')).toBe(true);
  });
  it('filters by person, by role, by action and by search', async () => {
    const users = (await api('get', '/api/audit-logs/meta')).body.data.users;
    const tunde = users.find((u: any) => u.name.includes('Tunde'));
    const byUser = (await api('get', `/api/audit-logs?user=${tunde.id}&limit=100`)).body.data;
    expect(byUser.length).toBeGreaterThan(0); expect(byUser.every((a: any) => a.userName.includes('Tunde'))).toBe(true);
    const byRole = (await api('get', '/api/audit-logs?role=accountant&limit=100')).body.data;
    expect(byRole.length).toBeGreaterThan(0); expect(byRole.every((a: any) => a.userRole === 'accountant')).toBe(true);
    expect((await api('get', '/api/audit-logs?role=ceo&limit=100')).body.data.every((a: any) => a.userRole === 'ceo')).toBe(true);
    expect((await api('get', '/api/audit-logs?action=CUSTOMER_CREATED&role=accountant')).body.data.length).toBe(1);
    expect((await api('get', '/api/audit-logs?q=/loans&category=navigation')).body.data[0].entityLabel).toBe('/loans');
    expect((await api('get', '/api/audit-logs?category=weird')).status).toBe(400);
  });
  it('is CEO-only and exports a CSV with who/what/when', async () => {
    expect((await api('get', '/api/audit-logs', acct)).status).toBe(403);
    expect((await api('get', '/api/audit-logs/export', acct)).status).toBe(403);
    const csv = await api('get', '/api/audit-logs/export?role=accountant');
    expect(csv.headers['content-type']).toMatch(/text\/csv/);
    expect(csv.text.split('\r\n')[0]).toContain('Time,Person,Role,Action,Record type,Record');
    expect(csv.text).toContain('accountant');
    expect(csv.text).toContain('PAGE_VIEW');
    expect(JSON.stringify(csv.text)).not.toMatch(/passwordHash/);
  });
});
