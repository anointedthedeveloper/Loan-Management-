import { Customer } from '../models/Customer.js';
import { User } from '../models/User.js';
import { Loan } from '../models/Loan.js';
import { Transaction } from '../models/Transaction.js';
import { RepaymentSchedule } from '../models/RepaymentSchedule.js';
import { CUSTOMER_STATUSES } from '../config/customerOptions.js';
import { LOAN_STATUSES } from '../config/loanOptions.js';
import { addDays, addMonths, todayLagos, utcDate } from '../utils/dates.js';
import { round2 } from '../utils/money.js';
import { listAudit } from './AuditService.js';
import { listTransactions } from './transaction.service.js';
import { listLoans } from './loan.service.js';
import type { Permission } from '../config/permissions.js';

const LIVE = ['active', 'overdue', 'defaulted'];
const sum = (rows: any[], k: string) => round2(rows.reduce((s, r) => s + (r[k] ?? 0), 0));

/** Every figure is derived from the database for the signed-in user's permissions. Nothing is hard-coded. */
export async function getOverview(permissions: Permission[]) {
  const has = (p: Permission) => permissions.includes(p);
  const today = todayLagos();
  const out: Record<string, unknown> = {};

  // Every section is independent, so they all run at the same time: one network round trip of waiting instead of ~30 in a row.
  const sections: Promise<void>[] = [];
  const add = (fn: () => Promise<void>) => sections.push(fn());

  if (has('customers.read')) add(async () => {
    const [rows, recent] = await Promise.all([Customer.aggregate([{ $match: { isArchived: false } }, { $group: { _id: '$status', count: { $sum: 1 } } }]), listCustomersLite()]);
    const counts = Object.fromEntries(rows.map((r) => [r._id, r.count]));
    out.customers = { total: rows.reduce((s, r) => s + r.count, 0), byStatus: CUSTOMER_STATUSES.map((s) => ({ value: s.value, label: s.label, tone: s.tone, count: counts[s.value] ?? 0 })) };
    out.recentCustomers = recent.slice(0, 5);
  });
  if (has('staff.manage')) add(async () => { const [total, active] = await Promise.all([User.countDocuments(), User.countDocuments({ isActive: true })]); out.staff = { total, active }; });
  if (has('audit.view')) add(async () => { out.recentActivity = (await listAudit({}, { page: 1, limit: 8 })).items; });

  if (has('loans.view')) {
    add(async () => {
      const start = addMonths(utcDate(today.getUTCFullYear(), today.getUTCMonth(), 1), -11);
      const [byStatus, [cash], monthly] = await Promise.all([
        Loan.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, principal: { $sum: '$principalBalance' }, outstanding: { $sum: '$outstandingBalance' }, overdue: { $sum: '$overdueAmount' }, expected: { $sum: '$totalRepayment' } } }]),
        Transaction.aggregate([
          { $match: { reversedAt: { $exists: false }, isCash: true, type: { $in: ['disbursement', 'topup', 'repayment'] } } },
          { $group: { _id: null, disbursed: { $sum: { $cond: [{ $in: ['$type', ['disbursement', 'topup']] }, '$amount', 0] } }, collected: { $sum: { $cond: [{ $eq: ['$type', 'repayment'] }, '$amount', 0] } } } },
        ]),
        Transaction.aggregate([
          { $match: { reversedAt: { $exists: false }, isCash: true, date: { $gte: start }, type: { $in: ['disbursement', 'topup', 'repayment'] } } },
          { $group: { _id: { m: { $dateToString: { format: '%Y-%m', date: '$date' } }, t: { $cond: [{ $eq: ['$type', 'repayment'] }, 'collected', 'disbursed'] } }, amount: { $sum: '$amount' } } },
        ]),
      ]);
      const live = byStatus.filter((r) => LIVE.includes(r._id));
      const disbursedLoans = byStatus.filter((r) => [...LIVE, 'completed'].includes(r._id));
      const overdueRow = byStatus.find((r) => r._id === 'overdue');
      const months = Array.from({ length: 12 }, (_, i) => addMonths(start, i).toISOString().slice(0, 7));
      const pick = (m: string, t: string) => round2(monthly.find((x) => x._id.m === m && x._id.t === t)?.amount ?? 0);
      out.financial = {
        activeLoans: live.reduce((s, r) => s + r.count, 0),
        totalDisbursed: round2(cash?.disbursed ?? 0), totalCollected: round2(cash?.collected ?? 0),
        outstandingPrincipal: sum(live, 'principal'), outstandingTotal: sum(live, 'outstanding'), totalExpected: sum(disbursedLoans, 'expected'),
        overdueAmount: round2(overdueRow?.overdue ?? 0), overdueLoans: overdueRow?.count ?? 0,
        loanStatusBreakdown: LOAN_STATUSES.map((s) => ({ value: s.value, label: s.label, tone: s.tone, count: byStatus.find((r) => r._id === s.value)?.count ?? 0 })),
        outstandingByStatus: LIVE.map((s) => ({ value: s, label: LOAN_STATUSES.find((x) => x.value === s)!.label, amount: round2(byStatus.find((r) => r._id === s)?.outstanding ?? 0) })),
        monthly: months.map((m) => ({ month: m, collected: pick(m, 'collected'), disbursed: pick(m, 'disbursed') })),
      };
    });
    add(async () => { out.recentLoans = (await listLoans({ page: 1, limit: 5, sort: 'createdAt', order: 'desc' })).items; });
    add(async () => {
      const overdue = await Loan.find({ overdueAmount: { $gt: 0 } }).sort({ daysOverdue: -1 }).limit(6).populate('customer', 'fullName customerId');
      out.overdueAccounts = overdue.map((l: any) => ({ id: String(l._id), loanId: l.loanId, customer: l.customer?.fullName, customerId: l.customer?.customerId, overdueAmount: l.overdueAmount, daysOverdue: l.daysOverdue }));
    });
    add(async () => { out.upcomingRepayments = await upcoming(today, 7); });
  }
  if (has('repayments.view') || has('transactions.view')) {
    add(async () => {
      const [[t], recent] = await Promise.all([
        Transaction.aggregate([{ $match: { type: 'repayment', reversedAt: { $exists: false }, date: today } }, { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } }]),
        listTransactions({ page: 1, limit: 6, sort: 'date', order: 'desc' }, { type: 'repayment', reversedAt: { $exists: false } }),
      ]);
      out.todayRepayments = { count: t?.count ?? 0, amount: round2(t?.amount ?? 0) };
      out.recentRepayments = recent.items;
    });
  }
  if (has('transactions.view')) add(async () => { out.recentTransactions = (await listTransactions({ page: 1, limit: 6, sort: 'createdAt', order: 'desc' })).items; });
  await Promise.all(sections);
  return out;
}

async function listCustomersLite() {
  return (await Customer.find({ isArchived: false }).sort({ createdAt: -1 }).limit(5).select('customerId fullName status registrationDate')).map((c) => ({ id: String(c._id), customerId: c.customerId, fullName: c.fullName, status: c.status, registrationDate: c.registrationDate }));
}

async function upcoming(today: Date, days: number) {
  const rows = await RepaymentSchedule.aggregate([
    { $unwind: '$installments' },
    { $match: { 'installments.remaining': { $gt: 0 }, 'installments.dueDate': { $gte: today, $lte: addDays(today, days) } } },
    { $sort: { 'installments.dueDate': 1 } }, { $limit: 8 },
    { $lookup: { from: 'loans', localField: 'loan', foreignField: '_id', as: 'loan' } }, { $unwind: '$loan' },
    { $match: { 'loan.status': { $in: ['active', 'overdue'] } } },
    { $lookup: { from: 'customers', localField: 'loan.customer', foreignField: '_id', as: 'customer' } }, { $unwind: '$customer' },
  ]);
  return rows.map((r) => ({ loanId: r.loan.loanId, id: String(r.loan._id), customer: r.customer.fullName, installment: r.installments.number, dueDate: r.installments.dueDate, amount: r.installments.remaining }));
}
