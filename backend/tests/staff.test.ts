import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, setupDb, teardownDb, ceoToken, accountantToken, tokenFor } from './helpers.js';
import { AuditLog } from '../src/models/AuditLog.js';
import { User } from '../src/models/User.js';

let ceo = ''; let acct = '';
beforeAll(async () => { await setupDb(); ceo = await ceoToken(); acct = await accountantToken(); });
afterAll(teardownDb);

const newStaff = (over: Record<string, unknown> = {}) => ({ name: 'Ngozi Eze', email: 'ngozi@protech.demo', username: 'ngozi', password: 'Strongpass123', role: 'accountant', ...over });
const mk = async (over = {}) => (await request(app).post('/api/users').set(as(ceo)).send(newStaff(over))).body.data?.user;
const patch = (id: string, body: object, t = ceo) => request(app).patch(`/api/users/${id}`).set(as(t)).send(body);

describe('staff management', () => {
  it('creates staff with role-default permissions, audits it, and rejects duplicates', async () => {
    const r = await request(app).post('/api/users').set(as(ceo)).send(newStaff());
    expect(r.status).toBe(201);
    expect(r.body.data.user.permissions).toContain('customers.read');
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|Strongpass/);
    const log = await AuditLog.findOne({ action: 'STAFF_CREATED', entityId: r.body.data.user.id });
    expect(JSON.stringify(log)).not.toMatch(/passwordHash|Strongpass/);
    const dup = await request(app).post('/api/users').set(as(ceo)).send(newStaff({ username: 'other' }));
    expect(dup.status).toBe(409);
    expect(dup.body.errors.email).toBeTruthy();
  });

  it('gets staff details and lists them', async () => {
    const u = await mk({ email: 'g@protech.demo', username: 'getme' });
    expect((await request(app).get(`/api/users/${u.id}`).set(as(ceo))).body.data.user.username).toBe('getme');
    expect((await request(app).get('/api/users').set(as(ceo))).body.data.users.length).toBeGreaterThan(2);
    expect((await request(app).get('/api/users/zzz').set(as(ceo))).status).toBe(404);
  });

  it('updates profile with audited before/after', async () => {
    const u = await mk({ email: 'p@protech.demo', username: 'profile' });
    const r = await patch(u.id, { name: 'Profile Renamed' });
    expect(r.body.data.user.name).toBe('Profile Renamed');
    const log = await AuditLog.findOne({ action: 'STAFF_UPDATED', entityId: u.id });
    expect(log?.before).toEqual({ name: 'Ngozi Eze' });
    expect(log?.after).toEqual({ name: 'Profile Renamed' });
  });

  it('changes permissions and records what was added/removed', async () => {
    const u = await mk({ email: 'perm@protech.demo', username: 'permuser' });
    const r = await patch(u.id, { permissions: ['customers.read', 'loans.approve'] });
    expect(r.body.data.user.permissions).toEqual(['customers.read', 'loans.approve']);
    const log = await AuditLog.findOne({ action: 'STAFF_PERMISSION_CHANGED', entityId: u.id });
    expect((log?.after as any).added).toEqual(['loans.approve']);
    expect((log?.before as any).removed).toContain('repayments.record');
    expect((await patch(u.id, { permissions: ['not.real'] })).status).toBe(400);
  });

  it('changes role (resetting to that role\'s defaults) and audits it', async () => {
    const u = await mk({ email: 'role@protech.demo', username: 'roleuser' });
    const up = await patch(u.id, { role: 'ceo' });
    expect(up.body.data.user.role).toBe('ceo');
    expect(up.body.data.user.permissions).toContain('staff.manage');
    expect(await AuditLog.countDocuments({ action: 'STAFF_ROLE_CHANGED', entityId: u.id })).toBe(1);
    const down = await patch(u.id, { role: 'accountant' });
    expect(down.body.data.user.permissions).not.toContain('staff.manage');
  });

  it('deactivates / activates, blocking access immediately, and audits both', async () => {
    const u = await mk({ email: 'act@protech.demo', username: 'activeuser' });
    const t = await tokenFor('activeuser', 'Strongpass123');
    await patch(u.id, { isActive: false });
    expect((await request(app).get('/api/auth/me').set(as(t))).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ identifier: 'activeuser', password: 'Strongpass123' })).status).toBe(403);
    await patch(u.id, { isActive: true });
    expect((await request(app).post('/api/auth/login').send({ identifier: 'activeuser', password: 'Strongpass123' })).status).toBe(200);
    expect(await AuditLog.countDocuments({ action: 'STAFF_DEACTIVATED', entityId: u.id })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'STAFF_ACTIVATED', entityId: u.id })).toBe(1);
  });

  it('resets passwords (supplied or generated), invalidates sessions, never logs the secret', async () => {
    const u = await mk({ email: 'pw@protech.demo', username: 'pwuser' });
    const old = await tokenFor('pwuser', 'Strongpass123');
    const gen = await request(app).post(`/api/users/${u.id}/reset-password`).set(as(ceo)).send({});
    expect(gen.body.data.temporaryPassword).toMatch(/^[A-Za-z0-9]{12}$/);
    expect((await request(app).post('/api/auth/login').send({ identifier: 'pwuser', password: 'Strongpass123' })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ identifier: 'pwuser', password: gen.body.data.temporaryPassword })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 1100));
    await request(app).post(`/api/users/${u.id}/reset-password`).set(as(ceo)).send({ password: 'Another1Strong' });
    expect((await request(app).get('/api/auth/me').set(as(old))).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ identifier: 'pwuser', password: 'Another1Strong' })).status).toBe(200);
    const logs = await AuditLog.find({ action: 'STAFF_PASSWORD_RESET', entityId: u.id });
    expect(logs).toHaveLength(2);
    expect(JSON.stringify(logs)).not.toContain(gen.body.data.temporaryPassword);
    expect(JSON.stringify(logs)).not.toContain('Another1Strong');
    expect((await request(app).post(`/api/users/${u.id}/reset-password`).set(as(ceo)).send({ password: 'weak' })).status).toBe(400);
  });

  it('shows staff activity (logins + account changes)', async () => {
    const u = await mk({ email: 'ac@protech.demo', username: 'activity' });
    await tokenFor('activity', 'Strongpass123');
    await patch(u.id, { name: 'Activity Person' });
    const r = await request(app).get(`/api/users/${u.id}/activity`).set(as(ceo));
    const actions = r.body.data.map((a: any) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['STAFF_CREATED', 'LOGIN', 'STAFF_UPDATED']));
    expect(r.body.pagination.total).toBe(actions.length);
  });

  it('enforces permissions on the backend', async () => {
    const u = await mk({ email: 'x@protech.demo', username: 'xuser' });
    for (const [m, path] of [['get', '/api/users'], ['get', `/api/users/${u.id}`], ['patch', `/api/users/${u.id}`], ['post', `/api/users/${u.id}/reset-password`], ['get', `/api/users/${u.id}/activity`], ['delete', `/api/users/${u.id}`]] as const)
      expect((await (request(app) as any)[m](path).set(as(acct)).send({})).status, `${m} ${path}`).toBe(403);
    expect((await request(app).get('/api/users')).status).toBe(401);
  });
});

describe('last CEO protection', () => {
  it('lets a CEO manage another CEO while a second active CEO remains', async () => {
    const second = await mk({ email: 'ceo2@protech.demo', username: 'ceo2', role: 'ceo' });
    const firstId = String((await User.findOne({ username: 'ceo' }))!._id);
    const t2 = await tokenFor('ceo2', 'Strongpass123');
    expect((await patch(firstId, { isActive: false }, t2)).status).toBe(200);
    expect((await patch(firstId, { isActive: true }, t2)).status).toBe(200);
    await User.deleteOne({ _id: second.id });
  });

  it('prevents deactivating, demoting, restricting or deleting the only active CEO', async () => {
    // A non-CEO delegate with staff.manage tries to act on the only CEO.
    await mk({ email: 'adm@protech.demo', username: 'admin1', permissions: ['staff.manage'] });
    const adminToken = await tokenFor('admin1', 'Strongpass123');
    const ceoId = String((await User.findOne({ username: 'ceo' }))!._id);
    const a = await patch(ceoId, { isActive: false }, adminToken);
    expect([a.status, a.body.code]).toEqual([409, 'LAST_CEO']);
    expect((await patch(ceoId, { role: 'accountant' }, adminToken)).body.code).toBe('LAST_CEO');
    expect((await request(app).delete(`/api/users/${ceoId}`).set(as(adminToken))).body.code).toBe('LAST_CEO');
    const strip = await patch(ceoId, { permissions: [] }, adminToken);
    expect([strip.status, strip.body.code]).toEqual([400, 'CEO_PERMISSIONS_FIXED']);
    const ceo = (await User.findById(ceoId))!;
    expect([ceo.isActive, ceo.role]).toEqual([true, 'ceo']);
  });

  it('stops a CEO deactivating, demoting or deleting their own account', async () => {
    const me = String((await User.findOne({ username: 'ceo' }))!._id);
    expect((await patch(me, { isActive: false })).body.code).toBe('SELF_MODIFICATION');
    expect((await patch(me, { role: 'accountant' })).body.code).toBe('SELF_MODIFICATION');
    expect((await request(app).delete(`/api/users/${me}`).set(as(ceo))).body.code).toBe('SELF_MODIFICATION');
  });
});
