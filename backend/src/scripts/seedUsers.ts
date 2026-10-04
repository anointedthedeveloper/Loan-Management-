import { User } from '../models/User.js';
import { CURRENT_GRANTS_VERSION, DEFAULT_ROLE_PERMISSIONS } from '../config/permissions.js';
import { hashPassword } from '../services/AuthService.js';
import { env } from '../config/env.js';

/** DEVELOPMENT / DEMO DATA ONLY. Never run against production. */
export async function seedUsers() {
  const defs = [
    { name: 'Adaeze Okonkwo (Demo CEO)', email: 'ceo@protech.demo', username: 'ceo', role: 'ceo' as const, pw: env.SEED_CEO_PASSWORD },
    { name: 'Tunde Bello (Demo Accountant)', email: 'accountant@protech.demo', username: 'accountant', role: 'accountant' as const, pw: env.SEED_ACCOUNTANT_PASSWORD },
  ];
  for (const d of defs) {
    if (await User.exists({ username: d.username })) continue;
    await User.create({
      name: d.name, email: d.email, username: d.username, role: d.role,
      passwordHash: await hashPassword(d.pw), permissions: DEFAULT_ROLE_PERMISSIONS[d.role], grantsVersion: CURRENT_GRANTS_VERSION, isDemoData: true,
    });
  }
}
