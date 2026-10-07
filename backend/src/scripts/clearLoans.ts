import mongoose from 'mongoose';
import { connectDb, disconnectDb } from '../config/db.js';
import { Loan } from '../models/Loan.js';
import { Transaction } from '../models/Transaction.js';
import { RepaymentSchedule } from '../models/RepaymentSchedule.js';
import { TopUp } from '../models/TopUp.js';
import { Attachment } from '../models/Attachment.js';
import { MonthlyUpload } from '../models/MonthlyUpload.js';
import { ApprovalRequest } from '../models/ApprovalRequest.js';

/**
 * Clears ALL loans and transactions (and what hangs off them: schedules, top-ups, uploaded proofs,
 * monthly-upload history, approval requests) and restarts LN-/TX-/TU-/REQ- numbering.
 * Keeps customers (and their PTC numbering), staff accounts, loan products, settings and the audit log.
 * Run without --yes to only count what would be removed.
 */
const yes = process.argv.includes('--yes');
const targets = [['loans', Loan], ['transactions', Transaction], ['schedules', RepaymentSchedule], ['top-ups', TopUp], ['attachments', Attachment], ['monthly uploads', MonthlyUpload], ['approval requests', ApprovalRequest]] as const;

await connectDb();
for (const [label, m] of targets) console.log(`${yes ? 'Removing' : 'Would remove'} ${await (m as any).countDocuments()} ${label}`);
if (yes) {
  for (const [, m] of targets) await (m as any).deleteMany({});
  const r = await mongoose.connection.collection('counters').deleteMany({ _id: { $in: ['loan', 'transaction', 'topup', 'approval'] } as any });
  console.log(`Reset ${r.deletedCount} numbering counters. Done.`);
} else console.log('\nNothing was changed. Add --yes to really delete.');
await disconnectDb();
