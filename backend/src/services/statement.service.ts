import { Types } from 'mongoose';
import { Customer } from '../models/Customer.js';
import { Loan } from '../models/Loan.js';
import { Transaction } from '../models/Transaction.js';
import { AppError } from '../utils/AppError.js';
import { fromKobo, toKobo } from '../utils/money.js';
import { getSection } from './settings.service.js';

/**
 * Account statement built straight from the ledger.
 * Debit (DR) = what the client owes (the loan raised, and any reversed payment put back).
 * Credit (CR) = what reduces the debt (repayments, waived interest, balances settled by a top-up).
 * Balance = running DR - CR, i.e. the amount still owed. Same convention as Protech's loan book
 * (Balance = Gross loan - repayments).
 */
export interface StatementRow { date: Date; reference: string; description: string; debit: number; credit: number; balance: number }
export interface LoanStatement {
  loan: {
    id: string; loanId: string; status: string; productName: string | null; loanType: string
    amountTaken: number; principal: number; interest: number; totalLoan: number; emi: number; numberOfInstallments: number; frequency: string
    paymentDate: Date; firstRepaymentDate: Date | null; finalDueDate: Date; currentOutstanding: number
  }
  rows: StatementRow[]
  totals: { debit: number; credit: number; closingBalance: number }
}
export interface Statement {
  generatedAt: Date
  period: { from: Date | null; to: Date | null }
  company: { name: string; address: string; phone: string; email: string; rcNumber: string }
  client: { id: string; customerId: string; name: string; phone: string; email: string | null; ippisNumber: string | null; ministry: string | null }
  loans: LoanStatement[]
  summary: { totalDebit: number; totalCredit: number; closingBalance: number }
}

const sum = (xs: number[]) => fromKobo(xs.reduce((a, b) => a + toKobo(b), 0));

async function loanStatement(loanId: Types.ObjectId | string, from?: Date, to?: Date): Promise<LoanStatement> {
  const loan = await Loan.findById(loanId);
  if (!loan) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND');
  const all = await Transaction.find({ loan: loan._id }).sort({ date: 1, createdAt: 1, _id: 1 });
  const byId = new Map(all.map((t) => [String(t._id), t]));
  const opening = all.find((t) => t.type === 'disbursement' || (t.type === 'topup' && t.isCash));

  type Raw = { date: Date; ref: string; desc: string; dr: number; cr: number };
  const raw: Raw[] = [{
    date: loan.startDate, ref: opening?.transactionId ?? loan.loanId,
    desc: `Loan raised: ${loan.amount.toLocaleString('en-NG', { minimumFractionDigits: 2 })} taken + interest${loan.carriedBalance ? `, incl. ${loan.carriedBalance.toLocaleString('en-NG', { minimumFractionDigits: 2 })} brought forward` : ''} (total loan)`,
    dr: loan.totalRepayment, cr: 0,
  }];
  for (const t of all) {
    const reversalOf = t.reversalOf ? byId.get(String(t.reversalOf)) : undefined;
    if (t.type === 'reversal') {
      if (!reversalOf?.affectsLoanBalance) continue; // reversals of entries that never touched this loan's balance are not shown
      raw.push({ date: t.date, ref: t.transactionId, desc: t.description ?? `Reversal of ${reversalOf.transactionId}`, dr: t.amount, cr: 0 });
      continue;
    }
    if (!t.affectsLoanBalance) continue;
    const label = t.type === 'waiver' ? 'Interest waived' : t.type === 'topup' ? 'Balance settled by top-up' : 'Repayment';
    raw.push({ date: t.date, ref: t.reference || t.transactionId, desc: `${t.description ?? label}${t.reversedAt ? ' (later reversed)' : ''}`, dr: 0, cr: t.amount });
  }
  raw.sort((a, b) => a.date.getTime() - b.date.getTime()); // stable: equal dates keep ledger order

  const rows: StatementRow[] = [];
  let bal = 0;
  let broughtForward = 0;
  for (const r of raw) {
    bal = fromKobo(toKobo(bal) + toKobo(r.dr) - toKobo(r.cr));
    if (from && r.date < from) { broughtForward = bal; continue; }
    if (to && r.date > to) continue;
    rows.push({ date: r.date, reference: r.ref, description: r.desc, debit: r.dr, credit: r.cr, balance: bal });
  }
  if (from && raw.some((r) => r.date < from)) {
    rows.unshift({ date: from, reference: '—', description: 'Balance brought forward', debit: 0, credit: 0, balance: broughtForward });
  }
  const closing = rows.length ? rows[rows.length - 1]!.balance : broughtForward;
  return {
    loan: {
      id: String(loan._id), loanId: loan.loanId, status: loan.status, productName: loan.productName ?? null, loanType: loan.loanType ?? 'new',
      amountTaken: loan.amount, principal: loan.principal, interest: loan.interestAmount, totalLoan: loan.totalRepayment, emi: loan.installmentAmount,
      numberOfInstallments: loan.numberOfInstallments, frequency: loan.frequency, paymentDate: loan.startDate,
      firstRepaymentDate: loan.firstPaymentDate ?? null, finalDueDate: loan.dueDate, currentOutstanding: loan.outstandingBalance,
    },
    rows,
    totals: { debit: sum(rows.map((r) => r.debit)), credit: sum(rows.map((r) => r.credit)), closingBalance: closing },
  };
}

async function header(customerId: Types.ObjectId | string) {
  const c = await Customer.findById(customerId);
  if (!c) throw AppError.notFound('Customer not found', 'CUSTOMER_NOT_FOUND');
  const company = await getSection('company');
  return { company, client: { id: String(c._id), customerId: c.customerId, name: c.fullName, phone: c.phone, email: c.email ?? null, ippisNumber: c.employment?.ippisNumber ?? null, ministry: c.employment?.ministry ?? null } };
}
const finish = (h: Awaited<ReturnType<typeof header>>, loans: LoanStatement[], from?: Date, to?: Date): Statement => ({
  generatedAt: new Date(), period: { from: from ?? null, to: to ?? null }, ...h, loans,
  summary: { totalDebit: sum(loans.map((l) => l.totals.debit)), totalCredit: sum(loans.map((l) => l.totals.credit)), closingBalance: sum(loans.map((l) => l.totals.closingBalance)) },
});

export async function buildLoanStatement(loanId: string, opts: { from?: Date; to?: Date } = {}): Promise<Statement> {
  const loan = Types.ObjectId.isValid(loanId) ? await Loan.findById(loanId) : null;
  if (!loan) throw AppError.notFound('Loan not found', 'LOAN_NOT_FOUND');
  if (['pending', 'rejected', 'cancelled'].includes(loan.status)) throw AppError.badRequest(`A ${loan.status} loan has no transactions to report yet`, 'NO_STATEMENT');
  return finish(await header(loan.customer), [await loanStatement(loan._id, opts.from, opts.to)], opts.from, opts.to);
}

/** Every disbursed loan of the client, one section each, plus a combined summary. */
export async function buildClientStatement(customerId: string, opts: { from?: Date; to?: Date } = {}): Promise<Statement> {
  if (!Types.ObjectId.isValid(customerId)) throw AppError.notFound('Customer not found', 'CUSTOMER_NOT_FOUND');
  const h = await header(customerId);
  const loans = await Loan.find({ customer: customerId, status: { $in: ['active', 'overdue', 'defaulted', 'completed'] } }).sort({ startDate: 1, createdAt: 1 });
  return finish(h, await Promise.all(loans.map((l) => loanStatement(l._id, opts.from, opts.to))), opts.from, opts.to);
}
