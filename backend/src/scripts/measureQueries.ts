// Dev tool: counts database round trips per API endpoint (each one costs network latency on a hosted database).
// Run with: npx tsx src/scripts/measureQueries.ts
import { MongoMemoryServer } from 'mongodb-memory-server';
import request from 'supertest';
import mongoose from 'mongoose';

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'x'.repeat(40);
process.env.BCRYPT_ROUNDS = '4';
const mongod = await MongoMemoryServer.create();
process.env.MONGODB_URI = mongod.getUri('measure');
const { connectDb } = await import('../config/db.js');
const { createApp } = await import('../app.js');
const { seedUsers } = await import('./seedUsers.js');
const { seedDemoData } = await import('./seedDemo.js');
await mongoose.connect(process.env.MONGODB_URI, { monitorCommands: true });
await seedUsers(); await seedDemoData();
void connectDb;
const app = createApp();
let count = 0; const names: Record<string, number> = {};
mongoose.connection.getClient().on('commandStarted', (e) => { if (['ping', 'hello', 'isMaster', 'endSessions'].includes(e.commandName)) return; count++; names[e.commandName] = (names[e.commandName] ?? 0) + 1; });
const login = await request(app).post('/api/auth/login').send({ identifier: 'ceo', password: process.env.SEED_CEO_PASSWORD ?? 'Protech@CEO2026' });
const h = { Authorization: `Bearer ${login.body.data.token}` };
const loans = (await request(app).get('/api/loans?limit=1&status=active').set(h)).body.data;
const loanId = loans[0].id; const custId = loans[0].customer.id;
const targets = ['/api/auth/me', '/api/dashboard/overview', '/api/loans?limit=15', `/api/loans/${loanId}`, `/api/loans/${loanId}/statement`, '/api/customers?limit=15', `/api/customers/${custId}`, '/api/repayments?limit=15', '/api/transactions?limit=15', '/api/reports/loans', '/api/loan-products'];
console.log('endpoint'.padEnd(46), 'db calls'.padStart(8), 'ms'.padStart(6));
for (const t of targets) {
  for (const k of Object.keys(names)) delete names[k]; count = 0; const t0 = Date.now();
  const r = await request(app).get(t).set(h);
  console.log(t.replace(loanId, ':loan').replace(custId, ':cust').padEnd(46), String(count).padStart(8), String(Date.now() - t0).padStart(6), r.status === 200 ? '' : `HTTP ${r.status}`, JSON.stringify(names));
}
await mongoose.disconnect(); await mongod.stop();
