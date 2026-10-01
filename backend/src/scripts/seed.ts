import { connectDb, disconnectDb } from '../config/db.js';
import { env } from '../config/env.js';
import { seedUsers } from './seedUsers.js';

if (env.isProd) { console.error('Refusing to seed demo data in production.'); process.exit(1); }
await connectDb();
await seedUsers();
console.log('Demo users ready: ceo / accountant (passwords from SEED_* env vars).');
await disconnectDb();
