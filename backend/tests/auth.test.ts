import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { createApp } from '../src/app.js';
import { seedUsers } from '../src/scripts/seedUsers.js';
import { env } from '../src/config/env.js';
import { AuditLog } from '../src/models/AuditLog.js';

let mongod: MongoMemoryServer;
const app = createApp();
const login = (identifier: string, password: string, remember = false) =>
  request(app).post('/api/auth/login').send({ identifier, password, remember });

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await connectDb(mongod.getUri('test'));
  await seedUsers();
});
afterAll(async () => { await disconnectDb(); await mongod.stop(); });

describe('authentication', () => {
  it('logs in by username and by email, returning a token and role permissions', async () => {
    const a = await login('ceo', env.SEED_CEO_PASSWORD);
    expect(a.status).toBe(200);
    expect(a.body.data.token).toBeTruthy();
    expect(a.body.data.user.role).toBe('ceo');
    expect(a.body.data.user.passwordHash).toBeUndefined();
    const b = await login('ACCOUNTANT@protech.demo', env.SEED_ACCOUNTANT_PASSWORD);
    expect(b.status).toBe(200);
    expect(b.body.data.user.permissions).not.toContain('staff.manage');
  });

  it('rejects bad credentials with a generic error and consistent shape', async () => {
    const r = await login('ceo', 'wrong');
    expect(r.status).toBe(401);
    expect(r.body).toMatchObject({ success: false, code: 'INVALID_CREDENTIALS' });
    const unknown = await login('nobody', 'wrong');
    expect(unknown.body.message).toBe(r.body.message);
  });

  it('validates input', async () => {
    const r = await request(app).post('/api/auth/login').send({ identifier: '' });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('VALIDATION_ERROR');
  });

  it('protects /me and rejects tampered tokens', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer abc.def.ghi')).status).toBe(401);
    const { body } = await login('ceo', env.SEED_CEO_PASSWORD);
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${body.data.token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.user.username).toBe('ceo');
  });

  it('locks an account after repeated failures', async () => {
    for (let i = 0; i < 5; i++) await login('accountant', 'bad');
    const r = await login('accountant', env.SEED_ACCOUNTANT_PASSWORD);
    expect(r.status).toBe(423);
    expect(r.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('writes audit entries', async () => {
    expect(await AuditLog.countDocuments({ action: 'LOGIN' })).toBeGreaterThan(0);
    expect(await AuditLog.countDocuments({ action: 'LOGIN_FAILED' })).toBeGreaterThan(0);
  });
});

describe('authorization (enforced on the backend)', () => {
  let ceo = ''; let acct = '';
  beforeAll(async () => {
    ceo = (await login('ceo', env.SEED_CEO_PASSWORD)).body.data.token;
    const { User } = await import('../src/models/User.js');
    await User.updateOne({ username: 'accountant' }, { lockedUntil: null, failedLoginAttempts: 0 });
    acct = (await login('accountant', env.SEED_ACCOUNTANT_PASSWORD)).body.data.token;
  });
  const as = (t: string) => ({ Authorization: `Bearer ${t}` });

  it('forbids accountants from staff management', async () => {
    expect((await request(app).get('/api/users').set(as(acct))).status).toBe(403);
    expect((await request(app).post('/api/users').set(as(acct)).send({})).status).toBe(403);
  });

  it('lets the CEO create staff, adjust permissions, and audits the change', async () => {
    const created = await request(app).post('/api/users').set(as(ceo)).send({
      name: 'New Accountant', email: 'new@protech.demo', username: 'newacct', password: 'Strongpass123', role: 'accountant',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.user.permissions).toContain('repayments.record');
    const id = created.body.data.user.id;
    const upd = await request(app).patch(`/api/users/${id}`).set(as(ceo)).send({ permissions: ['customers.read'] });
    expect(upd.body.data.user.permissions).toEqual(['customers.read']);
    expect(await AuditLog.countDocuments({ action: 'STAFF_PERMISSION_CHANGED', entityId: id })).toBe(1);
  });

  it('applies permission changes and deactivation immediately', async () => {
    const t = (await login('newacct', 'Strongpass123')).body.data.token;
    const { User } = await import('../src/models/User.js');
    await User.updateOne({ username: 'newacct' }, { isActive: false });
    expect((await request(app).get('/api/auth/me').set(as(t))).status).toBe(401);
  });

  it('rejects weak passwords and self-deactivation', async () => {
    const weak = await request(app).post('/api/users').set(as(ceo)).send({ name: 'X Y', email: 'x@y.com', username: 'xyz', password: 'weak', role: 'accountant' });
    expect(weak.status).toBe(400);
    const me = await request(app).get('/api/auth/me').set(as(ceo));
    const self = await request(app).patch(`/api/users/${me.body.data.user.id}`).set(as(ceo)).send({ isActive: false });
    expect(self.status).toBe(400);
  });

  it('returns JSON 404 for unknown routes', async () => {
    const r = await request(app).get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.success).toBe(false);
  });
});
