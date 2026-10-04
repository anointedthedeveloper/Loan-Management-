// Imports Protech's customer sheet into the database configured by MONGODB_URI.
//   npm run import:customers -- path/to/CUSTOMER_DETAILS.xlsx [--dry-run]
import { readFileSync } from 'node:fs';
import { connectDb, disconnectDb } from '../config/db.js';
import { User } from '../models/User.js';
import { importCustomers } from '../services/customerImport.service.js';

const file = process.argv[2]; const dryRun = process.argv.includes('--dry-run');
if (!file) { console.error('Usage: npm run import:customers -- <file.xlsx> [--dry-run]'); process.exit(1); }
await connectDb();
const ceo = await User.findOne({ role: 'ceo' });
if (!ceo) { console.error('No CEO account found. Create the users first (npm run seed:users).'); process.exit(1); }
const r = await importCustomers(readFileSync(file), { dryRun, actor: { id: String(ceo._id), name: ceo.name, role: 'ceo' } as any });
console.log(`${dryRun ? 'DRY RUN (nothing saved)\n' : ''}Rows: ${r.total}  created: ${r.created}  updated: ${r.updated}  unchanged: ${r.unchanged}  skipped: ${r.skipped.length}`);
if (r.idChanges.length) { console.log('\nClient numbers that were changed or assigned:'); r.idChanges.forEach((c) => console.log(`  row ${c.row} ${c.name}: ${c.from ?? '(none)'} -> ${c.to} (${c.reason})`)); }
if (r.skipped.length) { console.log('\nSkipped:'); r.skipped.forEach((c) => console.log(`  row ${c.row} ${c.name}: ${c.reason}`)); }
if (r.warnings.length) { console.log('\nWarnings:'); r.warnings.forEach((c) => console.log(`  row ${c.row} ${c.name}: ${c.message}`)); }
console.log(`\nThe next new customer will be ${r.nextCustomerId}.`);
await disconnectDb();
