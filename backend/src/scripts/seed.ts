import { connectDb, disconnectDb } from '../config/db.js';
import { env } from '../config/env.js';
import { seedUsers } from './seedUsers.js';
import { seedDemoData } from './seedDemo.js';

// Demo data is for local development only. Refuse production and any hosted (Atlas) database unless explicitly overridden.
if (env.isProd || (/mongodb\.net|mongodb\+srv/.test(env.MONGODB_URI) && process.env.ALLOW_DEMO_SEED !== '1')) {
  console.error('Refusing to seed demo data into a production / hosted database. Use `npm run seed:users` for the real accounts.');
  process.exit(1);
}
await connectDb();
await seedUsers();
await seedDemoData();
console.log('Demo users and demo loans ready: ceo / accountant (passwords from SEED_* env vars).');
await disconnectDb();
