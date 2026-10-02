import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connectDb, disconnectDb } from '../src/config/db.js';
import { createApp } from '../src/app.js';
import { seedUsers } from '../src/scripts/seedUsers.js';
import { env } from '../src/config/env.js';
import { Customer } from '../src/models/Customer.js';
import { User } from '../src/models/User.js';

export const app = createApp();
let mongod: MongoMemoryServer;

export async function setupDb() {
  mongod = await MongoMemoryServer.create();
  await connectDb(mongod.getUri('test'));
  await Promise.all([Customer.init(), User.init()]); // make sure unique indexes exist
  await seedUsers();
}
export async function teardownDb() { await disconnectDb(); await mongod.stop(); }

export async function tokenFor(identifier: string, password: string) {
  const r = await request(app).post('/api/auth/login').send({ identifier, password });
  return r.body.data.token as string;
}
export const ceoToken = () => tokenFor('ceo', env.SEED_CEO_PASSWORD);
export const accountantToken = () => tokenFor('accountant', env.SEED_ACCOUNTANT_PASSWORD);
export const as = (t: string) => ({ Authorization: `Bearer ${t}` });

let n = 0;
export function customerPayload(over: Record<string, unknown> = {}) {
  n += 1;
  return {
    firstName: 'Chinedu', middleName: 'Emeka', lastName: `Okafor${n}`,
    phone: `0803${String(1000000 + n)}`, email: `chinedu${n}@example.com`,
    address: '12 Allen Avenue, Ikeja', state: 'Lagos', lga: 'Ikeja', gender: 'male',
    dateOfBirth: '1988-04-12', idType: 'nin', idNumber: String(70000000000 + n),
    employment: { employmentType: 'employed', employerName: 'Zenith Logistics', occupation: 'Driver', ippisNumber: `IP${100000 + n}`, ministry: 'OSGF' },
    emergencyContact: { name: 'Ada Okafor', relationship: 'Spouse', phone: '08098765432' },
    ...over,
  };
}
