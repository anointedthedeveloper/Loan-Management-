import { Customer } from '../models/Customer.js';
import { Loan } from '../models/Loan.js';
import { Transaction } from '../models/Transaction.js';
import { TopUp } from '../models/TopUp.js';
import { AppError } from '../utils/AppError.js';
import { addDays, addMonths, todayLagos, utcDate } from '../utils/dates.js';
import { round2 } from '../utils/money.js';
import { LIVE_LOAN_STATUSES } from '../config/loanOptions.js';

export type ColType = 'text' | 'money' | 'date' | 'number' | 'status';
export interface Col { key: string; label: string; type: ColType }
export type Row = Record<string, string | number | Date | null>;
export interface ReportQuery { from?: Date; to?: Date; limit: number; status?: string[] }
export interface ReportResult { key: string; title: string; columns: Col[]; rows: Row[]; totals: Row | null; from: Date | null; to: Date | null; truncated: boolean }
type RunResult = Row[] | { rows: Row[]; columns: Col[] };
interface ReportDef { key: string; label: string; description: string; columns: Col[]; run: (q: ReportQuery) => Promise<RunResult>; sums?: string[] }

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

const MONTH_LABEL = (ym: string) => ym;
const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const addMonthKey = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y!, m! - 1 + n, 1)); return monthKey(d); };

/**
 * Protech's loan book layout: one row per loan with the calculator's columns (loan amount, application fee, principal, interest,
 * gross loan, EMI) and one column per month showing what was repaid that month. `_calc` carries what the Excel
 * export needs to write live formulas; it is stripped from JSON output.
 */
/** What the Excel export needs to write the book's own formulas for a loan (null when the loan does not follow them). */
const calcMeta = (l: any) => (l.frequency === 'monthly' && l.duration?.unit === 'months' && (l.rateBasis === 'per_month' || l.rateBasis === 'per_loan') && (l.interestBasis ?? 'full_principal') === 'full_principal'
  ? { feeRate: (l.applicationFeeRate ?? 4) / 100, rate: l.interestRate / 100, once: l.rateBasis === 'per_loan' } : null);

async function loanBook(q: ReportQuery): Promise<RunResult> {
  // The book lists each customer's CURRENT loan only (one open loan per customer); completed loans are history, not part of the book.
  // Pass an explicit status filter to see other loans.
  let loans: any[] = await Loan.find({ status: { $in: q.status?.length ? q.status : [...LIVE_LOAN_STATUSES] }, ...range(q, 'startDate') }).sort({ startDate: 1, loanId: 1 }).limit(q.limit + 1).populate({ path: 'customer', select: 'customerId legacyId fullName employment' });
  if (!q.status?.length) { // older data may hold more than one open loan for a customer: keep the latest so each customer appears once
    const latest = new Map<string, any>();
    for (const l of loans) { const k = String(l.customer?._id ?? l.customer); const cur = latest.get(k); if (!cur || l.startDate > cur.startDate || (+l.startDate === +cur.startDate && l.loanId > cur.loanId)) latest.set(k, l); }
    loans = loans.filter((l) => latest.get(String(l.customer?._id ?? l.customer)) === l);
  }
  const ids = loans.map((l) => l._id);
  const credits = ids.length ? await Transaction.aggregate([
    { $match: { loan: { $in: ids }, affectsLoanBalance: true, reversedAt: { $exists: false } } },
    { $group: { _id: { loan: '$loan', m: { $dateToString: { format: '%Y-%m', date: '$date' } } }, amount: { $sum: '$amount' } } },
  ]) : [];
  const cell = new Map<string, number>(credits.map((c) => [`${c._id.loan}|${c._id.m}`, c.amount]));
  const today = monthKey(todayLagos());
  const firsts = [...loans.map((l) => monthKey(l.firstPaymentDate ?? l.startDate)), ...credits.map((c) => c._id.m as string)].sort();
  const lasts = [today, ...credits.map((c) => c._id.m as string)].sort();
  let from = q.from ? monthKey(q.from) : firsts[0] ?? today;
  let to = q.to ? monthKey(q.to) : lasts[lasts.length - 1]!;
  if (to < from) to = from;
  const months: string[] = []; for (let m = from; m <= to && months.length < 60; m = addMonthKey(m, 1)) months.push(m);
  const monthCols: Col[] = months.map((m) => c(`m_${m}`, MONTH_LABEL(m), 'money'));
  const columns: Col[] = [
    c('sn', 'S/N', 'number'), c('clientId', 'Clients ID'), c('clientName', 'Clients Name'), c('ippis', 'IPPIS NO'), c('ministry', 'MINISTRY'), c('tenor', 'Tenor', 'number'), c('paymentDate', 'Payment Date', 'date'),
    c('balanceBF', 'Balance B/Fwd', 'money'), c('loanAmount', 'Loan amount', 'money'), c('applicationFee', 'Application Fee', 'money'), c('principal', 'Principal', 'money'), c('interest', 'Interest', 'money'),
    c('grossLoan', 'Gross Loan', 'money'), c('emi', 'Monthly repayment (EMI)', 'money'), c('startDate', 'Start Date', 'date'), c('endDate', 'End date', 'date'), c('type', 'Status'),
    ...monthCols, c('repaid', 'Repayment to date', 'money'), c('balance', 'Balance (Gross loan - repayment)', 'money'), c('loanStatus', 'Loan status', 'status'), c('loanId', 'Loan ID'),
  ];
  const rows: Row[] = loans.map((l: any, i) => {
    const row: Row = {
      sn: i + 1, clientId: l.customer?.legacyId || l.customer?.customerId || '', clientName: l.customer?.fullName ?? '', ippis: l.customer?.employment?.ippisNumber ?? '', ministry: l.customer?.employment?.ministry ?? '',
      tenor: l.frequency === 'monthly' ? l.numberOfInstallments : l.duration?.unit === 'months' ? l.duration.value : l.numberOfInstallments, paymentDate: l.startDate, balanceBF: l.carriedBalance ?? 0, loanAmount: l.amount, applicationFee: l.applicationFee, principal: l.principal,
      interest: l.interestAmount, grossLoan: l.totalRepayment, emi: l.installmentAmount, startDate: l.firstPaymentDate ?? l.startDate, endDate: l.dueDate, type: (l.loanType === 'topup' ? 'TOP UP' : l.loanType === 'renewal' ? 'RENEWAL' : 'NEW'),
      repaid: 0, balance: 0, loanStatus: l.status, loanId: l.loanId,
    };
    let repaid = 0;
    for (const m of months) { const v = round2(cell.get(`${l._id}|${m}`) ?? 0); row[`m_${m}`] = v || null; repaid += v; }
    // Payments dated outside the shown months still count towards "to date".
    const allPaid = credits.filter((x) => String(x._id.loan) === String(l._id)).reduce((s, x) => s + x.amount, 0);
    row.repaid = round2(Math.max(repaid, allPaid)); row.balance = round2(l.totalRepayment - (row.repaid as number));
    (row as any)._calc = !q.from && !q.to ? calcMeta(l) : null;
    return row;
  });
  return { rows, columns };
}

/**
 * Customer register: every customer once, with their status, IPPIS and client number, and their current loan (if any) in the layout of
 * Protech's monthly sheet. This is also the format the monthly upload reads, so the file can be corrected and sent back.
 */
async function customerRegister(q: ReportQuery): Promise<RunResult> {
  const customers = await Customer.find({ isArchived: false, ...range(q, 'registrationDate') }).sort({ customerId: 1 }).limit(q.limit + 1);
  const loans = await Loan.find({ customer: { $in: customers.map((x) => x._id) }, status: { $in: [...LIVE_LOAN_STATUSES] } }).sort({ startDate: 1, loanId: 1 });
  const current = new Map<string, any>(); for (const l of loans) current.set(String(l.customer), l); // latest open loan wins (a customer has one)
  // Same columns as the monthly upload sheet. The loan figures come first; the customer's profile details (editable, to complete a profile) are at the end.
  const columns: Col[] = [
    c('sn', 'S/N', 'number'), c('clientId', 'Clients ID'), c('clientName', 'Clients Name'), c('ippis', 'IPPIS NO'), c('ministry', 'MINISTRY'),
    c('tenor', 'Tenor', 'number'), c('paymentDate', 'Payment Date', 'date'), c('balanceBF', 'Balance B/Fwd', 'money'), c('loanAmount', 'Loan amount', 'money'),
    c('applicationFee', 'Application Fee', 'money'), c('principal', 'Principal', 'money'), c('interest', 'Interest', 'money'), c('grossLoan', 'Gross Loan', 'money'), c('emi', 'EMI', 'money'),
    c('startDate', 'Start Date', 'date'), c('endDate', 'End date', 'date'), c('type', 'Status'), c('loanId', 'Loan ID'), c('loanStatus', 'Loan status', 'status'), c('paid', 'Repaid to date', 'money'), c('outstanding', 'Outstanding', 'money'),
    c('customerStatus', 'Customer status', 'status'), c('workerType', 'Worker type'), c('phone', 'phone no'), c('email', 'Email'), c('address', 'Address'), c('state', 'State'), c('gender', 'Gender'), c('marital', 'MARITAL STATUS'),
    c('dob', 'DATE OF BIRTH', 'date'), c('nin', 'NIN'), c('bvn', 'BVN'), c('nokName', 'NEXT OF KIN NAME'), c('nokPhone', 'NEXT OF KIN PHONE NO'), c('profile', 'Profile (missing details)'),
  ];
  const rows: Row[] = customers.map((x: any, i) => {
    const l = current.get(String(x._id)); const sector = x.employment?.sector ?? (x.employment?.ippisNumber ? 'government' : '');
    return {
      sn: i + 1, clientId: x.customerId, clientName: x.fullName, ippis: x.employment?.ippisNumber ?? '', ministry: x.employment?.ministry ?? '',
      phone: x.phone ?? '', address: x.address ?? '', nin: x.nin ?? '', bvn: x.bvn ?? '', dob: x.dateOfBirth ?? null, marital: x.maritalStatus ? x.maritalStatus.charAt(0).toUpperCase() + x.maritalStatus.slice(1) : '', nokPhone: x.emergencyContact?.phone ?? '',
      workerType: sector === 'government' ? 'Government' : sector === 'non_government' ? 'Non-government' : '', customerStatus: x.status, profile: (x.profileMissing?.length ?? 0) ? `Missing: ${x.profileMissing.join(', ')}` : 'Complete', email: x.email ?? '', state: x.state ?? '', gender: x.gender ? x.gender.charAt(0).toUpperCase() + x.gender.slice(1) : '', nokName: x.emergencyContact?.name ?? '',
      loanId: l?.loanId ?? '', loanStatus: l?.status ?? 'no active loan', tenor: l ? (l.frequency === 'monthly' ? l.numberOfInstallments : l.duration?.value ?? l.numberOfInstallments) : null, paymentDate: l?.startDate ?? null,
      balanceBF: l ? l.carriedBalance ?? 0 : null, loanAmount: l?.amount ?? null, applicationFee: l?.applicationFee ?? null, principal: l?.principal ?? null, interest: l?.interestAmount ?? null, grossLoan: l?.totalRepayment ?? null, emi: l?.installmentAmount ?? null,
      startDate: l ? l.firstPaymentDate ?? l.startDate : null, endDate: l?.dueDate ?? null, type: l ? (l.loanType === 'topup' ? 'TOP UP' : l.loanType === 'renewal' ? 'RENEWAL' : 'NEW') : '', paid: l?.amountPaid ?? null, outstanding: l?.outstandingBalance ?? null,
      ...(l && !q.from && !q.to ? ({ _calc: calcMeta(l) } as any) : {}),
    };
  });
  return { rows, columns };
}

export const REPORTS: ReportDef[] = [
  { key: 'customer-register', label: 'Customer register (customers and current loans)', description: 'Every customer once, with status, client ID, IPPIS and their current loan in the monthly-sheet layout. Completed loans are not included.', columns: [], sums: ['loanAmount', 'applicationFee', 'principal', 'interest', 'grossLoan', 'paid', 'outstanding'], run: customerRegister },
  { key: 'loan-book', label: 'Loan book (monthly breakdown)', description: 'One row per customer (their current, open loan) in Protech\'s loan-book layout, with a column for each month\'s repayments, repayment to date and balance. Completed loans are not included. Download as Excel.', columns: [], run: loanBook },
  { key: 'loans', label: 'Loan report', description: 'Current (open) loans by start date with terms, repayments and balances. Choose a status to include other loans.', sums: ['amount', 'applicationFee', 'interestAmount', 'totalRepayment', 'amountPaid', 'outstandingBalance'],
    columns: [c('loanId', 'Loan'), c('customer', 'Customer'), c('product', 'Product'), c('loanType', 'Type', 'status'), c('amount', 'Principal', 'money'), c('applicationFee', 'Application Fee', 'money'), c('interestAmount', 'Total interest', 'money'), c('totalRepayment', 'Gross loan (total repayment)', 'money'), c('amountPaid', 'Paid', 'money'), c('outstandingBalance', 'Outstanding', 'money'), c('status', 'Status', 'status'), c('startDate', 'Start', 'date'), c('dueDate', 'Due', 'date')],
    run: async (q) => (await Loan.find({ ...range(q, 'startDate'), ...(q.status?.length ? statusIn(q) : { status: { $in: LIVE_LOAN_STATUSES } }) }).sort({ startDate: -1 }).limit(q.limit + 1).populate(popCust)).map((l) => ({ loanId: l.loanId, customer: cust(l.customer), product: l.productName ?? '', loanType: l.loanType ?? 'new', amount: l.amount, applicationFee: l.applicationFee ?? 0, interestAmount: l.interestAmount, totalRepayment: l.totalRepayment, amountPaid: l.amountPaid, outstandingBalance: l.outstandingBalance, status: l.status, startDate: l.startDate, dueDate: l.dueDate })) },
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
    columns: [c('customerId', 'Customer ID'), c('fullName', 'Name'), c('phone', 'Phone'), c('status', 'Status', 'status'), c('registrationDate', 'Registered', 'date'), c('loans', 'Open loans', 'number'), c('outstanding', 'Outstanding', 'money')],
    run: async (q) => {
      const cs = await Customer.find({ isArchived: false, ...range(q, 'registrationDate') }).sort({ registrationDate: -1 }).limit(q.limit + 1);
      const agg = await Loan.aggregate([{ $match: { customer: { $in: cs.map((x) => x._id) } } }, { $group: { _id: '$customer', loans: { $sum: { $cond: [{ $in: ['$status', ['active', 'overdue', 'defaulted']] }, 1, 0] } }, outstanding: { $sum: { $cond: [{ $in: ['$status', ['active', 'overdue', 'defaulted']] }, '$outstandingBalance', 0] } } } }]);
      const by = new Map(agg.map((a) => [String(a._id), a]));
      return cs.map((x) => ({ customerId: x.customerId, fullName: x.fullName, phone: x.phone ?? '', status: x.status, registrationDate: x.registrationDate, loans: by.get(String(x._id))?.loans ?? 0, outstanding: round2(by.get(String(x._id))?.outstanding ?? 0) }));
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
  const res = await def.run(q);
  let rows = Array.isArray(res) ? res : res.rows;
  const columns = Array.isArray(res) ? def.columns : res.columns;
  const truncated = rows.length > q.limit;
  if (truncated) rows = rows.slice(0, q.limit);
  const sumKeys = def.sums ?? (key === 'loan-book' ? columns.filter((c) => c.type === 'money' && !['balanceBF', 'emi'].includes(c.key)).map((c) => c.key) : undefined);
  const totals: Row | null = sumKeys && rows.length ? Object.fromEntries([[columns[0]!.key, 'Total'], ...sumKeys.map((k) => [k, round2(rows.reduce((s, r) => s + (Number(r[k]) || 0), 0))])]) : null;
  return { key, title: def.label, columns, rows, totals, from: q.from ?? null, to: q.to ?? null, truncated };
}
