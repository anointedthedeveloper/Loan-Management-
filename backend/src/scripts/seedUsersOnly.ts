import { connectDb, disconnectDb } from '../config/db.js';
import { seedUsers } from './seedUsers.js';

/** Creates only the first CEO and accountant (no demo customers or loans). Passwords come from SEED_CEO_PASSWORD / SEED_ACCOUNTANT_PASSWORD. */
await connectDb();
await seedUsers();
console.log('Users ready (ceo / accountant). Existing users were left untouched.');
await disconnectDb();
