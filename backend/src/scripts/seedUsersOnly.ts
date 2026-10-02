import { connectDb, disconnectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { DEFAULT_ROLE_PERMISSIONS } from '../config/permissions.js';
import { hashPassword } from '../services/AuthService.js';
import { env } from '../config/env.js';

/**
 * PRODUCTION setup: the real Protech staff accounts, no demo data.
 * Creates the accounts if missing; if they exist, updates name/email/flags only (never the password).
 * Emails come from SEED_CEO_EMAIL / SEED_ACCOUNTANT_EMAIL; staff can change them later in Staff & Permissions.
 */
const people = [
  { username: 'ceo', name: 'Dr Peter Agunloye', email: (process.env.SEED_CEO_EMAIL ?? 'ceo@protech.ng').toLowerCase(), role: 'ceo' as const, password: env.SEED_CEO_PASSWORD },
  { username: 'accountant', name: 'Taiwo Oyegbata', email: (process.env.SEED_ACCOUNTANT_EMAIL ?? 'accountant@protech.ng').toLowerCase(), role: 'accountant' as const, password: env.SEED_ACCOUNTANT_PASSWORD },
];

await connectDb();
for (const p of people) {
  const existing = await User.findOne({ username: p.username });
  if (existing) {
    const emailTaken = p.email !== existing.email && (await User.exists({ email: p.email, _id: { $ne: existing._id } }));
    existing.name = p.name;
    if (!emailTaken && (process.env[p.role === 'ceo' ? 'SEED_CEO_EMAIL' : 'SEED_ACCOUNTANT_EMAIL'] || /\.demo$/.test(existing.email))) existing.email = p.email;
    existing.isDemoData = false;
    await existing.save();
    console.log(`Updated ${p.username}: ${existing.name} <${existing.email}>`);
  } else {
    await User.create({ name: p.name, email: p.email, username: p.username, role: p.role, passwordHash: await hashPassword(p.password), permissions: DEFAULT_ROLE_PERMISSIONS[p.role], isDemoData: false });
    console.log(`Created ${p.username}: ${p.name} <${p.email}>`);
  }
}
await disconnectDb();
