import { Customer } from '../models/Customer.js';
import { Loan } from '../models/Loan.js';
import { Transaction } from '../models/Transaction.js';
import { TopUp } from '../models/TopUp.js';
import { AppError } from '../utils/AppError.js';
import { addDays, addMonths, todayLagos, utcDate } from '../utils/dates.js';
import { round2 } from '../utils/money.js';

export type ColType = 'text' | 'money' | 'date' | 'number' | 'status';
export interface Col { key: string; label: string; type: ColType }
export type Row = Record<string, string | number | Date | null>;
export interface ReportQuery { from?: Date; to?: Date; limit: number; status?: string[] }
export interface ReportResult { key: string; title: string; columns: Col[]; rows: Row[]; totals: Row | null; from: Date | null; to: Date | null; truncated: boolean }
interface ReportDef { key: string; label: string; description: string; columns: Col[]; run: (q: ReportQuery) => Promise<Row[]>; sums?: string[] }

const c = (key: string, label: string, type: ColType = 'text'): Col => ({ key, label, type });
const range = (q: ReportQuery, field: string) => (q.from || q.to ? { [field]: { ...(q.from && { $gte: q.from }), ...(q.to && { $lte: q.to }) } } : {});
const statusIn = (q: ReportQuery): Record<string, unknown> => (q.status?.length ? { status: { $in: q.status } } : {});
const cust = (x: any) => (x?.fullName ? `${x.fullName} (${x.customerId})` : '');
const popCust = { path: 'customer', select: 'customerId fullName phone' };

function collections(bucket: 'day' | 'week' | 'month', fallbackDays: number): ReportDef['run'] {
  return async (q) => {
    const today = todayLagos();
    const from = q.from ?? (bucket === 'month' ? addMonths(utcDate(today.getUTCFullYear(), today.getUTCMonth(), 1), -11) : addDays(today, -fallbackDays));
    const to = q.to ?? today;
    const fmt = { day: '%Y-%m-%d', week: '%G-W%V', month: '%Y-%m' }[bucket];
    const rows = await Transaction.aggregate([
      { $match: { type: 'repayment', isCash: true, reversedAt: { $exists: false }, date: { $gte: from, $lte: to } } },
      { $group: { _id: { $dateToString: { format: fmt, date: '$date' } }, payments: { $sum: 1 }, amount: { $sum: '$amount' } } },
      { $sort: { _id: 1 } },
    ]);
    return rows.map((r) => ({ period: r._id, payments: r.payments, amount: round2(r.amount) }));
  };
}

const txRow = (t: any): Row => ({ transactionId: t.transactionId, date: t.date, customer: cust(t.customer), loan: t.loan?.loanId ?? '', type: t.type, method: t.method ?? '', reference: t.reference ?? '', amount: t.amount, state: t.reversedAt ? 'reversed' : 'posted', createdBy: t.createdBy?.name ?? '' });
const txCols = [c('transactionId', 'Transaction'), c('date', 'Date', 'date'), c('customer', 'Customer'), c('loan', 'Loan'), c('type', 'Type', 'status'), c('method', 'Method'), c('reference', 'Reference'), c('amount', 'Amount', 'money'), c('state', 'State', 'status'), c('createdBy', 'Recorded by')];
const txPop = [popCust, { path: 'loan', select: 'loanId' }, { path: 'createdBy', select: 'name' }];

export const REPORTS: ReportDef[] = [
  { key: 'loans', label: 'Loan report', description: 'Loans by start date with terms, repayments and balances.', sums: ['amount', 'interestAmount', 'totalRepayment', 'amountPaid', 'outstandingBalance'],
    columns: [c('loanId', 'Loan'), c('customer', 'Customer'), c('product', 'Product'), c('loanType', 'Type', 'status'), c('amount', 'Amount', 'money'), c('interestAmount', 'Interest', 'money'), c('totalRepayment', 'Total repayment', 'money'), c('amountPaid', 'Paid', 'money'), c('outstandingBalance', 'Outstanding', 'money'), c('status', 'Status', 'status'), c('startDate', 'Start', 'date'), c('dueDate', 'Due', 'date')],
    run: async (q) => (await Loan.find({ ...range(q, 'startDate'), ...statusIn(q) }).sort({ startDate: -1 }).limit(q.limit + 1).populate(popCust)).map((l) => ({ loanId: l.loanId, customer: cust(l.customer), product: l.productName ?? '', loanType: l.loanType ?? 'new', amount: l.amount, interestAmount: l.interestAmount, totalRepayment: l.totalRepayment, amountPaid: l.amountPaid, outstandingBalance: l.outstandingBalance, status: l.status, startDate: l.startDate, dueDate: l.dueDate })) },
  { key: 'repayments', label: 'Repayment report', description: 'Repayments received (excludes reversed payments).', sums: ['amount'],
    columns: [c('transactionId', 'Transaction'), c('date', 'Date', 'date'), c('customer', 'Customer'), c('loan', 'Loan'), c('method', 'Method'), c('reference', 'Reference'), c('amount', 'Amount', 'money'), c('createdBy', 'Recorded by')],
    run: async (q) => (await Transaction.find({ type: 'repayment', reversedAt: { $exists: false }, ...range(q, 'date') }).sort({ date: -1 }).limit(q.limit + 1).populate(txPop)).map((t: any) => ({ transactionId: t.transactionId, date: t.date, customer: cust(t.customer), loan: t.loan?.loanId ?? '', method: t.method ?? '', reference: t.reference ?? '', amount: t.amount, createdBy: t.createdBy?.name ?? '' })) },
  { key: 'outstanding', label: 'Outstanding balance report', description: 'Open loans and what is still owed.', sums: ['principalBalance', 'interestBalance', 'outstandingBalance'],
    columns: [c('loanId', 'Loan'), c('customer', 'Customer'), c('status', 'Status', 'status'), c('principalBalance', 'Principal owed', 'money'), c('interestBalance', 'Interest owed', 'money'), c('outstandingBalance', 'Total outstanding', 'money'), c('nextDueDate', 'Next due', 'date'), c('nextInstallmentAmount', 'Next amount', 'money')],
    run: async (q) => (await Loan.find({ status: { $in: ['active', 'overdue', 'defaulted'] }, outstandingBalance: { $gt: 0 } }).sort({ outstandingBalance: -1 }).limit(q.limit + 1).populate(popCust)).map((l) => ({ loanId: l.loanId, customer: cust(l.customer), status: l.status, principalBalance: l.principalBalance, interestBalance: l.interestBalance, outstandingBalance: l.outstandingBalance, nextDueDate: l.nextDueDate ?? null, nextInstallmentAmount: l.nextInstallmentAmount })) },
  { key: 'overdue', label: 'Overdue report', description: 'Loans with unpaid installments past their due date.', sums: ['overdueAmount', 'outstandingBalance'],
    columns: [c('loanId', 'Loan'), c('customer', 'Customer'), c('phone', 'Phone'), c('overdueAmount', 'Overdue amount', 'money'), c('daysOverdue', 'Days overdue', 'number'), c('outstandingBalance', 'Total outstanding', 'money'), c('status', 'Status', 'status')],
    run: async (q) => (await Loan.find({ overdueAmount: { $gt: 0 }, status: { $in: ['overdue', 'defaulted', 'active'] } }).sort({ daysOverdue: -1 }).limit(q.limit + 1).populate(popCust)).map((l: any) => ({ loanId: l.loanId, customer: cust(l.customer), phone: l.customer?.phone ?? '', overdueAmount: l.overdueAmount, daysOverdue: l.daysOverdue, outstandingBalance: l.outstandingBalance, status: l.status })) },
  { key: 'customers', label: 'Customer report', description: 'Customers registered in the period with their loan position.', sums: ['loans', 'outstanding'],
    columns: [c('customerId', 'Customer ID'), c('fullName', 'Name'), c('phone', 'Phone'), c('status', 'Status', 'status'), c('registrationDate', 'Registered', 'date'), c('loans', 'Loans', 'number'), c('outstanding', 'Outstanding', 'money')],
    run: async (q) => {
      const cs = await Customer.find({ isArchived: false, ...range(q, 'registrationDate') }).sort({ registrationDate: -1 }).limit(q.limit + 1);
      const agg = await Loan.aggregate([{ $match: { customer: { $in: cs.map((x) => x._id) } } }, { $group: { _id: '$customer', loans: { $sum: 1 }, outstanding: { $sum: { $cond: [{ $in: ['$status', ['active', 'overdue', 'defaulted']] }, '$outstandingBalance', 0] } } } }]);
      const by = new Map(agg.map((a) => [String(a._id), a]));
      return cs.map((x) => ({ customerId: x.customerId, fullName: x.fullName, phone: x.phone, status: x.status, registrationDate: x.registrationDate, loans: by.get(String(x._id))?.loans ?? 0, outstanding: round2(by.get(String(x._id))?.outstanding ?? 0) }));
    } },
  { key: 'collections-daily', label: 'Daily collection', description: 'Cash repayments collected per day (default: last 30 days).', sums: ['payments', 'amount'], columns: [c('period', 'Date'), c('payments', 'Payments', 'number'), c('amount', 'Collected', 'money')], run: collections('day', 29) },
  { key: 'collections-weekly', label: 'Weekly collection', description: 'Cash repayments per ISO week (default: last 12 weeks).', sums: ['payments', 'amount'], columns: [c('period', 'Week'), c('payments', 'Payments', 'number'), c('amount', 'Collected', 'money')], run: collections('week', 83) },
  { key: 'collections-monthly', label: 'Monthly collection', description: 'Cash repayments per month (default: last 12 months).', sums: ['payments', 'amount'], columns: [c('period', 'Month'), c('payments', 'Payments', 'number'), c('amount', 'Collected', 'money')], run: collections('month', 0) },
  { key: 'disbursements', label: 'Disbursement report', description: 'Funds paid out (loans and top-ups).', sums: ['amount'],
    columns: [c('transactionId', 'Transaction'), c('date', 'Date', 'date'), c('customer', 'Customer'), c('loan', 'Loan'), c('type', 'Type', 'status'), c('amount', 'Amount', 'money')],
    run: async (q) => (await Transaction.find({ type: { $in: ['disbursement', 'topup'] }, isCash: true, reversedAt: { $exists: false }, ...range(q, 'date') }).sort({ date: -1 }).limit(q.limit + 1).populate(txPop)).map((t: any) => ({ transactionId: t.transactionId, date: t.date, customer: cust(t.customer), loan: t.loan?.loanId ?? '', type: t.type, amount: t.amount })) },
  { key: 'topups', label: 'Top-up report', description: 'Top-up requests and their outcome.', sums: ['requestedAmount', 'totalRepayment'],
    columns: [c('topUpId', 'Top-up'), c('createdAt', 'Requested', 'date'), c('customer', 'Customer'), c('loan', 'Existing loan'), c('newLoan', 'New loan'), c('requestedAmount', 'New funds', 'money'), c('carried', 'Carried balance', 'money'), c('totalRepayment', 'New total repayment', 'money'), c('status', 'Status', 'status')],
    run: async (q) => (await TopUp.find({ ...range(q, 'createdAt'), ...statusIn(q) }).sort({ createdAt: -1 }).limit(q.limit + 1).populate([popCust, { path: 'loan', select: 'loanId' }, { path: 'resultingLoan', select: 'loanId' }])).map((t: any) => ({ topUpId: t.topUpId, createdAt: t.createdAt, customer: cust(t.customer), loan: t.loan?.loanId ?? '', newLoan: t.resultingLoan?.loanId ?? '', requestedAmount: t.requestedAmount, carried: t.calculation?.carriedBalance ?? 0, totalRepayment: t.calculation?.terms?.totalRepayment ?? 0, status: t.status })) },
  { key: 'transactions', label: 'Transaction report', description: 'Every ledger entry in the period.', sums: ['amount'], columns: txCols,
    run: async (q) => (await Transaction.find(range(q, 'date')).sort({ date: -1, _id: -1 }).limit(q.limit + 1).populate(txPop)).map(txRow) },
];

export const reportCatalog = () => REPORTS.map(({ key, label, description }) => ({ key, label, description }));

export async function runReport(key: string, q: ReportQuery): Promise<ReportResult> {
  const def = REPORTS.find((r) => r.key === key);
  if (!def) throw AppError.notFound('Unknown report', 'REPORT_NOT_FOUND');
  let rows = await def.run(q);
  const truncated = rows.length > q.limit;
  if (truncated) rows = rows.slice(0, q.limit);
  const totals: Row | null = def.sums && rows.length ? Object.fromEntries([[def.columns[0]!.key, 'Total'], ...def.sums.map((k) => [k, round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0))])]) : null;
  return { key, title: def.label, columns: def.columns, rows, totals, from: q.from ?? null, to: q.to ?? null, truncated };
}
